import { computed, ref } from 'vue'

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
const loading = ref(false)
const error = ref<string | null>(null)

export function useAppState() {
  return {
    appState: computed(() => appState.value),
    activeWorkspace: computed(() => activeWorkspace.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refreshAppState,
    openWorkspace,
    setWorkspaceShareability,
    initGit,
  }
}

async function refreshAppState() {
  error.value = null
  loading.value = true
  try {
    const state = await window.codexDesigner?.getAppState?.()
    appState.value = (state ?? null) as AppState | null
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

