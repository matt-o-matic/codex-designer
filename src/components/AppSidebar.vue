<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppState } from '../lib/appState'
import { useNewFeatureUi } from '../lib/newFeatureUi'
import { useRunStore } from '../lib/runStore'
import { useWorkbenchUi } from '../lib/workbenchUi'

const props = defineProps<{
  open?: boolean
  widthPx?: number
  resizing?: boolean
}>()

const isOpen = computed(() => props.open !== false)
const navWidth = computed(() => {
  const raw = typeof props.widthPx === 'number' ? props.widthPx : 256
  const min = 240
  const max = 520
  if (!Number.isFinite(raw)) return 256
  return Math.max(min, Math.min(max, Math.round(raw)))
})
const sidebarStyle = computed(() => ({ width: isOpen.value ? `${navWidth.value}px` : '0px' }))
const transitionClass = computed(() => (props.resizing ? 'transition-none' : 'transition-[width,padding] duration-200'))

const { appState, activeWorkspace, workspacesByPath, loading, openWorkspace } = useAppState()
const { runs } = useRunStore()
const { openNewFeature } = useNewFeatureUi()
const {
  activeWorkspacePath,
  selectedSessionSlug,
  activeMode,
  workspaceSheetOpen,
  isWorkspaceExpanded,
  setWorkspaceExpanded,
  selectSession,
} = useWorkbenchUi()

const recent = computed(() => appState.value?.recentWorkspacePaths ?? [])
const houseStyle = ref<string>('')
const navQuery = ref('')

async function loadHouseStylePreview(workspacePath: string) {
  if (!workspacePath) {
    houseStyle.value = ''
    return
  }
  try {
    houseStyle.value =
      (await window.codexDesigner?.readTextFile?.(workspacePath, '.codex-designer/share/house-style.md')) ?? ''
  } catch {
    houseStyle.value = ''
  }
}

watch(
  () => activeWorkspace.value?.path ?? null,
  (p) => {
    void loadHouseStylePreview(p ?? '')
  },
  { immediate: true }
)

const houseStyleSnippet = computed(() => {
  const lines = String(houseStyle.value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length)
  if (!lines.length) return ''
  const slice = lines.slice(0, 4).join('\n')
  return slice.length > 320 ? `${slice.slice(0, 320)}…` : slice
})

function shortWorkspaceLabel(p: string): string {
  const normalized = (p ?? '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized || p
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

async function chooseWorkspace() {
  const picked = await window.codexDesigner?.pickWorkspace?.()
  if (!picked) return
  await openWorkspace(picked)
  setWorkspaceExpanded(picked, true)
}

function isActiveWorkspace(workspacePath: string): boolean {
  return !!workspacePath && workspacePath === activeWorkspacePath.value
}

async function activateWorkspace(workspacePath: string) {
  if (!workspacePath) return
  setWorkspaceExpanded(workspacePath, true)
  await openWorkspace(workspacePath)
}

function toggleWorkspaceExpanded(workspacePath: string) {
  const next = !isWorkspaceExpanded(workspacePath)
  setWorkspaceExpanded(workspacePath, next)
  if (next) void activateWorkspace(workspacePath)
}

async function editWorkspace(workspacePath: string) {
  if (!workspacePath) return
  await activateWorkspace(workspacePath)
  workspaceSheetOpen.value = true
}

async function addFeature(workspacePath: string) {
  if (!workspacePath) return
  await activateWorkspace(workspacePath)
  openNewFeature(workspacePath)
}

function openSession(workspacePath: string, slug: string) {
  if (!workspacePath || !slug) return
  if (activeWorkspacePath.value !== workspacePath) void activateWorkspace(workspacePath)
  selectSession(workspacePath, slug)
}

function activeRunFor(workspacePath: string, slug: string) {
  const all = Object.values(runs.value ?? {})
  return (
    all.find((r) => r.status === 'running' && r.featureSlug === slug && (!r.workspacePath || r.workspacePath === workspacePath)) ?? null
  )
}

function activityIcon(run: { role: string | null; uiAction: string | null } | null): string {
  const action = String(run?.uiAction ?? '').toLowerCase()
  if (action.includes('planning')) return 'chat'
  if (action.includes('implementation')) return 'build'
  if (action.includes('testing')) return 'checklist'
  if (action.includes('composer')) return 'chat'
  if (action.includes('runner')) return 'terminal'
  const runRole = run?.role ?? null
  if (runRole === 'planning') return 'chat'
  if (runRole === 'implementation') return 'build'
  if (runRole === 'testing') return 'checklist'
  return 'terminal'
}

type WorkspaceNavEntry = {
  path: string
  label: string
  loaded: boolean
  workspaceMatches: boolean
  matchingFeaturesCount: number
  visibleFeatures: Array<{ slug: string }>
  forceExpanded: boolean
}

const workspaceEntries = computed<WorkspaceNavEntry[]>(() => {
  const q = navQuery.value.trim().toLowerCase()
  const out: WorkspaceNavEntry[] = []
  for (const p of recent.value) {
    const path = String(p ?? '').trim()
    if (!path) continue
    const ws = workspacesByPath.value?.[path] ?? null
    const label = shortWorkspaceLabel(path)

    const workspaceMatches =
      !q || label.toLowerCase().includes(q) || path.toLowerCase().includes(q)

    const matchingFeatures = ws && q ? ws.features.filter((f) => f.slug.toLowerCase().includes(q)) : []
    const include = !q || workspaceMatches || matchingFeatures.length > 0
    if (!include) continue

    const visibleFeatures = ws ? (q && !workspaceMatches ? matchingFeatures : ws.features) : []
    const forceExpanded = !!q && (workspaceMatches || matchingFeatures.length > 0)

    out.push({
      path,
      label,
      loaded: !!ws,
      workspaceMatches,
      matchingFeaturesCount: matchingFeatures.length,
      visibleFeatures,
      forceExpanded,
    })
  }
  return out
})

type UsageSummary = { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number }

function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

function formatNetworkEnabled(enabled: boolean | null): string {
  if (enabled === true) return 'On'
  if (enabled === false) return 'Off'
  return '—'
}

const activeSessionRun = computed(() => {
  const ws = activeWorkspacePath.value
  const slug = selectedSessionSlug.value
  if (!ws || !slug) return null

  const all = Object.values(runs.value ?? {}).filter(
    (r) => r && r.featureSlug === slug && (!r.workspacePath || r.workspacePath === ws)
  )

  const mode = activeMode.value
  const modeRuns = all.filter((r) => r.role === mode)
  const pick = (modeRuns.length ? modeRuns : all).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
  return pick ?? null
})

const activeSessionUsage = computed<UsageSummary | null>(() => {
  const r = activeSessionRun.value as any
  const usage = r?.usage ?? null
  if (!usage) return null
  return usage as UsageSummary
})
</script>

<template>
  <aside
    class="hidden h-full flex-none overflow-hidden overflow-x-hidden md:block"
    :class="[
      transitionClass,
      isOpen ? 'border-r border-gray-200 p-4 dark:border-gray-800' : 'border-r-0 p-0',
    ]"
    :style="sidebarStyle"
    aria-label="Navigation"
  >
    <div v-if="isOpen" class="flex h-full flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="relative">
          <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-gray-400">search</span>
          <input
            v-model="navQuery"
            class="w-full rounded-xl bg-gray-100 py-2 pl-10 pr-3 text-xs font-bold text-gray-800 outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950 dark:text-gray-100"
            placeholder="Search workspaces & sessions"
            type="text"
          />
        </div>

        <button
          class="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          type="button"
          :disabled="loading"
          @click="chooseWorkspace"
        >
          <span class="material-symbols-rounded text-[18px]">drive_folder_upload</span>
          Add workspace
        </button>

        <div class="mt-4">
        <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Workspaces</div>

        <div v-if="!recent.length" class="mt-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
          No recent workspaces yet.
        </div>

        <div v-else class="mt-2">
          <div
            v-if="!workspaceEntries.length"
            class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
          >
            No matching workspaces or sessions.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="w in workspaceEntries"
              :key="w.path"
              class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950"
              :class="isActiveWorkspace(w.path) ? 'ring-1 ring-brand-500/30' : ''"
            >
              <div class="flex items-center gap-2 px-2 py-2">
                <button
                  class="inline-flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-900"
                  type="button"
                  :aria-label="isWorkspaceExpanded(w.path) || w.forceExpanded ? 'Collapse workspace' : 'Expand workspace'"
                  @click.stop="toggleWorkspaceExpanded(w.path)"
                >
                  <span class="material-symbols-rounded text-[20px]">
                    {{ isWorkspaceExpanded(w.path) || w.forceExpanded ? 'expand_more' : 'chevron_right' }}
                  </span>
                </button>

                <button
                  class="min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-xs font-black transition-colors"
                  :class="
                    isActiveWorkspace(w.path)
                      ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20'
                      : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-900'
                  "
                  type="button"
                  :disabled="loading"
                  @click="activateWorkspace(w.path)"
                >
                  <div class="truncate">{{ w.label }}</div>
                </button>
              </div>

              <div class="px-2 pb-2">
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-[11px] font-black text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                    type="button"
                    :disabled="loading"
                    @click.stop="addFeature(w.path)"
                  >
                    <span class="material-symbols-rounded text-[16px]">add</span>
                    New feature
                  </button>
                  <button
                    class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    :disabled="loading"
                    aria-label="Workspace settings"
                    @click.stop="editWorkspace(w.path)"
                  >
                    <span class="material-symbols-rounded text-[18px]">tune</span>
                  </button>
                </div>
              </div>

              <div v-if="isWorkspaceExpanded(w.path) || w.forceExpanded" class="border-t border-gray-200 px-2 py-2 dark:border-gray-800">
                <div class="space-y-1">
                  <template v-if="w.loaded">
                    <button
                      v-for="f in w.visibleFeatures"
                      :key="f.slug"
                      class="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-xs font-bold transition-colors"
                      :class="
                        w.path === activeWorkspacePath && f.slug === selectedSessionSlug
                          ? 'bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900'
                      "
                      type="button"
                      @click="openSession(w.path, f.slug)"
                    >
                      <div class="min-w-0 flex items-center gap-2">
                        <span
                          v-if="activeRunFor(w.path, f.slug)"
                          class="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400"
                          :title="activeRunFor(w.path, f.slug)?.role ?? 'running'"
                        >
                        <span class="material-symbols-rounded animate-spin text-[16px]">progress_activity</span>
                          <span class="material-symbols-rounded text-[16px]">{{ activityIcon(activeRunFor(w.path, f.slug)) }}</span>
                        </span>
                        <span v-else class="material-symbols-rounded text-[16px] text-gray-400">chat</span>
                        <span class="truncate">{{ f.slug }}</span>
                      </div>
                      <span class="material-symbols-rounded text-[16px] text-gray-400">chevron_right</span>
                    </button>

                    <div
                      v-if="!w.visibleFeatures.length"
                      class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-[11px] text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
                    >
                      No sessions found.
                    </div>
                  </template>

                  <div
                    v-else
                    class="rounded-xl bg-gray-50 p-3 text-[11px] text-gray-600 dark:bg-gray-950 dark:text-gray-300"
                  >
                    Loading sessions…
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

        <div class="mt-6 rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div class="flex items-center gap-2 font-black text-gray-900 dark:text-gray-100">
            <span class="material-symbols-rounded text-[18px] text-brand-500">tips_and_updates</span>
            House Style
          </div>
          <p v-if="!houseStyleSnippet" class="mt-2 leading-relaxed">
            Configure per-workspace style guidance in the workspace settings panel.
          </p>
          <pre
            v-else
            class="mt-2 whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          >{{ houseStyleSnippet }}</pre>
        </div>
      </div>

      <div class="flex-none pt-3">
        <div class="rounded-2xl border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Context</div>
              <div class="mt-1 truncate font-mono text-[11px]">
                <span v-if="selectedSessionSlug">{{ selectedSessionSlug }}</span>
                <span v-else>—</span>
                <span v-if="selectedSessionSlug" class="text-gray-500 dark:text-gray-400"> · {{ activeMode }}</span>
              </div>
            </div>
            <span
              v-if="activeSessionRun?.status === 'running'"
              class="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400"
              title="Running"
            >
              <span class="material-symbols-rounded animate-spin text-[16px]">progress_activity</span>
              <span class="material-symbols-rounded text-[16px]">{{ activityIcon(activeSessionRun) }}</span>
            </span>
          </div>

          <div class="mt-3 grid grid-cols-3 gap-2">
            <div class="rounded-xl bg-gray-50 px-2 py-2 dark:bg-gray-900">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">In</div>
              <div class="mt-1 font-mono text-[11px]">{{ formatTokenCount(activeSessionUsage?.inputTokens) }}</div>
            </div>
            <div class="rounded-xl bg-gray-50 px-2 py-2 dark:bg-gray-900">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Cached</div>
              <div class="mt-1 font-mono text-[11px]">{{ formatTokenCount(activeSessionUsage?.cachedInputTokens) }}</div>
            </div>
            <div class="rounded-xl bg-gray-50 px-2 py-2 dark:bg-gray-900">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Out</div>
              <div class="mt-1 font-mono text-[11px]">{{ formatTokenCount(activeSessionUsage?.outputTokens) }}</div>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
            <div class="inline-flex items-center gap-1 rounded-xl bg-gray-50 px-2 py-1 dark:bg-gray-900">
              <span class="font-black">Sandbox:</span>
              <span class="font-mono">{{ activeSessionRun?.sandboxMode ?? '—' }}</span>
            </div>
            <div class="inline-flex items-center gap-1 rounded-xl bg-gray-50 px-2 py-1 dark:bg-gray-900">
              <span class="font-black">Approvals:</span>
              <span class="font-mono">{{ activeSessionRun?.approvalPolicy ?? '—' }}</span>
            </div>
            <div class="inline-flex items-center gap-1 rounded-xl bg-gray-50 px-2 py-1 dark:bg-gray-900">
              <span class="font-black">Network:</span>
              <span class="font-mono">{{ formatNetworkEnabled(activeSessionRun?.networkAccessEnabled ?? null) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
