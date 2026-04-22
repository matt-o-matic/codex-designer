import { computed, reactive } from 'vue'

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted'

export type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RunUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
}

export type WorkspaceDiffFile = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unknown'
  additions: number | null
  deletions: number | null
}

export type WorkspaceDiffSummary = {
  isGitRepo: boolean
  updatedAtMs: number
  files: WorkspaceDiffFile[]
  error: string | null
}

export type RunRecord = {
  runId: string
  workspacePath: string | null
  startedAt: number
  endedAt: number | null
  status: RunStatus
  events: unknown[]
  finalResponse: string
  input: string | null
  inputImages: string[]
  error: string | null
  role: 'planning' | 'implementation' | 'testing' | 'generic' | null
  featureSlug: string | null
  threadId: string | null
  checkpoint: string | null
  profileId: 'careful' | 'yolo' | null
  model: string | null
  modelReasoningEffort: ModelReasoningEffort | null
  usage: RunUsage | null
  sandboxMode: string | null
  approvalPolicy: string | null
  networkAccessEnabled: boolean | null
  oneShotNetwork: boolean | null
  uiAction: string | null
  uiUserMessage: string | null
  workspaceDiff: WorkspaceDiffSummary | null
}

const runs = reactive<Record<string, RunRecord>>({})

let subscribed = false
let unsubscribe: (() => void) | null = null

const MAX_EVENTS = 1000

function isFileChangeKind(raw: unknown): WorkspaceDiffFile['status'] {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (value === 'add' || value === 'added' || value === 'create' || value === 'created') return 'added'
  if (value === 'delete' || value === 'deleted' || value === 'remove' || value === 'removed') return 'deleted'
  if (value === 'modify' || value === 'modified' || value === 'update' || value === 'updated') return 'modified'
  if (value === 'rename' || value === 'renamed' || value === 'move' || value === 'moved') return 'renamed'
  if (value === 'copy' || value === 'copied') return 'copied'
  return 'unknown'
}

function asFiniteDiffNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function buildWorkspaceDiffFromEvents(events: unknown[]): WorkspaceDiffSummary | null {
  const pathToFile = new Map<string, WorkspaceDiffFile>()

  for (const evt of events ?? []) {
    if (!evt || typeof evt !== 'object') continue
    const e = evt as any
    const t = typeof e?.type === 'string' ? e.type : ''
    const item = e?.item

    if (
      (t === 'item.started' || t === 'item.updated' || t === 'item.completed') &&
      item &&
      typeof item === 'object' &&
      typeof item.type === 'string' &&
      item.type === 'file_change'
    ) {
      const changes = Array.isArray(item.changes) ? item.changes : []
      for (const change of changes) {
        if (!change || typeof change !== 'object') continue
        const c = change as any
        const fromPath = String(c?.fromPath ?? c?.from ?? '').trim()
        const toPath = String(c?.toPath ?? c?.path ?? c?.to ?? '').trim()
        const status = isFileChangeKind(c?.kind ?? c?.changeType ?? item.status)
        const additions = asFiniteDiffNumber(c?.additions ?? c?.insertions)
        const deletions = asFiniteDiffNumber(c?.deletions ?? c?.deletions_count ?? c?.removed ?? c?.removals)

        const pathLabel = toPath || fromPath
        if (!pathLabel) continue

        if (status === 'renamed' && fromPath && toPath) {
          pathToFile.set(`${fromPath}->${toPath}`, {
            path: `${fromPath} -> ${toPath}`,
            status,
            additions,
            deletions,
          })
          continue
        }

        pathToFile.set(pathLabel, {
          path: pathLabel,
          status,
          additions,
          deletions,
        })
      }
    }
  }

  if (!pathToFile.size) return null
  return {
    isGitRepo: true,
    updatedAtMs: Date.now(),
    files: Array.from(pathToFile.values()).sort((a, b) => a.path.localeCompare(b.path)),
    error: null,
  }
}

function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  unsubscribe =
    window.codexDesigner?.onRunEvent?.((payload) => {
      const runId = payload.runId
      if (!runs[runId]) {
        runs[runId] = {
          runId,
          workspacePath: null,
          startedAt: Date.now(),
          endedAt: null,
          status: 'running',
          events: [],
          finalResponse: '',
          input: null,
          inputImages: [],
          error: null,
          role: null,
          featureSlug: null,
          threadId: null,
          checkpoint: null,
          profileId: null,
          model: null,
          modelReasoningEffort: null,
          usage: null,
          sandboxMode: null,
          approvalPolicy: null,
          networkAccessEnabled: null,
          oneShotNetwork: null,
          uiAction: null,
          uiUserMessage: null,
          workspaceDiff: null,
        }
      }

      runs[runId].events.push(payload.event)
      if (runs[runId].events.length > MAX_EVENTS) {
        runs[runId].events.splice(0, runs[runId].events.length - MAX_EVENTS)
      }
      runs[runId].workspaceDiff = buildWorkspaceDiffFromEvents(runs[runId].events)

      const evt = payload.event as any
      if (
        (evt?.type === 'item.started' || evt?.type === 'item.updated' || evt?.type === 'item.completed') &&
        evt?.item &&
        typeof evt.item === 'object'
      ) {
        const itemType = typeof evt.item.type === 'string' ? evt.item.type : ''

        if (itemType === 'agent_message' && typeof evt.item.text === 'string') {
          runs[runId].finalResponse = evt.item.text
        }
      }

      if (evt?.type === 'run.result' && typeof evt.finalResponse === 'string') {
        runs[runId].finalResponse = evt.finalResponse
      } else if (evt?.type === 'run.started') {
        runs[runId].role = (evt.role as any) ?? runs[runId].role
        runs[runId].featureSlug = typeof evt.featureSlug === 'string' ? evt.featureSlug : runs[runId].featureSlug
        runs[runId].workspacePath =
          typeof evt.workspacePath === 'string' && evt.workspacePath.trim().length ? evt.workspacePath : runs[runId].workspacePath
        runs[runId].profileId = (evt.profileId as any) ?? runs[runId].profileId
        runs[runId].model = typeof evt.model === 'string' || evt.model === null ? evt.model : runs[runId].model
        runs[runId].modelReasoningEffort =
          typeof evt.modelReasoningEffort === 'string' || evt.modelReasoningEffort === null
            ? evt.modelReasoningEffort
            : runs[runId].modelReasoningEffort
        runs[runId].oneShotNetwork = typeof evt.oneShotNetwork === 'boolean' ? evt.oneShotNetwork : runs[runId].oneShotNetwork
      } else if (evt?.type === 'run.options') {
        runs[runId].profileId = (evt.profileId as any) ?? runs[runId].profileId
        runs[runId].model = typeof evt.model === 'string' || evt.model === null ? evt.model : runs[runId].model
        runs[runId].modelReasoningEffort =
          typeof evt.modelReasoningEffort === 'string' || evt.modelReasoningEffort === null
            ? evt.modelReasoningEffort
            : runs[runId].modelReasoningEffort
        runs[runId].sandboxMode = typeof evt.sandboxMode === 'string' || evt.sandboxMode === null ? evt.sandboxMode : runs[runId].sandboxMode
        runs[runId].approvalPolicy = typeof evt.approvalPolicy === 'string' || evt.approvalPolicy === null ? evt.approvalPolicy : runs[runId].approvalPolicy
        runs[runId].networkAccessEnabled =
          typeof evt.networkAccessEnabled === 'boolean' || evt.networkAccessEnabled === null
            ? evt.networkAccessEnabled
            : runs[runId].networkAccessEnabled
        runs[runId].oneShotNetwork = typeof evt.oneShotNetwork === 'boolean' ? evt.oneShotNetwork : runs[runId].oneShotNetwork
      } else if (evt?.type === 'run.thread' && typeof evt.threadId === 'string') {
        runs[runId].threadId = evt.threadId
      } else if (evt?.type === 'run.checkpoint' && typeof evt.headCommit === 'string') {
        runs[runId].checkpoint = evt.headCommit
      } else if (evt?.type === 'turn.completed' && typeof evt.usage === 'object' && evt.usage) {
        const input = Number((evt.usage as any).input_tokens) || 0
        const cachedInput = Number((evt.usage as any).cached_input_tokens) || 0
        const output = Number((evt.usage as any).output_tokens) || 0
        const prev = runs[runId].usage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }
        const next = {
          inputTokens: prev.inputTokens + input,
          cachedInputTokens: prev.cachedInputTokens + cachedInput,
          outputTokens: prev.outputTokens + output,
          totalTokens: prev.totalTokens + input + output,
        }
        runs[runId].usage = next
      } else if (evt?.type === 'run.failed') {
        runs[runId].status = 'failed'
        runs[runId].error = evt.message ? String(evt.message) : 'Run failed'
        runs[runId].endedAt = runs[runId].endedAt ?? Date.now()
      } else if (evt?.type === 'run.aborted') {
        runs[runId].status = 'aborted'
        runs[runId].endedAt = runs[runId].endedAt ?? Date.now()
      } else if (evt?.type === 'run.completed') {
        if (runs[runId].status === 'running') runs[runId].status = 'completed'
        runs[runId].endedAt = runs[runId].endedAt ?? Date.now()
      }
    }) ?? null
}

export function useRunStore() {
  ensureSubscribed()

  const runList = computed(() =>
    Object.values(runs).sort((a, b) => {
      return b.startedAt - a.startedAt
    })
  )

  async function startRun(args: {
    workspacePath: string
    featureSlug?: string
    role: 'planning' | 'implementation' | 'testing' | 'generic'
    profileId: 'careful' | 'yolo'
    model?: string
    modelReasoningEffort?: ModelReasoningEffort
    input:
      | string
      | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>
    outputSchema?: unknown
    oneShotNetwork?: boolean
    uiAction?: string
    uiUserMessage?: string
  }): Promise<string> {
    const res = await window.codexDesigner?.startRun?.(args)
    if (!res?.runId) throw new Error('Failed to start run.')
    const runId = res.runId

    const inputText =
      typeof args.input === 'string'
        ? args.input
        : Array.isArray(args.input)
          ? args.input
              .filter((p) => p && typeof p === 'object' && 'type' in p && (p as any).type === 'text' && typeof (p as any).text === 'string')
              .map((p) => String((p as any).text))
              .join('')
          : ''

    const inputImages =
      Array.isArray(args.input)
        ? args.input
            .filter(
              (p) =>
                p &&
                typeof p === 'object' &&
                'type' in p &&
                (p as any).type === 'local_image' &&
                typeof (p as any).path === 'string'
            )
            .map((p) => String((p as any).path))
        : []

    runs[runId] = {
      runId,
      workspacePath: args.workspacePath,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      events: [],
      finalResponse: '',
      input: inputText,
      inputImages,
      error: null,
      role: args.role,
      featureSlug: args.featureSlug ?? null,
      threadId: null,
      checkpoint: null,
      profileId: args.profileId,
      model: args.model ?? null,
      modelReasoningEffort: args.modelReasoningEffort ?? null,
      usage: null,
      sandboxMode: null,
      approvalPolicy: null,
      networkAccessEnabled: null,
      oneShotNetwork: args.oneShotNetwork === true,
      uiAction: args.uiAction ?? null,
      uiUserMessage: args.uiUserMessage ?? null,
      workspaceDiff: null,
    }
    return runId
  }

  async function abortRun(runId: string): Promise<void> {
    await window.codexDesigner?.abortRun?.(runId)
  }

  function getRun(runId: string | null): RunRecord | null {
    if (!runId) return null
    return runs[runId] ?? null
  }

  return {
    runs: computed(() => runs),
    runList,
    startRun,
    abortRun,
    getRun,
  }
}

export function disposeRunSubscription() {
  unsubscribe?.()
  unsubscribe = null
  subscribed = false
}
