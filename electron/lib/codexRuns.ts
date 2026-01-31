import type { Input, ThreadEvent, ThreadOptions } from '@openai/codex-sdk'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { gitHeadCommit, gitStatusPorcelain, isGitRepo } from './git'
import { findCodexBinaryPath } from './codexBinary'
import { readCodexSessionCwd } from './codexSessions'
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
  | { type: 'run.pid'; runId: string; pid: number }
  | { type: 'run.checkpoint'; runId: string; headCommit: string }
  | { type: 'run.result'; runId: string; finalResponse: string }
  | { type: 'run.completed'; runId: string }
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'run.aborted'; runId: string }

type RunState = {
  abort: AbortController
  pid: number | null
  status: 'running' | 'completed' | 'failed' | 'aborted'
}

export class CodexRunManager {
  private readonly runs = new Map<string, RunState>()

  startRun(args: StartRunArgs, onEvent: (e: ThreadEvent | RunLifecycleEvent) => void): RunStarted {
    const runId = randomUUID()
    const abort = new AbortController()
    this.runs.set(runId, { abort, pid: null, status: 'running' })
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
    if (typeof state.pid === 'number' && Number.isFinite(state.pid)) {
      void this.killRunProcess(state.pid).catch(() => {})
    }
  }

  private async runInternal(
    runId: string,
    args: StartRunArgs,
    onEvent: (e: ThreadEvent | RunLifecycleEvent) => void
  ): Promise<void> {
    const { resumeThreadId, persistThreadId } = await this.getThreadState(args.workspacePath, args.featureSlug, args.role)

    if (args.role === 'implementation') {
      const gitRepo = await isGitRepo(args.workspacePath)
      const isContinuation = args.profileId === 'careful' && !!resumeThreadId

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

    const state = this.runs.get(runId)
    const signal = state?.abort.signal

    const { prompt, images } = normalizeInput(args.input, args.workspacePath)

    const eventsFile = await this.ensureRunEventsFile(runId)
    const stderrFile = eventsFile.replace(/\.events\.jsonl$/, '.stderr.log')
    const schemaFile = eventsFile.replace(/\.events\.jsonl$/, '.output-schema.json')

    if (args.outputSchema !== undefined) {
      if (!isPlainJsonObject(args.outputSchema)) throw new Error('outputSchema must be a plain JSON object')
      await fs.writeFile(schemaFile, JSON.stringify(args.outputSchema), 'utf-8')
    }

    const codexArgs = buildCodexExecArgs({
      images,
      threadId: resumeThreadId,
      options: effectiveThreadOptions,
      outputSchemaPath: args.outputSchema !== undefined ? schemaFile : undefined,
    })

    const { pid } = await this.spawnCodex({
      args: codexArgs,
      prompt,
      eventsFile,
      stderrFile,
      signal,
    })

    const updated = this.runs.get(runId)
    if (updated) updated.pid = pid
    onEvent({ type: 'run.pid', runId, pid })

    await this.followCodexEventsFile({
      runId,
      workspacePath: args.workspacePath,
      eventsFile,
      persistThreadId,
      onEvent,
      signal,
    })

    if (state?.status === 'aborted') {
      onEvent({ type: 'run.aborted', runId })
      return
    }

    // followCodexEventsFile will emit run.result / run.failed / run.completed.
    onEvent({ type: 'run.completed', runId })
    if (state) state.status = 'completed'
  }

  private async getThreadState(
    workspacePath: string,
    featureSlug: string | undefined,
    role: ThreadRole,
  ): Promise<{ resumeThreadId: string | null; persistThreadId: (threadId: string) => Promise<void> }> {
    if (!featureSlug || role === 'generic' || role === 'testing') {
      return { resumeThreadId: null, persistThreadId: async () => {} }
    }

    const state = await readWorkspaceState(workspacePath)
    const featureState = state.features?.[featureSlug] ?? {}

    const currentId =
      role === 'planning'
        ? featureState.planningThreadId
        : role === 'implementation'
          ? featureState.implementationThreadId
          : undefined

    const resumeThreadId = await this.validateResumeThreadId(workspacePath, featureSlug, role, currentId)

    const persistThreadId = async (threadId: string) => {
      const latest = await readWorkspaceState(workspacePath)
      const features = { ...(latest.features ?? {}) }
      const nextFeature = { ...(features[featureSlug] ?? {}) }
      if (role === 'planning') nextFeature.planningThreadId = threadId
      if (role === 'implementation') nextFeature.implementationThreadId = threadId
      features[featureSlug] = nextFeature
      await writeWorkspaceState(workspacePath, { ...latest, features })
    }

    return { resumeThreadId, persistThreadId }
  }

  private async validateResumeThreadId(
    workspacePath: string,
    featureSlug: string,
    role: Exclude<ThreadRole, 'generic' | 'testing'>,
    candidate: string | undefined
  ): Promise<string | null> {
    if (!candidate || !candidate.trim().length) return null

    // Validate that the persisted Codex session was created in the same workspace.
    // If it wasn't (or we can't verify), prefer starting a fresh thread over risking
    // running tools against the wrong repo.
    const cwd = await readCodexSessionCwd(candidate).catch(() => null)
    const matches = cwd ? await sameRealPath(cwd, workspacePath) : false
    if (matches) return candidate

    const latest = await readWorkspaceState(workspacePath)
    const features = { ...(latest.features ?? {}) }
    const nextFeature = { ...(features[featureSlug] ?? {}) }
    if (role === 'planning') delete nextFeature.planningThreadId
    if (role === 'implementation') delete nextFeature.implementationThreadId
    features[featureSlug] = nextFeature
    await writeWorkspaceState(workspacePath, { ...latest, features })

    return null
  }

  private async ensureRunEventsFile(runId: string): Promise<string> {
    // Keep path in sync with RunLogStore.eventsPath(runId).
    const { app } = await import('electron')
    const dir = path.join(app.getPath('userData'), 'codex-designer', 'runs')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${runId}.events.jsonl`)
    await fs.writeFile(file, '', { flag: 'a' })
    return file
  }

  private async spawnCodex(args: {
    args: string[]
    prompt: string
    eventsFile: string
    stderrFile: string
    signal: AbortSignal | undefined
  }): Promise<{ pid: number }> {
    if (args.signal?.aborted) throw new Error('Run aborted.')

    await fs.mkdir(path.dirname(args.eventsFile), { recursive: true })
    const stdoutFd = openSync(args.eventsFile, 'a')
    const stderrFd = openSync(args.stderrFile, 'a')

    try {
      const codexPath = findCodexBinaryPath()
      const env = buildCodexEnv()
      const child = spawn(codexPath, args.args, {
        env,
        detached: true,
        stdio: ['pipe', stdoutFd, stderrFd],
        windowsHide: true,
      })
      if (!child.pid) throw new Error('Failed to start Codex process.')

      child.stdin?.write(args.prompt)
      child.stdin?.end()
      child.unref()

      return { pid: child.pid }
    } finally {
      try {
        closeSync(stdoutFd)
      } catch {
        // ignore
      }
      try {
        closeSync(stderrFd)
      } catch {
        // ignore
      }
    }
  }

  private async followCodexEventsFile(args: {
    runId: string
    workspacePath: string
    eventsFile: string
    persistThreadId: (threadId: string) => Promise<void>
    onEvent: (e: ThreadEvent | RunLifecycleEvent) => void
    signal: AbortSignal | undefined
  }): Promise<void> {
    let offset = 0
    let carry = ''
    let finalResponse = ''
    let emittedResult = false
    let emittedFailed = false

    const parseLine = async (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let evt: ThreadEvent
      try {
        evt = JSON.parse(trimmed) as ThreadEvent
      } catch {
        return
      }
      args.onEvent(evt)

      if (evt.type === 'thread.started') {
        args.onEvent({ type: 'run.thread', runId: args.runId, threadId: evt.thread_id })
        await args.persistThreadId(evt.thread_id)
      } else if (evt.type === 'item.completed' && (evt as any).item?.type === 'agent_message') {
        const text = (evt as any).item?.text
        if (typeof text === 'string') finalResponse = text
      } else if (evt.type === 'turn.failed') {
        if (!emittedFailed) {
          emittedFailed = true
          args.onEvent({ type: 'run.failed', runId: args.runId, message: evt.error.message })
        }
      } else if (evt.type === 'turn.completed') {
        if (!emittedResult) {
          emittedResult = true
          args.onEvent({ type: 'run.result', runId: args.runId, finalResponse })
        }
      }
    }

    while (!args.signal?.aborted) {
      const st = await fs.stat(args.eventsFile).catch(() => null)
      const size = st?.size ?? 0
      if (size > offset) {
        const fh = await fs.open(args.eventsFile, 'r')
        try {
          while (offset < size) {
            const remaining = size - offset
            const toRead = Math.min(remaining, 64 * 1024)
            const buf = Buffer.allocUnsafe(toRead)
            const { bytesRead } = await fh.read(buf, 0, toRead, offset)
            if (!bytesRead) break
            offset += bytesRead

            carry += buf.subarray(0, bytesRead).toString('utf8')
            let nl = carry.indexOf('\n')
            while (nl !== -1) {
              const line = carry.slice(0, nl)
              carry = carry.slice(nl + 1)
              await parseLine(line)
              nl = carry.indexOf('\n')
            }
          }
        } finally {
          await fh.close()
        }
      }

      // Once we have a turn end signal, we can stop following shortly after.
      if (emittedResult || emittedFailed) break

      await sleep(125)
    }

    if (args.signal?.aborted) return
    if (!emittedResult) {
      args.onEvent({ type: 'run.result', runId: args.runId, finalResponse })
    }
  }

  private async killRunProcess(pid: number): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) return
    if (process.platform === 'win32') {
      // Best-effort: kill process tree.
      await new Promise<void>((resolve) => {
        const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
        child.once('exit', () => resolve())
        child.once('error', () => resolve())
      })
      return
    }

    // Kill the entire process group when detached.
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
}

type NormalizedInput = { prompt: string; images: string[] }

function normalizeInput(input: Input, workspacePath: string): NormalizedInput {
  if (typeof input === 'string') return { prompt: input, images: [] }
  const promptParts: string[] = []
  const images: string[] = []
  for (const item of input) {
    if (item.type === 'text') promptParts.push(item.text)
    else if (item.type === 'local_image') {
      const raw = item.path
      if (path.isAbsolute(raw)) images.push(raw)
      else images.push(resolveInside(workspacePath, raw))
    }
  }
  return { prompt: promptParts.join('\n\n'), images }
}

function buildCodexExecArgs(args: {
  images: string[]
  threadId: string | null
  options: ThreadOptions
  outputSchemaPath?: string
}): string[] {
  const commandArgs: string[] = ['exec', '--experimental-json']

  if (args.options.model) commandArgs.push('--model', args.options.model)
  if (args.options.sandboxMode) commandArgs.push('--sandbox', args.options.sandboxMode)
  if (args.options.workingDirectory) commandArgs.push('--cd', args.options.workingDirectory)
  if (args.options.additionalDirectories?.length) {
    for (const dir of args.options.additionalDirectories) commandArgs.push('--add-dir', dir)
  }
  if (args.options.skipGitRepoCheck) commandArgs.push('--skip-git-repo-check')
  if (args.outputSchemaPath) commandArgs.push('--output-schema', args.outputSchemaPath)

  if (args.options.modelReasoningEffort) {
    commandArgs.push('--config', `model_reasoning_effort="${args.options.modelReasoningEffort}"`)
  }
  if (args.options.networkAccessEnabled !== undefined) {
    commandArgs.push('--config', `sandbox_workspace_write.network_access=${args.options.networkAccessEnabled}`)
  }
  if (args.options.approvalPolicy) {
    commandArgs.push('--config', `approval_policy="${args.options.approvalPolicy}"`)
  }

  if (args.images.length) {
    for (const img of args.images) commandArgs.push('--image', img)
  }
  if (args.threadId) commandArgs.push('resume', args.threadId)

  return commandArgs
}

function buildCodexEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  if (!env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) {
    env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'codex-designer'
  }
  return env
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function sameRealPath(a: string, b: string): Promise<boolean> {
  const [ra, rb] = await Promise.all([
    fs.realpath(a).catch(() => path.resolve(a)),
    fs.realpath(b).catch(() => path.resolve(b)),
  ])
  return ra === rb
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
