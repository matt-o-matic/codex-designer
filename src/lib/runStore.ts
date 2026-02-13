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

const MAX_EVENTS = 100

type DiffRefreshState = {
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  pending: boolean
  missingHandlerRetries: number
}

const diffRefreshByRun = new Map<string, DiffRefreshState>()

function getDiffRefreshState(runId: string): DiffRefreshState {
  const existing = diffRefreshByRun.get(runId)
  if (existing) return existing
  const next: DiffRefreshState = { timer: null, inFlight: false, pending: false, missingHandlerRetries: 0 }
  diffRefreshByRun.set(runId, next)
  return next
}

function scheduleWorkspaceDiffRefresh(runId: string, delayMs = 650) {
  const api = window.codexDesigner
  if (!api?.getGitWorktreeSummary) return
  const rec = runs[runId]
  if (!rec?.workspacePath) return

  const st = getDiffRefreshState(runId)
  st.pending = true
  if (st.timer) return

  st.timer = setTimeout(async () => {
    st.timer = null
    if (st.inFlight) return

    st.inFlight = true
    st.pending = false
    try {
      const res = await api.getGitWorktreeSummary(rec.workspacePath!)
      if (!runs[runId]) return
      st.missingHandlerRetries = 0
      runs[runId].workspaceDiff = {
        isGitRepo: !!res?.isGitRepo,
        updatedAtMs: Number(res?.updatedAtMs) || Date.now(),
        files: Array.isArray(res?.files) ? (res.files as any) : [],
        error: typeof res?.error === 'string' || res?.error === null ? (res.error as any) : null,
      }
    } catch (e) {
      if (!runs[runId]) return
      const msg = e instanceof Error ? e.message : String(e)
      const missingHandler =
        msg.includes("No handler registered for 'codex-designer:get-git-worktree-summary'") ||
        (msg.includes('No handler registered') && msg.includes('get-git-worktree-summary'))

      if (missingHandler && st.missingHandlerRetries < 3) {
        st.missingHandlerRetries += 1
        scheduleWorkspaceDiffRefresh(runId, 1250)
      }

      runs[runId].workspaceDiff = {
        isGitRepo: false,
        updatedAtMs: Date.now(),
        files: [],
        error: missingHandler ? 'Diff stats unavailable (restart the app to enable this).' : msg,
      }
    } finally {
      st.inFlight = false
      if (st.pending) scheduleWorkspaceDiffRefresh(runId, 250)
    }
  }, Math.max(0, Math.floor(delayMs)))
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

        if (itemType === 'file_change' || (itemType === 'command_execution' && evt.type === 'item.completed')) {
          scheduleWorkspaceDiffRefresh(runId)
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
        scheduleWorkspaceDiffRefresh(runId, 0)
      } else if (evt?.type === 'run.aborted') {
        runs[runId].status = 'aborted'
        runs[runId].endedAt = runs[runId].endedAt ?? Date.now()
        scheduleWorkspaceDiffRefresh(runId, 0)
      } else if (evt?.type === 'run.completed') {
        if (runs[runId].status === 'running') runs[runId].status = 'completed'
        runs[runId].endedAt = runs[runId].endedAt ?? Date.now()
        scheduleWorkspaceDiffRefresh(runId, 0)
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
