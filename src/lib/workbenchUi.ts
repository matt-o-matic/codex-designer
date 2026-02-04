import { computed, ref, watch } from 'vue'
import { useAppState } from './appState'

export type SessionMode = 'planning' | 'implementation' | 'testing'

type WorkbenchUiStateV1 = {
  version: 1
  expandedWorkspaces: Record<string, boolean>
  lastSessionByWorkspace: Record<string, string>
  lastModeBySession: Record<string, SessionMode>
}

const STORAGE_KEY = 'codex-designer:workbench-ui'

const expandedWorkspaces = ref<Record<string, boolean>>({})
const lastSessionByWorkspace = ref<Record<string, string>>({})
const lastModeBySession = ref<Record<string, SessionMode>>({})
const workspaceSheetOpen = ref(false)

let loaded = false

function isSessionMode(value: unknown): value is SessionMode {
  return value === 'planning' || value === 'implementation' || value === 'testing'
}

function loadOnce() {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<WorkbenchUiStateV1>
    if (!parsed || parsed.version !== 1) return
    if (parsed.expandedWorkspaces && typeof parsed.expandedWorkspaces === 'object') {
      expandedWorkspaces.value = { ...(parsed.expandedWorkspaces as any) }
    }
    if (parsed.lastSessionByWorkspace && typeof parsed.lastSessionByWorkspace === 'object') {
      lastSessionByWorkspace.value = { ...(parsed.lastSessionByWorkspace as any) }
    }
    if (parsed.lastModeBySession && typeof parsed.lastModeBySession === 'object') {
      const next: Record<string, SessionMode> = {}
      for (const [k, v] of Object.entries(parsed.lastModeBySession as any)) {
        if (!k) continue
        if (!isSessionMode(v)) continue
        next[k] = v
      }
      lastModeBySession.value = next
    }
  } catch {
    // ignore
  }
}

function save() {
  const payload: WorkbenchUiStateV1 = {
    version: 1,
    expandedWorkspaces: expandedWorkspaces.value,
    lastSessionByWorkspace: lastSessionByWorkspace.value,
    lastModeBySession: lastModeBySession.value,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function useWorkbenchUi() {
  loadOnce()
  const { appState } = useAppState()

  watch(
    [expandedWorkspaces, lastSessionByWorkspace, lastModeBySession],
    () => save(),
    { deep: true }
  )

  const activeWorkspacePath = computed(() => appState.value?.activeWorkspacePath ?? null)

  watch(
    () => appState.value?.recentWorkspacePaths ?? [],
    (paths) => {
      if (!paths.length) return
      const next = { ...expandedWorkspaces.value }
      let changed = false
      for (const p of paths) {
        if (!p) continue
        if (!(p in next)) {
          next[p] = true
          changed = true
        }
      }
      if (changed) expandedWorkspaces.value = next
    },
    { immediate: true }
  )

  const selectedSessionSlug = computed(() => {
    const ws = activeWorkspacePath.value
    if (!ws) return null
    return lastSessionByWorkspace.value[ws] ?? null
  })

  const activeMode = computed(() => {
    const ws = activeWorkspacePath.value
    const slug = selectedSessionSlug.value
    if (!ws || !slug) return 'planning' as const
    const key = `${ws}::${slug}`
    return lastModeBySession.value[key] ?? ('planning' as const)
  })

  function isWorkspaceExpanded(workspacePath: string): boolean {
    if (!workspacePath) return false
    return expandedWorkspaces.value[workspacePath] !== false
  }

  function setWorkspaceExpanded(workspacePath: string, expanded: boolean) {
    if (!workspacePath) return
    expandedWorkspaces.value = { ...expandedWorkspaces.value, [workspacePath]: expanded }
  }

  function selectSession(workspacePath: string, featureSlug: string | null) {
    if (!workspacePath) return
    const next = { ...lastSessionByWorkspace.value }
    if (!featureSlug) delete next[workspacePath]
    else next[workspacePath] = featureSlug
    lastSessionByWorkspace.value = next
  }

  function setActiveMode(workspacePath: string, featureSlug: string, mode: SessionMode) {
    if (!workspacePath || !featureSlug) return
    if (!isSessionMode(mode)) return
    const key = `${workspacePath}::${featureSlug}`
    lastModeBySession.value = { ...lastModeBySession.value, [key]: mode }
  }

  return {
    expandedWorkspaces,
    workspaceSheetOpen,
    activeWorkspacePath,
    selectedSessionSlug,
    activeMode,
    isWorkspaceExpanded,
    setWorkspaceExpanded,
    selectSession,
    setActiveMode,
  }
}

