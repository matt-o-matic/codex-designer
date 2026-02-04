<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAppState } from '../lib/appState'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import { useRunStore, type ModelReasoningEffort } from '../lib/runStore'
import { useWorkbenchUi } from '../lib/workbenchUi'
import AutoGrowTextarea from './AutoGrowTextarea.vue'
import ModelsInspector from './ModelsInspector.vue'
import RunEventStream from './RunEventStream.vue'
import MarkdownViewer from './MarkdownViewer.vue'

const { activeWorkspace, loading, error, openWorkspace, setWorkspaceShareability, initGit } = useAppState()
const { workspaceSheetOpen } = useWorkbenchUi()
const { startRun, abortRun, getRun } = useRunStore()

const wsPath = computed(() => activeWorkspace.value?.path ?? '')

function close() {
  workspaceSheetOpen.value = false
}

// --- VS Code ---
const vsCodeResult = ref<{ ok: boolean; method: 'code' | 'os-open'; error?: string } | null>(null)

async function openInVsCode() {
  if (!wsPath.value) return
  vsCodeResult.value = null
  try {
    const res = await window.codexDesigner?.openInVsCode?.(wsPath.value)
    vsCodeResult.value = res ?? { ok: false, method: 'os-open', error: 'Unknown error' }
  } catch (e) {
    vsCodeResult.value = { ok: false, method: 'os-open', error: e instanceof Error ? e.message : String(e) }
  }
}

async function refreshWorkspace() {
  if (!wsPath.value) return
  await openWorkspace(wsPath.value)
}

// --- Models ---
const codexModels = ref<CodexModelInfo[]>([])
const modelsLoading = ref(false)
const modelsError = ref<string | null>(null)

async function refreshModels(forceRefresh = false) {
  modelsLoading.value = true
  modelsError.value = null
  try {
    codexModels.value = await listCodexModels({ forceRefresh })
  } catch (e) {
    codexModels.value = []
    modelsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    modelsLoading.value = false
  }
}

onMounted(() => {
  void refreshModels()
})

// --- Run defaults ---
type WorkspaceRunDefaults = { model?: string; modelReasoningEffort?: ModelReasoningEffort | '' }
type WorkspaceRunDefaultsByRole = {
  planning?: WorkspaceRunDefaults
  implementation?: WorkspaceRunDefaults
  testing?: WorkspaceRunDefaults
  generic?: WorkspaceRunDefaults
  newWork?: WorkspaceRunDefaults
}

type ModelChoice = 'default' | 'custom' | string
type ThinkingChoice = 'default' | ModelReasoningEffort

type DefaultsRowState = {
  modelChoice: ModelChoice
  modelCustom: string
  thinkingChoice: ThinkingChoice
}

const roleRows = ref<Record<keyof WorkspaceRunDefaultsByRole, DefaultsRowState>>({
  planning: { modelChoice: 'default', modelCustom: '', thinkingChoice: 'default' },
  implementation: { modelChoice: 'default', modelCustom: '', thinkingChoice: 'default' },
  testing: { modelChoice: 'default', modelCustom: '', thinkingChoice: 'default' },
  generic: { modelChoice: 'default', modelCustom: '', thinkingChoice: 'default' },
  newWork: { modelChoice: 'default', modelCustom: '', thinkingChoice: 'default' },
})

const defaultRoles = computed(() => Object.keys(roleRows.value) as Array<keyof WorkspaceRunDefaultsByRole>)

function modelValue(row: DefaultsRowState): string {
  if (row.modelChoice === 'default') return ''
  if (row.modelChoice === 'custom') return row.modelCustom.trim()
  return row.modelChoice
}

function thinkingValue(row: DefaultsRowState): ModelReasoningEffort | '' {
  if (row.thinkingChoice === 'default') return ''
  return row.thinkingChoice
}

function applyModelChoiceFromValue(model: string | undefined, row: DefaultsRowState) {
  const raw = String(model ?? '').trim()
  if (!raw) {
    row.modelChoice = 'default'
    row.modelCustom = ''
    return
  }
  const known = codexModels.value.some((m) => m.model === raw)
  if (known) {
    row.modelChoice = raw
    row.modelCustom = ''
    return
  }
  row.modelChoice = 'custom'
  row.modelCustom = raw
}

function applyThinkingChoiceFromValue(value: string | undefined, row: DefaultsRowState) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    row.thinkingChoice = 'default'
    return
  }
  const allowed: Array<ModelReasoningEffort> = ['minimal', 'low', 'medium', 'high', 'xhigh']
  if (allowed.includes(raw as ModelReasoningEffort)) {
    row.thinkingChoice = raw as ModelReasoningEffort
    return
  }
  row.thinkingChoice = 'default'
}

const runDefaultsError = ref<string | null>(null)
let suppressRunDefaultsAutosave = false
let runDefaultsSaveTimer: number | null = null

async function loadWorkspaceRunDefaults() {
  if (!wsPath.value) return
  try {
    const defaults = (await window.codexDesigner?.getWorkspaceRunDefaults?.(wsPath.value)) as WorkspaceRunDefaultsByRole | null
    suppressRunDefaultsAutosave = true
    for (const role of Object.keys(roleRows.value) as Array<keyof WorkspaceRunDefaultsByRole>) {
      applyModelChoiceFromValue(defaults?.[role]?.model, roleRows.value[role])
      applyThinkingChoiceFromValue(defaults?.[role]?.modelReasoningEffort, roleRows.value[role])
    }
  } finally {
    queueMicrotask(() => {
      suppressRunDefaultsAutosave = false
    })
  }
}

async function saveWorkspaceRunDefaults() {
  if (!wsPath.value) return
  const payload: WorkspaceRunDefaultsByRole = {}
  for (const role of Object.keys(roleRows.value) as Array<keyof WorkspaceRunDefaultsByRole>) {
    payload[role] = {
      model: modelValue(roleRows.value[role]) || '',
      modelReasoningEffort: thinkingValue(roleRows.value[role]) || '',
    }
  }
  await window.codexDesigner?.setWorkspaceRunDefaults?.(wsPath.value, payload)
}

function scheduleRunDefaultsSave() {
  if (!wsPath.value) return
  if (suppressRunDefaultsAutosave) return
  if (runDefaultsSaveTimer) window.clearTimeout(runDefaultsSaveTimer)
  runDefaultsSaveTimer = window.setTimeout(() => {
    runDefaultsSaveTimer = null
    runDefaultsError.value = null
    void saveWorkspaceRunDefaults().catch((e) => {
      runDefaultsError.value = e instanceof Error ? e.message : String(e)
    })
  }, 400)
}

function applyModelFrom(sourceRole: keyof WorkspaceRunDefaultsByRole, includeThinking: boolean) {
  const src = roleRows.value[sourceRole]
  const srcModel = modelValue(src)
  const srcThinking = thinkingValue(src)

  for (const role of Object.keys(roleRows.value) as Array<keyof WorkspaceRunDefaultsByRole>) {
    if (role === sourceRole) continue
    applyModelChoiceFromValue(srcModel, roleRows.value[role])
    if (includeThinking) applyThinkingChoiceFromValue(srcThinking, roleRows.value[role])
  }
  scheduleRunDefaultsSave()
}

watch(
  () => wsPath.value,
  (p) => {
    if (!p) return
    void loadWorkspaceRunDefaults()
  },
  { immediate: true }
)

watch(
  () => codexModels.value.map((m) => m.model).join('|'),
  () => {
    if (!wsPath.value) return
    void loadWorkspaceRunDefaults()
  }
)

watch(roleRows, () => scheduleRunDefaultsSave(), { deep: true })

// --- House style ---
const houseStyle = ref('')
const houseStyleError = ref<string | null>(null)
const houseStyleSavedAt = ref<string | null>(null)

async function loadHouseStyle() {
  if (!wsPath.value) return
  houseStyleError.value = null
  try {
    houseStyle.value = await window.codexDesigner!.readTextFile(wsPath.value, '.codex-designer/share/house-style.md')
  } catch {
    houseStyle.value = ''
  }
}

async function saveHouseStyle() {
  if (!wsPath.value) return
  houseStyleError.value = null
  try {
    await window.codexDesigner!.writeTextFile(wsPath.value, '.codex-designer/share/house-style.md', houseStyle.value || '')
    houseStyleSavedAt.value = new Date().toISOString()
  } catch (e) {
    houseStyleError.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => workspaceSheetOpen.value,
  (open) => {
    if (!open) return
    void loadHouseStyle()
  }
)

// --- Profiles modal (copied from WorkspacePage) ---
type WorkspaceProfilesFile = {
  version: 1
  updatedAt: string
  profiles: Array<{
    id: 'careful' | 'yolo'
    label: string
    threadOptions: {
      sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'
      approvalPolicy: 'never' | 'on-request' | 'on-failure' | 'untrusted'
      networkAccessEnabled: boolean
    }
  }>
}

const profilesOpen = ref(false)
const profilesLoading = ref(false)
const profilesError = ref<string | null>(null)
const profiles = ref<WorkspaceProfilesFile | null>(null)

const carefulProfile = computed(() => profiles.value?.profiles.find((p) => p.id === 'careful') ?? null)
const yoloProfile = computed(() => profiles.value?.profiles.find((p) => p.id === 'yolo') ?? null)

async function loadProfiles() {
  if (!wsPath.value) return
  profilesLoading.value = true
  profilesError.value = null
  try {
    const raw = await window.codexDesigner?.readTextFile?.(wsPath.value, '.codex-designer/share/profiles.json')
    if (!raw) throw new Error('profiles.json not found.')
    const parsed = JSON.parse(raw) as WorkspaceProfilesFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
      throw new Error('Invalid profiles.json (expected version: 1).')
    }
    const ensure = (id: 'careful' | 'yolo', defaults: WorkspaceProfilesFile['profiles'][number]) => {
      let found = parsed.profiles.find((p) => p.id === id) ?? null
      if (!found) {
        parsed.profiles.push(defaults)
        found = defaults
      }
      found.label = typeof found.label === 'string' ? found.label : defaults.label
      found.threadOptions = { ...defaults.threadOptions, ...(found.threadOptions ?? {}) }
    }
    ensure('careful', {
      id: 'careful',
      label: 'Careful',
      threadOptions: { sandboxMode: 'workspace-write', approvalPolicy: 'on-failure', networkAccessEnabled: false },
    })
    ensure('yolo', {
      id: 'yolo',
      label: 'YOLO',
      threadOptions: { sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccessEnabled: true },
    })
    profiles.value = parsed
  } catch (e) {
    profiles.value = null
    profilesError.value = e instanceof Error ? e.message : String(e)
  } finally {
    profilesLoading.value = false
  }
}

async function openProfiles() {
  profilesOpen.value = true
  await loadProfiles()
}

async function saveProfiles() {
  if (!wsPath.value || !profiles.value) return
  profilesError.value = null
  try {
    profiles.value.updatedAt = new Date().toISOString()
    const raw = JSON.stringify(profiles.value, null, 2) + '\n'
    await window.codexDesigner?.writeTextFile?.(wsPath.value, '.codex-designer/share/profiles.json', raw)
    await openWorkspace(wsPath.value)
    await loadProfiles()
    profilesOpen.value = false
  } catch (e) {
    profilesError.value = e instanceof Error ? e.message : String(e)
  }
}

async function exportProfiles() {
  if (!wsPath.value) return
  await window.codexDesigner?.exportProfiles?.(wsPath.value)
}

async function importProfiles() {
  if (!wsPath.value) return
  await window.codexDesigner?.importProfiles?.(wsPath.value)
  await openWorkspace(wsPath.value)
}

// --- Runner playground (migrated from SettingsPage) ---
const runnerProfileId = ref<'careful' | 'yolo'>('careful')
const runnerModelChoice = ref<string>('default')
const runnerModelCustom = ref<string>('')
const runnerModelValue = computed(() => {
  if (runnerModelChoice.value === 'default') return ''
  if (runnerModelChoice.value === 'custom') return runnerModelCustom.value.trim()
  return runnerModelChoice.value
})
const runnerThinkingChoice = ref<'default' | ModelReasoningEffort>('default')
const runnerThinkingValue = computed(() => {
  if (runnerThinkingChoice.value === 'default') return ''
  return runnerThinkingChoice.value
})
const runnerPrompt = ref<string>('Summarize this repository and suggest the next 3 improvements.')
const runnerRunId = ref<string | null>(null)
const runnerRun = computed(() => getRun(runnerRunId.value))
const runnerBusy = computed(() => runnerRun.value?.status === 'running')

async function startRunner() {
  if (!wsPath.value) return
  const runId = await startRun({
    workspacePath: wsPath.value,
    role: 'generic',
    profileId: runnerProfileId.value,
    model: runnerModelValue.value || undefined,
    modelReasoningEffort: runnerThinkingValue.value || undefined,
    input: runnerPrompt.value,
    uiAction: 'workspace-runner',
  })
  runnerRunId.value = runId
}

async function stopRunner() {
  if (!runnerRunId.value) return
  await abortRun(runnerRunId.value)
}

// --- Git panel ---
const gitBusy = ref(false)
const gitOutput = ref<{ title: string; stdout: string; stderr: string; exitCode: number } | null>(null)
const gitBranchesLoading = ref(false)
const gitBranches = ref<string[]>([])
const gitCurrentBranch = ref<string | null>(null)

const checkoutBranch = ref<string>('')
const newBranchName = ref<string>('')
const newBranchBase = ref<string>('')
const mergeSource = ref<string>('')

async function refreshGitBranches() {
  if (!wsPath.value) return
  if (!activeWorkspace.value?.isGitRepo) return
  gitBranchesLoading.value = true
  try {
    const res = await window.codexDesigner?.gitListBranches?.(wsPath.value)
    gitCurrentBranch.value = res?.current ?? null
    gitBranches.value = Array.isArray(res?.branches) ? res!.branches : []
    if (!checkoutBranch.value) checkoutBranch.value = gitCurrentBranch.value ?? ''
    if (!newBranchBase.value) newBranchBase.value = gitCurrentBranch.value ?? ''
    if (!mergeSource.value) mergeSource.value = ''
  } finally {
    gitBranchesLoading.value = false
  }
}

async function runGit(title: string, fn: () => Promise<{ stdout: string; stderr: string; exitCode: number }>) {
  if (!wsPath.value) return
  gitBusy.value = true
  gitOutput.value = null
  try {
    const res = await fn()
    gitOutput.value = { title, ...res }
    await refreshWorkspace()
    await refreshGitBranches()
  } finally {
    gitBusy.value = false
  }
}

async function gitFetch() {
  await runGit('Fetch', () => window.codexDesigner!.gitFetch(wsPath.value))
}

async function gitPull() {
  const ok = window.confirm('Run `git pull`? This may change your working tree.')
  if (!ok) return
  await runGit('Pull', () => window.codexDesigner!.gitPull(wsPath.value))
}

async function gitPush() {
  const ok = window.confirm('Run `git push`? This will push commits to the configured remote.')
  if (!ok) return
  await runGit('Push', () => window.codexDesigner!.gitPush(wsPath.value))
}

async function gitCheckoutBranch() {
  const name = String(checkoutBranch.value ?? '').trim()
  if (!name) return
  const ok = window.confirm(`Checkout branch "${name}"?`)
  if (!ok) return
  await runGit(`Checkout ${name}`, () => window.codexDesigner!.gitCheckout(wsPath.value, name))
}

async function gitCreateNewBranch() {
  const name = String(newBranchName.value ?? '').trim()
  if (!name) return
  const base = String(newBranchBase.value ?? '').trim()
  const ok = window.confirm(base ? `Create branch "${name}" from "${base}"?` : `Create branch "${name}"?`)
  if (!ok) return
  await runGit(`Create branch ${name}`, () => window.codexDesigner!.gitCreateBranch(wsPath.value, name, base || undefined))
  newBranchName.value = ''
}

async function gitMergeBranch() {
  const src = String(mergeSource.value ?? '').trim()
  if (!src) return
  const ok = window.confirm(`Merge "${src}" into the current branch?`)
  if (!ok) return
  await runGit(`Merge ${src}`, () => window.codexDesigner!.gitMerge(wsPath.value, src))
}

watch(
  () => workspaceSheetOpen.value,
  (open) => {
    if (!open) return
    void refreshGitBranches()
  }
)
</script>

<template>
  <div v-if="workspaceSheetOpen" class="fixed inset-0 z-50">
    <button class="absolute inset-0 bg-black/40" type="button" aria-label="Close workspace settings" @click="close"></button>

    <aside
      class="absolute right-0 top-0 flex h-full w-full max-w-[98vw] flex-col border-l border-gray-200 bg-gray-50 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
      aria-label="Workspace settings"
    >
      <div
        class="flex items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-3 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/70"
      >
        <div class="min-w-0">
          <div class="truncate text-sm font-black">Workspace settings</div>
          <div class="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{{ wsPath }}</div>
        </div>

        <div class="flex flex-none items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            :disabled="!activeWorkspace"
            @click="openInVsCode"
          >
            <span class="material-symbols-rounded text-[18px]">code</span>
            VS Code
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            :disabled="!activeWorkspace || loading"
            @click="refreshWorkspace"
          >
            <span class="material-symbols-rounded text-[18px]">refresh</span>
            Refresh
          </button>
          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            aria-label="Close"
            @click="close"
          >
            <span class="material-symbols-rounded text-[20px]">close</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div
          v-if="error"
          class="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
        >
          {{ error }}
        </div>

        <div v-if="!activeWorkspace" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
          No workspace selected.
        </div>

        <div v-else class="space-y-4">
          <div
            v-if="vsCodeResult && !vsCodeResult.ok"
            class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          >
            VS Code open failed: {{ vsCodeResult.error || 'Unknown error' }}
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start gap-3">
              <span class="material-symbols-rounded text-[22px] text-brand-500">hub</span>
              <div class="min-w-0">
                <h3 class="text-base font-black tracking-tight">Workspace status</h3>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Git status and workspace-scoped configuration.
                </p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Git</div>
                <div class="mt-1 text-sm font-bold">
                  <span v-if="activeWorkspace.isGitRepo">Repo detected</span>
                  <span v-else>Not a git repo</span>
                </div>
                <div class="mt-2 text-xs text-gray-600 dark:text-gray-300">
                  <div v-if="activeWorkspace.isGitRepo">
                    <div>Clean: {{ activeWorkspace.isGitClean ? 'yes' : 'no' }}</div>
                    <div v-if="activeWorkspace.headCommit" class="mt-1 font-mono">
                      HEAD: {{ activeWorkspace.headCommit.slice(0, 10) }}
                    </div>
                  </div>
                  <div v-else>Initialize git to unlock git-aware workflows.</div>
                </div>

                <button
                  v-if="!activeWorkspace.isGitRepo"
                  class="mt-3 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  type="button"
                  :disabled="loading"
                  @click="initGit"
                >
                  <span class="material-symbols-rounded text-[18px]">terminal</span>
                  Init git
                </button>
              </div>

              <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Shareability</div>
                <div class="mt-1 text-sm font-bold">
                  <span v-if="activeWorkspace.shareability === 'local'">Local only</span>
                  <span v-else-if="activeWorkspace.shareability === 'shareable'">Shareable in repo</span>
                  <span v-else>Not set</span>
                </div>
                <p class="mt-2 text-xs text-gray-600 dark:text-gray-300">
                  Controls whether `.codex-designer/share/` is committed to the repo.
                </p>

                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      activeWorkspace.shareability === 'local'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                    "
                    type="button"
                    :disabled="loading"
                    @click="setWorkspaceShareability('local')"
                  >
                    <span class="material-symbols-rounded text-[18px]">person</span>
                    Local only
                  </button>

                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      activeWorkspace.shareability === 'shareable'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                    "
                    type="button"
                    :disabled="loading"
                    @click="setWorkspaceShareability('shareable')"
                  >
                    <span class="material-symbols-rounded text-[18px]">group</span>
                    Shareable
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Git panel</div>
                <div class="mt-1 text-sm font-bold">Fetch / Pull / Push · Branches · Merge</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Shows stdout/stderr (no conflict UI).
                </p>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                type="button"
                :disabled="gitBusy || !activeWorkspace.isGitRepo"
                @click="refreshGitBranches"
              >
                <span class="material-symbols-rounded text-[18px]">sync</span>
                Refresh branches
              </button>
            </div>

            <div v-if="!activeWorkspace.isGitRepo" class="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              Initialize git to use the Git panel.
            </div>

            <div v-else class="mt-4 space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                  type="button"
                  :disabled="gitBusy"
                  @click="gitFetch"
                >
                  <span class="material-symbols-rounded text-[18px]">sync</span>
                  Fetch
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  type="button"
                  :disabled="gitBusy"
                  @click="gitPull"
                >
                  <span class="material-symbols-rounded text-[18px]">download</span>
                  Pull
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  type="button"
                  :disabled="gitBusy"
                  @click="gitPush"
                >
                  <span class="material-symbols-rounded text-[18px]">upload</span>
                  Push
                </button>
              </div>

              <div class="grid gap-3 lg:grid-cols-3">
                <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Checkout</div>
                  <div class="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    Current: <span class="font-mono">{{ gitCurrentBranch || '(unknown)' }}</span>
                  </div>
                  <select
                    v-model="checkoutBranch"
                    class="mt-3 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    :disabled="gitBusy || gitBranchesLoading"
                  >
                    <option value="">Select branch…</option>
                    <option v-for="b in gitBranches" :key="b" :value="b">{{ b }}</option>
                  </select>
                  <button
                    class="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="gitBusy || !checkoutBranch"
                    @click="gitCheckoutBranch"
                  >
                    <span class="material-symbols-rounded text-[18px]">swap_horiz</span>
                    Checkout
                  </button>
                </div>

                <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Create branch</div>
                  <input
                    v-model="newBranchName"
                    type="text"
                    placeholder="new branch name"
                    class="mt-3 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    :disabled="gitBusy"
                  />
                  <select
                    v-model="newBranchBase"
                    class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    :disabled="gitBusy || gitBranchesLoading"
                  >
                    <option value="">Base: (current)</option>
                    <option v-for="b in gitBranches" :key="b" :value="b">Base: {{ b }}</option>
                  </select>
                  <button
                    class="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="gitBusy || !newBranchName.trim().length"
                    @click="gitCreateNewBranch"
                  >
                    <span class="material-symbols-rounded text-[18px]">add</span>
                    Create
                  </button>
                </div>

                <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Merge</div>
                  <select
                    v-model="mergeSource"
                    class="mt-3 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    :disabled="gitBusy || gitBranchesLoading"
                  >
                    <option value="">Select branch to merge…</option>
                    <option v-for="b in gitBranches" :key="b" :value="b">{{ b }}</option>
                  </select>
                  <button
                    class="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 shadow-sm transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                    type="button"
                    :disabled="gitBusy || !mergeSource"
                    @click="gitMergeBranch"
                  >
                    <span class="material-symbols-rounded text-[18px]">merge</span>
                    Merge
                  </button>
                </div>
              </div>

              <div
                v-if="gitOutput"
                class="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm font-black">{{ gitOutput.title }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">exit: {{ gitOutput.exitCode }}</div>
                </div>
                <div v-if="gitOutput.stdout.trim().length" class="mt-3">
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">stdout</div>
                  <pre class="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-mono text-[11px] dark:bg-gray-950">{{ gitOutput.stdout }}</pre>
                </div>
                <div v-if="gitOutput.stderr.trim().length" class="mt-3">
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">stderr</div>
                  <pre class="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-mono text-[11px] dark:bg-gray-950">{{ gitOutput.stderr }}</pre>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Run defaults</div>
                <div class="mt-1 text-sm font-bold">Default model + thinking</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Used by Planning / Implementation / Testing / Generic / New work runs in this workspace.
                </p>
              </div>

              <button
                class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                type="button"
                :disabled="modelsLoading"
                @click="refreshModels(true)"
              >
                <span class="material-symbols-rounded text-[18px]">refresh</span>
                Refresh models
              </button>
            </div>

            <ModelsInspector :models="codexModels" :loading="modelsLoading" :error="modelsError || runDefaultsError" @refresh="refreshModels" />

            <div class="mt-4 grid gap-3 lg:grid-cols-2">
              <div
                v-for="role in defaultRoles"
                :key="role"
                class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="text-sm font-black capitalize">{{ role }}</div>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                      type="button"
                      @click="applyModelFrom(role, false)"
                    >
                      Apply model
                    </button>
                    <button
                      class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                      type="button"
                      @click="applyModelFrom(role, true)"
                    >
                      Apply model + thinking
                    </button>
                  </div>
                </div>

                <div class="mt-3 space-y-3">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model</div>
                    <select
                      v-model="roleRows[role].modelChoice"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                      :disabled="loading"
                    >
                      <option value="default">Default model</option>
                      <option v-for="m in codexModels" :key="m.model" :value="m.model">
                        {{ m.displayName }}{{ m.isDefault ? ' (default)' : '' }}
                      </option>
                      <option value="custom">Custom…</option>
                    </select>

                    <input
                      v-if="roleRows[role].modelChoice === 'custom'"
                      v-model="roleRows[role].modelCustom"
                      type="text"
                      placeholder="model id"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                      :disabled="loading"
                    />
                  </div>

                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking level</div>
                    <select
                      v-model="roleRows[role].thinkingChoice"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                      :disabled="loading"
                    >
                      <option value="default">Default</option>
                      <option value="minimal">Minimal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">XHigh</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">House style</div>
                <div class="mt-1 text-sm font-bold">Markdown guidance</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Stored at `.codex-designer/share/house-style.md` and injected into planning + implementation prompts.
                </p>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
                type="button"
                @click="saveHouseStyle"
              >
                <span class="material-symbols-rounded text-[18px]">save</span>
                Save
              </button>
            </div>

            <div v-if="houseStyleError" class="mt-3 text-xs font-semibold text-red-700 dark:text-red-200">
              {{ houseStyleError }}
            </div>
            <div v-if="houseStyleSavedAt" class="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              Saved: {{ houseStyleSavedAt }}
            </div>

            <div class="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Editor</div>
                <AutoGrowTextarea
                  v-model="houseStyle"
                  :min-rows="8"
                  :max-rows="30"
                  class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                />
              </div>
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Preview</div>
                <div class="mt-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <MarkdownViewer :markdown="houseStyle" />
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Profiles</div>
                <div class="mt-1 text-sm font-bold">Careful / YOLO runner settings</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Stored in `.codex-designer/share/profiles.json`.
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  type="button"
                  @click="importProfiles"
                >
                  <span class="material-symbols-rounded text-[18px]">upload</span>
                  Import
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  type="button"
                  @click="exportProfiles"
                >
                  <span class="material-symbols-rounded text-[18px]">download</span>
                  Export
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
                  type="button"
                  @click="openProfiles"
                >
                  <span class="material-symbols-rounded text-[18px]">tune</span>
                  Edit
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start gap-3">
              <span class="material-symbols-rounded text-[22px] text-brand-500">terminal</span>
              <div class="min-w-0">
                <h3 class="text-base font-black tracking-tight">Runner playground</h3>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Streams Codex SDK events.
                </p>
              </div>
            </div>

            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <div class="space-y-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Profile</div>
                  <select
                    v-model="runnerProfileId"
                    class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="runnerBusy"
                  >
                    <option value="careful">Careful</option>
                    <option value="yolo">YOLO</option>
                  </select>
                </div>

                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model (optional)</div>
                  <select
                    v-model="runnerModelChoice"
                    class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="runnerBusy"
                  >
                    <option value="default">Default model</option>
                    <option v-for="m in codexModels" :key="m.model" :value="m.model">
                      {{ m.displayName }}{{ m.isDefault ? ' (default)' : '' }}
                    </option>
                    <option value="custom">Custom…</option>
                  </select>

                  <input
                    v-if="runnerModelChoice === 'custom'"
                    v-model="runnerModelCustom"
                    type="text"
                    placeholder="model id"
                    class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="runnerBusy"
                  />
                </div>

                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking level</div>
                  <select
                    v-model="runnerThinkingChoice"
                    class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="runnerBusy"
                  >
                    <option value="default">Default</option>
                    <option value="minimal">Minimal</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">XHigh</option>
                  </select>
                </div>

                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Prompt</div>
                  <AutoGrowTextarea
                    v-model="runnerPrompt"
                    :min-rows="6"
                    class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="runnerBusy"
                  />
                </div>

                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="!runnerPrompt.trim().length || runnerBusy"
                    @click="startRunner"
                  >
                    <span class="material-symbols-rounded text-[18px]">play_arrow</span>
                    Run
                  </button>

                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    :disabled="!runnerBusy"
                    @click="stopRunner"
                  >
                    <span class="material-symbols-rounded text-[18px]">stop</span>
                    Stop
                  </button>
                </div>
              </div>

              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Events</div>
                <div class="mt-2">
                  <RunEventStream
                    v-if="runnerRun"
                    :events="runnerRun.events"
                    :status="runnerRun.status"
                    :started-at="runnerRun.startedAt"
                    :ended-at="runnerRun.endedAt"
                    :meta="{
                      profileId: runnerRun.profileId,
                      model: runnerRun.model,
                      modelReasoningEffort: runnerRun.modelReasoningEffort,
                      sandboxMode: runnerRun.sandboxMode,
                      approvalPolicy: runnerRun.approvalPolicy,
                      networkAccessEnabled: runnerRun.networkAccessEnabled,
                      oneShotNetwork: runnerRun.oneShotNetwork,
                    }"
                    :max-events="100"
                  />
                  <div
                    v-else
                    class="mt-2 h-[420px] rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400"
                  >
                    Run to stream events…
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Profiles modal -->
    <div v-if="profilesOpen" class="fixed inset-0 z-[60]">
      <button class="absolute inset-0 bg-black/50" type="button" @click="profilesOpen = false"></button>
      <div class="absolute left-1/2 top-1/2 w-[min(780px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Profiles</div>
            <div class="mt-1 text-lg font-black tracking-tight">Runner profiles</div>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Controls sandbox, approvals, and tool-network for Careful/YOLO.
            </p>
          </div>
          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            aria-label="Close"
            @click="profilesOpen = false"
          >
            <span class="material-symbols-rounded text-[20px]">close</span>
          </button>
        </div>

        <div v-if="profilesLoading" class="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
          Loading profiles…
        </div>

        <div v-else class="mt-4 space-y-4">
          <div
            v-if="profilesError"
            class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          >
            {{ profilesError }}
          </div>

          <div v-if="profiles && carefulProfile && yoloProfile" class="grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <div class="flex items-center gap-2 text-sm font-black">
                <span class="material-symbols-rounded text-[18px] text-brand-500">verified</span>
                {{ carefulProfile.label }}
              </div>

              <div class="mt-3 space-y-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Label</div>
                  <input
                    v-model="carefulProfile.label"
                    type="text"
                    class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                  />
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Sandbox</div>
                    <select
                      v-model="carefulProfile.threadOptions.sandboxMode"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    >
                      <option value="read-only">Read-only</option>
                      <option value="workspace-write">Workspace write</option>
                      <option value="danger-full-access">Danger full access</option>
                    </select>
                  </div>

                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Approvals</div>
                    <select
                      v-model="carefulProfile.threadOptions.approvalPolicy"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    >
                      <option value="on-request">On request</option>
                      <option value="on-failure">On failure</option>
                      <option value="untrusted">Untrusted</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                </div>

                <label class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Tool network</div>
                    <div class="text-xs text-gray-600 dark:text-gray-300">Allows tools/commands to use the network.</div>
                  </div>
                  <input
                    v-model="carefulProfile.threadOptions.networkAccessEnabled"
                    type="checkbox"
                    class="h-4 w-4 accent-brand-600"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <div class="flex items-center gap-2 text-sm font-black">
                <span class="material-symbols-rounded text-[18px] text-brand-500">bolt</span>
                {{ yoloProfile.label }}
              </div>

              <div class="mt-3 space-y-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Label</div>
                  <input
                    v-model="yoloProfile.label"
                    type="text"
                    class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                  />
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Sandbox</div>
                    <select
                      v-model="yoloProfile.threadOptions.sandboxMode"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    >
                      <option value="read-only">Read-only</option>
                      <option value="workspace-write">Workspace write</option>
                      <option value="danger-full-access">Danger full access</option>
                    </select>
                  </div>

                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Approvals</div>
                    <select
                      v-model="yoloProfile.threadOptions.approvalPolicy"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    >
                      <option value="on-request">On request</option>
                      <option value="on-failure">On failure</option>
                      <option value="untrusted">Untrusted</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                </div>

                <label class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Tool network</div>
                    <div class="text-xs text-gray-600 dark:text-gray-300">Allows tools/commands to use the network.</div>
                  </div>
                  <input
                    v-model="yoloProfile.threadOptions.networkAccessEnabled"
                    type="checkbox"
                    class="h-4 w-4 accent-brand-600"
                  />
                </label>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              type="button"
              @click="profilesOpen = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
              type="button"
              :disabled="!profiles"
              @click="saveProfiles"
            >
              <span class="material-symbols-rounded text-[18px]">save</span>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
