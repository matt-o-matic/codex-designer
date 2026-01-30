<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppState } from '../lib/appState'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import { useRunStore, type ModelReasoningEffort } from '../lib/runStore'
import AutoGrowTextarea from '../components/AutoGrowTextarea.vue'
import RunEventStream from '../components/RunEventStream.vue'
import ModelsInspector from '../components/ModelsInspector.vue'

const { activeWorkspace } = useAppState()
const { startRun, abortRun, getRun } = useRunStore()

const profileId = ref<'careful' | 'yolo'>('careful')
const modelChoice = ref<string>('default')
const modelCustom = ref<string>('')
const modelValue = computed(() => {
  if (modelChoice.value === 'default') return ''
  if (modelChoice.value === 'custom') return modelCustom.value.trim()
  return modelChoice.value
})
const thinkingChoice = ref<'default' | ModelReasoningEffort>('default')
const thinkingValue = computed(() => {
  if (thinkingChoice.value === 'default') return ''
  return thinkingChoice.value
})
const prompt = ref<string>('Summarize this repository and suggest the next 3 improvements.')

const selectedRunId = ref<string | null>(null)

const codexModels = ref<CodexModelInfo[]>([])
const modelsLoading = ref(false)
const modelsError = ref<string | null>(null)

const runRecord = computed(() => getRun(selectedRunId.value))
const isBusy = computed(() => runRecord.value?.status === 'running')
const canRun = computed(() => !!activeWorkspace.value && !!prompt.value.trim() && !isBusy.value)

async function start() {
  if (!activeWorkspace.value) return
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    role: 'generic',
    profileId: profileId.value,
    model: modelValue.value || undefined,
    modelReasoningEffort: thinkingValue.value || undefined,
    input: prompt.value,
  })
  selectedRunId.value = runId
}

async function stop() {
  if (!selectedRunId.value) return
  await abortRun(selectedRunId.value)
}

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
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">tune</span>
        <div class="min-w-0">
          <h2 class="text-lg font-black tracking-tight">Settings</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            (v1 scaffold) Global defaults and a Codex SDK runner playground.
          </p>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">terminal</span>
        <div class="min-w-0">
          <h3 class="text-base font-black tracking-tight">Runner playground</h3>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Streams Codex SDK events. Requires a selected workspace.
          </p>
        </div>
      </div>

      <div v-if="!activeWorkspace" class="mt-4 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
        Select a workspace first (Workspace tab).
      </div>

      <div v-else class="mt-4 grid gap-4 md:grid-cols-2">
        <div class="space-y-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Profile</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                :class="
                  profileId === 'careful'
                    ? 'bg-brand-600 text-white shadow-brand-600/20'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                "
                type="button"
                :disabled="isBusy"
                @click="profileId = 'careful'"
              >
                <span class="material-symbols-rounded text-[18px]">verified</span>
                Careful
              </button>
              <button
                class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                :class="
                  profileId === 'yolo'
                    ? 'bg-brand-600 text-white shadow-brand-600/20'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                "
                type="button"
                :disabled="isBusy"
                @click="profileId = 'yolo'"
              >
                <span class="material-symbols-rounded text-[18px]">bolt</span>
                YOLO
              </button>
            </div>
          </div>

          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Model (optional)</div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <select
                v-model="modelChoice"
                class="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                :disabled="isBusy"
              >
                <option value="default">Default model</option>
                <option v-for="m in codexModels" :key="m.model" :value="m.model">
                  {{ m.displayName }}{{ m.isDefault ? ' (default)' : '' }}
                </option>
                <option value="custom">Custom…</option>
              </select>

              <input
                v-if="modelChoice === 'custom'"
                v-model="modelCustom"
                type="text"
                placeholder="model id"
                class="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                :disabled="isBusy"
              />
            </div>

            <div class="mt-3">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Thinking level</div>
              <select
                v-model="thinkingChoice"
                class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                :disabled="isBusy"
              >
                <option value="default">Default</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </select>
            </div>

            <ModelsInspector
              :models="codexModels"
              :loading="modelsLoading"
              :error="modelsError"
              @refresh="refreshModels"
            />
          </div>

          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Prompt</div>
            <AutoGrowTextarea
              v-model="prompt"
              :min-rows="6"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
              :disabled="isBusy"
            />
          </div>

          <div class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
              type="button"
              :disabled="!canRun"
              @click="start"
            >
              <span class="material-symbols-rounded text-[18px]">play_arrow</span>
              Run
            </button>

            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
              type="button"
              :disabled="!isBusy"
              @click="stop"
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
              v-if="runRecord"
              :events="runRecord.events"
              :status="runRecord.status"
              :started-at="runRecord.startedAt"
              :ended-at="runRecord.endedAt"
              :meta="{
                profileId: runRecord.profileId,
                model: runRecord.model,
                modelReasoningEffort: runRecord.modelReasoningEffort,
                sandboxMode: runRecord.sandboxMode,
                approvalPolicy: runRecord.approvalPolicy,
                networkAccessEnabled: runRecord.networkAccessEnabled,
                oneShotNetwork: runRecord.oneShotNetwork,
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
</template>
