<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppState } from '../lib/appState'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import type { ModelReasoningEffort } from '../lib/runStore'

const {
  appState,
  activeWorkspace,
  loading,
  error,
  refreshAppState,
  openWorkspace,
  setWorkspaceShareability,
  initGit,
} = useAppState()

const router = useRouter()

const recent = computed(() => appState.value?.recentWorkspacePaths ?? [])

type WorkspaceRunDefaults = {
  model?: string
  modelReasoningEffort?: ModelReasoningEffort | ''
}

type WorkspaceRunDefaultsByRole = {
  planning?: WorkspaceRunDefaults
  implementation?: WorkspaceRunDefaults
  newWork?: WorkspaceRunDefaults
}

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

const planningModelChoice = ref<string>('default')
const planningModelCustom = ref<string>('')
const planningModelValue = computed(() => {
  if (planningModelChoice.value === 'default') return ''
  if (planningModelChoice.value === 'custom') return planningModelCustom.value.trim()
  return planningModelChoice.value
})
const planningThinkingChoice = ref<'default' | ModelReasoningEffort>('default')
const planningThinkingValue = computed(() => {
  if (planningThinkingChoice.value === 'default') return ''
  return planningThinkingChoice.value
})

const implementationModelChoice = ref<string>('default')
const implementationModelCustom = ref<string>('')
const implementationModelValue = computed(() => {
  if (implementationModelChoice.value === 'default') return ''
  if (implementationModelChoice.value === 'custom') return implementationModelCustom.value.trim()
  return implementationModelChoice.value
})
const implementationThinkingChoice = ref<'default' | ModelReasoningEffort>('default')
const implementationThinkingValue = computed(() => {
  if (implementationThinkingChoice.value === 'default') return ''
  return implementationThinkingChoice.value
})

const newWorkModelChoice = ref<string>('default')
const newWorkModelCustom = ref<string>('')
const newWorkModelValue = computed(() => {
  if (newWorkModelChoice.value === 'default') return ''
  if (newWorkModelChoice.value === 'custom') return newWorkModelCustom.value.trim()
  return newWorkModelChoice.value
})
const newWorkThinkingChoice = ref<'default' | ModelReasoningEffort>('default')
const newWorkThinkingValue = computed(() => {
  if (newWorkThinkingChoice.value === 'default') return ''
  return newWorkThinkingChoice.value
})

function applyModelChoiceFromValue(
  modelValue: string | undefined,
  targetChoice: { value: string },
  targetCustom: { value: string }
) {
  const raw = String(modelValue ?? '').trim()
  if (!raw) {
    targetChoice.value = 'default'
    targetCustom.value = ''
    return
  }
  const known = codexModels.value.some((m) => m.model === raw)
  if (known) {
    targetChoice.value = raw
    targetCustom.value = ''
    return
  }
  targetChoice.value = 'custom'
  targetCustom.value = raw
}

function applyThinkingChoiceFromValue(value: string | undefined, targetChoice: { value: 'default' | ModelReasoningEffort }) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    targetChoice.value = 'default'
    return
  }
  const allowed: Array<ModelReasoningEffort> = ['minimal', 'low', 'medium', 'high', 'xhigh']
  if (allowed.includes(raw as ModelReasoningEffort)) {
    targetChoice.value = raw as ModelReasoningEffort
    return
  }
  targetChoice.value = 'default'
}

let suppressWorkspaceRunDefaultsAutosave = false
let workspaceRunDefaultsSaveTimer: number | null = null
const workspaceRunDefaultsError = ref<string | null>(null)

async function loadWorkspaceRunDefaults(workspacePath: string) {
  try {
    const defaults = (await window.codexDesigner?.getWorkspaceRunDefaults?.(workspacePath)) as WorkspaceRunDefaultsByRole | null
    suppressWorkspaceRunDefaultsAutosave = true

    applyModelChoiceFromValue(defaults?.planning?.model, planningModelChoice, planningModelCustom)
    applyThinkingChoiceFromValue(defaults?.planning?.modelReasoningEffort, planningThinkingChoice)

    applyModelChoiceFromValue(defaults?.implementation?.model, implementationModelChoice, implementationModelCustom)
    applyThinkingChoiceFromValue(defaults?.implementation?.modelReasoningEffort, implementationThinkingChoice)

    applyModelChoiceFromValue(defaults?.newWork?.model, newWorkModelChoice, newWorkModelCustom)
    applyThinkingChoiceFromValue(defaults?.newWork?.modelReasoningEffort, newWorkThinkingChoice)
  } finally {
    queueMicrotask(() => {
      suppressWorkspaceRunDefaultsAutosave = false
    })
  }
}

async function saveWorkspaceRunDefaults() {
  if (!activeWorkspace.value) return
  const payload: WorkspaceRunDefaultsByRole = {
    planning: { model: planningModelValue.value || '', modelReasoningEffort: (planningThinkingValue.value as ModelReasoningEffort | '') || '' },
    implementation: {
      model: implementationModelValue.value || '',
      modelReasoningEffort: (implementationThinkingValue.value as ModelReasoningEffort | '') || '',
    },
    newWork: { model: newWorkModelValue.value || '', modelReasoningEffort: (newWorkThinkingValue.value as ModelReasoningEffort | '') || '' },
  }
  await window.codexDesigner?.setWorkspaceRunDefaults?.(activeWorkspace.value.path, payload)
}

function scheduleWorkspaceRunDefaultsSave() {
  if (!activeWorkspace.value) return
  if (suppressWorkspaceRunDefaultsAutosave) return
  if (workspaceRunDefaultsSaveTimer) window.clearTimeout(workspaceRunDefaultsSaveTimer)
  workspaceRunDefaultsSaveTimer = window.setTimeout(() => {
    workspaceRunDefaultsSaveTimer = null
    workspaceRunDefaultsError.value = null
    void saveWorkspaceRunDefaults().catch((e) => {
      workspaceRunDefaultsError.value = e instanceof Error ? e.message : String(e)
    })
  }, 400)
}

async function loadProfiles() {
  if (!activeWorkspace.value) return
  profilesLoading.value = true
  profilesError.value = null
  try {
    const raw = await window.codexDesigner?.readTextFile?.(activeWorkspace.value.path, '.codex-designer/share/profiles.json')
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
  if (!activeWorkspace.value || !profiles.value) return
  profilesError.value = null
  try {
    profiles.value.updatedAt = new Date().toISOString()
    const raw = JSON.stringify(profiles.value, null, 2) + '\n'
    await window.codexDesigner?.writeTextFile?.(activeWorkspace.value.path, '.codex-designer/share/profiles.json', raw)
    await openWorkspace(activeWorkspace.value.path)
    await loadProfiles()
  } catch (e) {
    profilesError.value = e instanceof Error ? e.message : String(e)
  }
}

async function exportProfiles() {
  if (!activeWorkspace.value) return
  await window.codexDesigner?.exportProfiles?.(activeWorkspace.value.path)
}

async function importProfiles() {
  if (!activeWorkspace.value) return
  await window.codexDesigner?.importProfiles?.(activeWorkspace.value.path)
  await openWorkspace(activeWorkspace.value.path)
  await loadProfiles()
}

async function chooseWorkspace() {
  try {
    const picked = await window.codexDesigner?.pickWorkspace?.()
    if (!picked) return
    await openWorkspace(picked)
  }
  catch {
    // error is already captured in store
  }
}

function openFeature(slug: string) {
  router.push(`/session/${encodeURIComponent(slug)}?tab=planning`)
}

onMounted(() => {
  refreshAppState()
  void refreshModels()
})

watch(
  () => activeWorkspace.value?.path ?? null,
  (p) => {
    if (!p) return
    void loadWorkspaceRunDefaults(p).catch(() => {})
  },
  { immediate: true }
)

watch(
  () => codexModels.value.map((m) => m.model).join('|'),
  () => {
    if (!activeWorkspace.value) return
    void loadWorkspaceRunDefaults(activeWorkspace.value.path).catch(() => {})
  }
)

watch(
  () => ({
    planning: { model: planningModelValue.value, thinking: planningThinkingValue.value },
    implementation: { model: implementationModelValue.value, thinking: implementationThinkingValue.value },
    newWork: { model: newWorkModelValue.value, thinking: newWorkThinkingValue.value },
  }),
  () => scheduleWorkspaceRunDefaultsSave(),
  { deep: true }
)
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">folder</span>
        <div class="min-w-0">
          <h2 class="text-lg font-black tracking-tight">Workspace</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Choose a repo folder to plan, implement, and test features.
          </p>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
          type="button"
          @click="chooseWorkspace"
        >
          <span class="material-symbols-rounded text-[18px]">drive_folder_upload</span>
          Pick workspace
        </button>

        <div
          v-if="activeWorkspace"
          class="min-w-0 flex-1 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-950 dark:text-gray-200"
        >
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Active workspace
          </div>
          <div class="mt-1 truncate font-mono text-xs">{{ activeWorkspace.path }}</div>
        </div>
      </div>

      <div
        v-if="error"
        class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
      >
        {{ error }}
      </div>
    </div>

    <div
      v-if="recent.length"
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">history</span>
        <div class="min-w-0">
          <h3 class="text-base font-black tracking-tight">Recent</h3>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">Quickly reopen a workspace.</p>
        </div>
      </div>

      <div class="mt-4 grid gap-2">
        <button
          v-for="p in recent"
          :key="p"
          class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          type="button"
          :disabled="loading"
          @click="openWorkspace(p)"
        >
          <span class="truncate font-mono text-xs">{{ p }}</span>
          <span class="material-symbols-rounded text-[18px] text-gray-400">chevron_right</span>
        </button>
      </div>
    </div>

    <div
      v-if="activeWorkspace"
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">hub</span>
        <div class="min-w-0">
          <h3 class="text-base font-black tracking-tight">Workspace status</h3>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Git status and per-workspace codex-designer settings.
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
            <div v-else>Codex SDK prefers a git repo. You can initialize git here.</div>
          </div>

          <button
            v-if="!activeWorkspace.isGitRepo"
            class="mt-3 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            :disabled="loading"
            @click="initGit"
          >
            <span class="material-symbols-rounded text-[18px]">fork_right</span>
            git init
          </button>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Profiles</div>
          <div class="mt-1 text-sm font-bold">Workspace shareability</div>
          <p class="mt-2 text-xs text-gray-600 dark:text-gray-300">
            Choose whether `.codex-designer/share/` should be commit-friendly or gitignored.
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
              Shareable in repo
            </button>
          </div>

          <p v-if="!activeWorkspace.shareability" class="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-200">
            Choose one to finish workspace setup.
          </p>

          <div class="mt-4 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Runner profiles</div>
                <div class="mt-1 text-sm font-bold">Careful / YOLO settings</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Stored in `.codex-designer/share/profiles.json`. Import/export to reuse settings across workspaces.
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
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Run defaults</div>
            <div class="mt-1 text-sm font-bold">Default model + thinking level</div>
            <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Used for Planning / Implementation / New work runs in this workspace.
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

        <div
          v-if="modelsError || workspaceRunDefaultsError"
          class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
        >
          {{ workspaceRunDefaultsError || modelsError }}
        </div>

        <div class="mt-4 grid gap-3 lg:grid-cols-3">
          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-center gap-2 text-sm font-black">
              <span class="material-symbols-rounded text-[18px] text-brand-500">chat</span>
              Planning
            </div>

            <div class="mt-3 space-y-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model</div>
                <select
                  v-model="planningModelChoice"
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
                  v-if="planningModelChoice === 'custom'"
                  v-model="planningModelCustom"
                  type="text"
                  placeholder="model id"
                  class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                  :disabled="loading"
                />
              </div>

              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking</div>
                <select
                  v-model="planningThinkingChoice"
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

          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-center gap-2 text-sm font-black">
              <span class="material-symbols-rounded text-[18px] text-brand-500">build</span>
              Implementation
            </div>

            <div class="mt-3 space-y-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model</div>
                <select
                  v-model="implementationModelChoice"
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
                  v-if="implementationModelChoice === 'custom'"
                  v-model="implementationModelCustom"
                  type="text"
                  placeholder="model id"
                  class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                  :disabled="loading"
                />
              </div>

              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking</div>
                <select
                  v-model="implementationThinkingChoice"
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

          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-center gap-2 text-sm font-black">
              <span class="material-symbols-rounded text-[18px] text-brand-500">add_circle</span>
              New work
            </div>

            <div class="mt-3 space-y-3">
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model</div>
                <select
                  v-model="newWorkModelChoice"
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
                  v-if="newWorkModelChoice === 'custom'"
                  v-model="newWorkModelCustom"
                  type="text"
                  placeholder="model id"
                  class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                  :disabled="loading"
                />
              </div>

              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking</div>
                <select
                  v-model="newWorkThinkingChoice"
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

      <div class="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Features</div>
            <div class="mt-1 text-sm font-bold">{{ activeWorkspace.features.length }} found</div>
          </div>
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            :disabled="loading"
            @click="openWorkspace(activeWorkspace.path)"
          >
            <span class="material-symbols-rounded text-[18px]">refresh</span>
            Refresh
          </button>
        </div>

        <div v-if="activeWorkspace.features.length" class="mt-3 grid gap-2">
          <button
            v-for="f in activeWorkspace.features"
            :key="f.slug"
            class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
            type="button"
            :disabled="loading"
            @click="openFeature(f.slug)"
          >
            <div class="min-w-0">
              <div class="truncate font-black">{{ f.slug }}</div>
              <div class="mt-0.5 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                {{ f.planPath }}
              </div>
            </div>
            <span class="material-symbols-rounded text-[18px] text-gray-400">chevron_right</span>
          </button>
        </div>

        <div v-else class="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-300">
          No features found yet. Create a plan to generate `docs/*.plan.md`.
        </div>
      </div>
    </div>

    <!-- Profiles modal -->
    <div v-if="profilesOpen" class="fixed inset-0 z-50">
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
