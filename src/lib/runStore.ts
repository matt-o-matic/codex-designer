import { computed, reactive } from 'vue'

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted'

export type RunRecord = {
  runId: string
  startedAt: number
  status: RunStatus
  events: unknown[]
  finalResponse: string
  error: string | null
}

const runs = reactive<Record<string, RunRecord>>({})

let subscribed = false
let unsubscribe: (() => void) | null = null

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
          status: 'running',
          events: [],
          finalResponse: '',
          error: null,
        }
      }

      runs[runId].events.push(payload.event)

      const evt = payload.event as any
      if (evt?.type === 'run.result' && typeof evt.finalResponse === 'string') {
        runs[runId].finalResponse = evt.finalResponse
      } else if (evt?.type === 'run.failed') {
        runs[runId].status = 'failed'
        runs[runId].error = evt.message ? String(evt.message) : 'Run failed'
      } else if (evt?.type === 'run.aborted') {
        runs[runId].status = 'aborted'
      } else if (evt?.type === 'run.completed') {
        if (runs[runId].status === 'running') runs[runId].status = 'completed'
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
      status: 'running',
      events: [],
      finalResponse: '',
      error: null,
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

