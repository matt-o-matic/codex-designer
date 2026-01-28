<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppState } from '../lib/appState'
import { useRunStore } from '../lib/runStore'

const { activeWorkspace } = useAppState()
const { startRun, abortRun, getRun } = useRunStore()

const profileId = ref<'careful' | 'yolo'>('careful')
const model = ref<string>('')
const prompt = ref<string>('Summarize this repository and suggest the next 3 improvements.')

const selectedRunId = ref<string | null>(null)

const runRecord = computed(() => getRun(selectedRunId.value))
const isBusy = computed(() => runRecord.value?.status === 'running')
const canRun = computed(() => !!activeWorkspace.value && !!prompt.value.trim() && !isBusy.value)

function pretty(e: unknown): string {
  try {
    return JSON.stringify(e, null, 2)
  } catch {
    return String(e)
  }
}

async function start() {
  if (!activeWorkspace.value) return
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    role: 'generic',
    profileId: profileId.value,
    model: model.value.trim() || undefined,
    input: prompt.value,
  })
  selectedRunId.value = runId
}

async function stop() {
  if (!selectedRunId.value) return
  await abortRun(selectedRunId.value)
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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

    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
            <input
              v-model="model"
              type="text"
              placeholder="Leave blank for default"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
              :disabled="isBusy"
            />
          </div>

          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Prompt</div>
            <textarea
              v-model="prompt"
              rows="6"
              class="mt-2 w-full resize-none rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
              :disabled="isBusy"
            ></textarea>
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
          <div
            class="mt-2 h-[420px] overflow-auto rounded-2xl border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          >
            <div v-if="!runRecord?.events?.length" class="text-gray-500 dark:text-gray-400">
              Run to stream events…
            </div>
            <pre v-for="(e, idx) in runRecord?.events ?? []" :key="idx" class="whitespace-pre-wrap break-words">
{{ pretty(e) }}
</pre
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
