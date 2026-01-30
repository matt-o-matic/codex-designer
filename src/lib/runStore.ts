import { computed, reactive } from 'vue'

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted'

export type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RunRecord = {
  runId: string
  startedAt: number
  endedAt: number | null
  status: RunStatus
  events: unknown[]
  finalResponse: string
  error: string | null
  role: 'planning' | 'implementation' | 'testing' | 'generic' | null
  featureSlug: string | null
  threadId: string | null
  checkpoint: string | null
  profileId: 'careful' | 'yolo' | null
  model: string | null
  modelReasoningEffort: ModelReasoningEffort | null
  sandboxMode: string | null
  approvalPolicy: string | null
  networkAccessEnabled: boolean | null
  oneShotNetwork: boolean | null
}

const runs = reactive<Record<string, RunRecord>>({})

let subscribed = false
let unsubscribe: (() => void) | null = null

const MAX_EVENTS = 100

function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  unsubscribe =
    window.codexDesigner?.onRunEvent?.((payload) => {
      const runId = payload.runId
      if (!runs[runId]) {
        runs[runId] = {
          runId,
          startedAt: Date.now(),
          endedAt: null,
          status: 'running',
          events: [],
          finalResponse: '',
          error: null,
          role: null,
          featureSlug: null,
          threadId: null,
          checkpoint: null,
          profileId: null,
          model: null,
          modelReasoningEffort: null,
          sandboxMode: null,
          approvalPolicy: null,
          networkAccessEnabled: null,
          oneShotNetwork: null,
        }
      }

      runs[runId].events.push(payload.event)
      if (runs[runId].events.length > MAX_EVENTS) {
        runs[runId].events.splice(0, runs[runId].events.length - MAX_EVENTS)
      }

      const evt = payload.event as any
      if (evt?.type === 'run.result' && typeof evt.finalResponse === 'string') {
        runs[runId].finalResponse = evt.finalResponse
      } else if (evt?.type === 'run.started') {
        runs[runId].role = (evt.role as any) ?? runs[runId].role
        runs[runId].featureSlug = typeof evt.featureSlug === 'string' ? evt.featureSlug : runs[runId].featureSlug
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
  }): Promise<string> {
    const res = await window.codexDesigner?.startRun?.(args)
    if (!res?.runId) throw new Error('Failed to start run.')
    const runId = res.runId
    runs[runId] = {
      runId,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      events: [],
      finalResponse: '',
      error: null,
      role: args.role,
      featureSlug: args.featureSlug ?? null,
      threadId: null,
      checkpoint: null,
      profileId: args.profileId,
      model: args.model ?? null,
      modelReasoningEffort: args.modelReasoningEffort ?? null,
      sandboxMode: null,
      approvalPolicy: null,
      networkAccessEnabled: null,
      oneShotNetwork: args.oneShotNetwork === true,
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
