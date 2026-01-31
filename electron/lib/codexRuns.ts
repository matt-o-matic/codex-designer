import { Codex, type Input, type Thread, type ThreadEvent, type ThreadOptions, type TurnOptions } from '@openai/codex-sdk'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gitHeadCommit, gitStatusPorcelain, isGitRepo } from './git'
import { resolveInside } from './safePath'
import { readProfilesFile } from './workspaceProfiles'
import { readWorkspaceState, writeWorkspaceState } from './workspaceState'

export type ThreadRole = 'planning' | 'implementation' | 'testing' | 'generic'

export type RunProfile = {
  id: 'careful' | 'yolo'
  label: string
  threadOptions: Omit<ThreadOptions, 'workingDirectory'>
}

export const DEFAULT_PROFILES: Record<RunProfile['id'], RunProfile> = {
  careful: {
    id: 'careful',
    label: 'Careful',
    threadOptions: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-failure',
      networkAccessEnabled: false,
    },
  },
  yolo: {
    id: 'yolo',
    label: 'YOLO',
    threadOptions: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    },
  },
}

export type StartRunArgs = {
  workspacePath: string
  featureSlug?: string
  role: ThreadRole
  profileId: RunProfile['id']
  model?: string
  modelReasoningEffort?: ThreadOptions['modelReasoningEffort']
  input: Input
  outputSchema?: unknown
  oneShotNetwork?: boolean
}

export type RunStarted = {
  runId: string
}

export type RunLifecycleEvent =
  | {
      type: 'run.started'
      runId: string
      featureSlug?: string
      role: ThreadRole
      profileId: RunProfile['id']
      model: string | null
      modelReasoningEffort: ThreadOptions['modelReasoningEffort'] | null
      oneShotNetwork: boolean
    }
  | {
      type: 'run.options'
      runId: string
      profileId: RunProfile['id']
      model: string | null
      modelReasoningEffort: ThreadOptions['modelReasoningEffort'] | null
      sandboxMode: ThreadOptions['sandboxMode'] | null
      approvalPolicy: ThreadOptions['approvalPolicy'] | null
      networkAccessEnabled: ThreadOptions['networkAccessEnabled'] | null
      oneShotNetwork: boolean
    }
  | { type: 'run.thread'; runId: string; threadId: string }
  | { type: 'run.checkpoint'; runId: string; headCommit: string }
  | { type: 'run.result'; runId: string; finalResponse: string }
  | { type: 'run.completed'; runId: string }
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'run.aborted'; runId: string }

type RunState = {
  abort: AbortController
  status: 'running' | 'completed' | 'failed' | 'aborted'
}

export class CodexRunManager {
  private readonly codex: Codex
  private readonly runs = new Map<string, RunState>()

  constructor() {
    this.codex = new Codex()
  }

  startRun(args: StartRunArgs, onEvent: (e: ThreadEvent | RunLifecycleEvent) => void): RunStarted {
    const runId = randomUUID()
    const abort = new AbortController()
    this.runs.set(runId, { abort, status: 'running' })
    onEvent({
      type: 'run.started',
      runId,
      featureSlug: args.featureSlug,
      role: args.role,
      profileId: args.profileId,
      model: args.model ?? null,
      modelReasoningEffort: args.modelReasoningEffort ?? null,
      oneShotNetwork: args.oneShotNetwork === true,
    })

    void this.runInternal(runId, args, onEvent).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      onEvent({ type: 'run.failed', runId, message })
      const state = this.runs.get(runId)
      if (state) state.status = 'failed'
    })

    return { runId }
  }

  abortRun(runId: string): void {
    const state = this.runs.get(runId)
    if (!state) return
    if (state.status !== 'running') return
    state.status = 'aborted'
    state.abort.abort()
  }

  private async runInternal(
    runId: string,
    args: StartRunArgs,
    onEvent: (e: ThreadEvent | RunLifecycleEvent) => void
  ): Promise<void> {
    if (args.role === 'implementation') {
      const gitRepo = await isGitRepo(args.workspacePath)
      const isContinuation =
        args.profileId === 'careful' && args.featureSlug
          ? !!(await readWorkspaceState(args.workspacePath)).features?.[args.featureSlug]?.implementationThreadId
          : false

      if (!gitRepo && args.profileId === 'careful') {
        throw new Error('Workspace is not a git repo. Initialize git before running implementation.')
      }

      // Careful runs should start from a clean baseline. Once an implementation thread exists, allow follow-ups
      // (e.g. fixing build errors) without forcing intermediate commits.
      if (gitRepo && args.profileId === 'careful' && !isContinuation) {
        const porcelain = await gitStatusPorcelain(args.workspacePath)
        if (porcelain.trim().length) {
          throw new Error('Workspace git working tree is dirty. Please clean/commit/stash before running implementation.')
        }
      }

      if (gitRepo) {
        const headCommit = await gitHeadCommit(args.workspacePath)
        onEvent({ type: 'run.checkpoint', runId, headCommit })
      }

      if (args.profileId === 'careful' && args.featureSlug && !isContinuation) {
        const planPath = path.join(args.workspacePath, 'docs', `${args.featureSlug}.plan.md`)
        const qnaPath = path.join(args.workspacePath, 'docs', `${args.featureSlug}.qna.md`)
        const [planStat, qnaStat] = await Promise.all([
          fs.stat(planPath).catch(() => null),
          fs.stat(qnaPath).catch(() => null),
        ])
        if (planStat && qnaStat && qnaStat.mtimeMs > planStat.mtimeMs) {
          throw new Error('Plan appears older than the Q&A. Regenerate the plan (Q&A → Generate next round) before implementing.')
        }
      }
    }

    const profilesFile = await readProfilesFile(args.workspacePath)
    const workspaceProfile = profilesFile?.profiles?.find((p) => p.id === args.profileId) ?? null
    const profile = workspaceProfile
      ? { ...DEFAULT_PROFILES[args.profileId], threadOptions: workspaceProfile.threadOptions }
      : DEFAULT_PROFILES[args.profileId]
    const effectiveThreadOptions: ThreadOptions = {
      ...profile.threadOptions,
      workingDirectory: args.workspacePath,
    }

    if (args.model) effectiveThreadOptions.model = args.model
    if (args.modelReasoningEffort) effectiveThreadOptions.modelReasoningEffort = args.modelReasoningEffort
    if (args.role === 'implementation' && args.profileId === 'yolo') {
      effectiveThreadOptions.skipGitRepoCheck = true
    }

    if (args.oneShotNetwork === true) {
      effectiveThreadOptions.networkAccessEnabled = true
    }

    onEvent({
      type: 'run.options',
      runId,
      profileId: args.profileId,
      model: effectiveThreadOptions.model ?? null,
      modelReasoningEffort: effectiveThreadOptions.modelReasoningEffort ?? null,
      sandboxMode: effectiveThreadOptions.sandboxMode ?? null,
      approvalPolicy: effectiveThreadOptions.approvalPolicy ?? null,
      networkAccessEnabled: effectiveThreadOptions.networkAccessEnabled ?? null,
      oneShotNetwork: args.oneShotNetwork === true,
    })

    const { thread, persistThreadId } = await this.getThread(args.workspacePath, args.featureSlug, args.role, effectiveThreadOptions)

    const turnOptions: TurnOptions = {
      outputSchema: args.outputSchema,
      signal: this.runs.get(runId)?.abort.signal,
    }

    const input: Input = Array.isArray(args.input)
      ? args.input.map((item: any) => {
          if (item?.type === 'local_image' && typeof item.path === 'string') {
            const absPath = path.isAbsolute(item.path) ? item.path : resolveInside(args.workspacePath, item.path)
            return { ...item, path: absPath }
          }
          return item
        })
      : args.input

    const { events } = await thread.runStreamed(input, turnOptions)
    let finalResponse = ''
    for await (const evt of events) {
      onEvent(evt)
      if (evt.type === 'thread.started') {
        onEvent({ type: 'run.thread', runId, threadId: evt.thread_id })
        await persistThreadId(evt.thread_id)
      }
      if (evt.type === 'item.completed' && evt.item.type === 'agent_message') {
        finalResponse = evt.item.text
      }
      if (evt.type === 'turn.completed') {
        // fallthrough: we'll emit run.completed after generator ends
      }
      if (evt.type === 'turn.failed') {
        onEvent({ type: 'run.failed', runId, message: evt.error.message })
      }
    }

    const state = this.runs.get(runId)
    if (state?.status === 'aborted') {
      onEvent({ type: 'run.aborted', runId })
      return
    }

    onEvent({ type: 'run.result', runId, finalResponse })
    onEvent({ type: 'run.completed', runId })
    if (state) state.status = 'completed'
  }

  private async getThread(
    workspacePath: string,
    featureSlug: string | undefined,
    role: ThreadRole,
    options: ThreadOptions
  ): Promise<{ thread: Thread; persistThreadId: (threadId: string) => Promise<void> }> {
    if (!featureSlug || role === 'generic') {
      const thread = this.codex.startThread(options)
      return { thread, persistThreadId: async () => {} }
    }

    const state = await readWorkspaceState(workspacePath)
    const featureState = state.features?.[featureSlug] ?? {}

    const currentId =
      role === 'planning'
        ? featureState.planningThreadId
        : role === 'implementation'
          ? featureState.implementationThreadId
          : undefined

    const thread = currentId ? this.codex.resumeThread(currentId, options) : this.codex.startThread(options)

    const persistThreadId = async (threadId: string) => {
      const latest = await readWorkspaceState(workspacePath)
      const features = { ...(latest.features ?? {}) }
      const nextFeature = { ...(features[featureSlug] ?? {}) }
      if (role === 'planning') nextFeature.planningThreadId = threadId
      if (role === 'implementation') nextFeature.implementationThreadId = threadId
      features[featureSlug] = nextFeature
      await writeWorkspaceState(workspacePath, { ...latest, features })
    }

    return { thread, persistThreadId }
  }
}
