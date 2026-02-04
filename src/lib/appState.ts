import { computed, reactive, ref } from 'vue'

export type AppState = {
  version: 1
  activeWorkspacePath?: string
  recentWorkspacePaths: string[]
}

export type WorkspaceShareability = 'local' | 'shareable'

export type FeatureSummary = {
  slug: string
  docsDir: string
  planPath: string
  qnaPath: string
  implPath: string
  testJsonPath: string
  testMdPath: string
  assetsDir: string
  updatedAtMs: number | null
}

export type WorkspaceSummary = {
  path: string
  isGitRepo: boolean
  isGitClean: boolean | null
  headCommit: string | null
  shareability: WorkspaceShareability | null
  features: FeatureSummary[]
}

const appState = ref<AppState | null>(null)
const activeWorkspace = ref<WorkspaceSummary | null>(null)
const workspacesByPath = reactive<Record<string, WorkspaceSummary>>({})
const loading = ref(false)
const error = ref<string | null>(null)

let prefetchCounter = 0

export function useAppState() {
  return {
    appState: computed(() => appState.value),
    activeWorkspace: computed(() => activeWorkspace.value),
    workspacesByPath: computed(() => workspacesByPath),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refreshAppState,
    openWorkspace,
    getWorkspaceSummary,
    setWorkspaceShareability,
    initGit,
  }
}

function cacheWorkspace(ws: WorkspaceSummary | null) {
  if (!ws) return
  workspacesByPath[ws.path] = ws
}

function getWorkspaceSummary(workspacePath: string): WorkspaceSummary | null {
  if (!workspacePath) return null
  return workspacesByPath[workspacePath] ?? null
}

async function prefetchWorkspaceSummaries(workspacePaths: string[]) {
  const token = ++prefetchCounter
  const unique = Array.from(new Set((workspacePaths ?? []).map((p) => String(p ?? '').trim()).filter(Boolean)))
  if (!unique.length) return

  await Promise.all(
    unique.map(async (p) => {
      if (token !== prefetchCounter) return
      if (workspacesByPath[p]) return
      try {
        const ws = await window.codexDesigner?.getWorkspaceSummary?.(p)
        if (!ws) return
        if (token !== prefetchCounter) return
        cacheWorkspace(ws as any)
      } catch {
        // ignore
      }
    })
  )
}

async function refreshAppState() {
  error.value = null
  loading.value = true
  try {
    const state = await window.codexDesigner?.getAppState?.()
    appState.value = (state ?? null) as AppState | null
    void prefetchWorkspaceSummaries(appState.value?.recentWorkspacePaths ?? [])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function openWorkspace(workspacePath: string) {
  error.value = null
  loading.value = true
  try {
    const ws = await window.codexDesigner?.openWorkspace?.(workspacePath)
    activeWorkspace.value = (ws ?? null) as WorkspaceSummary | null
    cacheWorkspace(activeWorkspace.value)
    await refreshAppState()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function setWorkspaceShareability(shareability: WorkspaceShareability) {
  if (!activeWorkspace.value) return
  error.value = null
  loading.value = true
  try {
    const ws = await window.codexDesigner?.setWorkspaceShareability?.(activeWorkspace.value.path, shareability)
    activeWorkspace.value = (ws ?? null) as WorkspaceSummary | null
    cacheWorkspace(activeWorkspace.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function initGit() {
  if (!activeWorkspace.value) return
  error.value = null
  loading.value = true
  try {
    const ws = await window.codexDesigner?.initGit?.(activeWorkspace.value.path)
    activeWorkspace.value = (ws ?? null) as WorkspaceSummary | null
    cacheWorkspace(activeWorkspace.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
