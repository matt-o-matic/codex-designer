<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAppState } from '../lib/appState'
import { useNewFeatureUi } from '../lib/newFeatureUi'
import { type ModelReasoningEffort, useRunStore } from '../lib/runStore'
import { useWorkbenchUi } from '../lib/workbenchUi'
import { parseLenientJson } from '../lib/json'
import { assertValidPlanningPlanMarkdown } from '../lib/planning'
import { buildPlanningCreatePrompt } from '../lib/prompts'
import { createEmptyQnaStateV1, normalizeQnaStateV1, renderQnaMarkdownFromState, type QnaStateV1 } from '../lib/qnaState'

const { openWorkspace } = useAppState()
const { selectSession, setWorkspaceExpanded } = useWorkbenchUi()
const { newFeatureOpen, newFeatureWorkspacePath, closeNewFeature } = useNewFeatureUi()
const { startRun, getRun } = useRunStore()

const slugInput = ref<HTMLInputElement | null>(null)

const slug = ref('')
const brief = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitRunId = ref<string | null>(null)
const submitRun = computed(() => getRun(submitRunId.value))
const newFeatureModel = ref('')
const newFeatureThinking = ref<ModelReasoningEffort | ''>('')

type WorkspaceRunDefaults = { model?: string; modelReasoningEffort?: ModelReasoningEffort | '' }
type WorkspaceRunDefaultsByRole = {
  planning?: WorkspaceRunDefaults
  implementation?: WorkspaceRunDefaults
  testing?: WorkspaceRunDefaults
  generic?: WorkspaceRunDefaults
  newWork?: WorkspaceRunDefaults
}
const allowedThinking: Array<ModelReasoningEffort> = ['minimal', 'low', 'medium', 'high', 'xhigh']

function normalizeThinking(value: unknown): ModelReasoningEffort | '' {
  const raw = String(value ?? '').trim()
  if (allowedThinking.includes(raw as ModelReasoningEffort)) return raw as ModelReasoningEffort
  return ''
}

async function loadNewFeatureRunDefaults(workspacePath: string) {
  newFeatureModel.value = ''
  newFeatureThinking.value = ''
  try {
    const defaults = (await window.codexDesigner?.getWorkspaceRunDefaults?.(workspacePath)) as WorkspaceRunDefaultsByRole | null
    const applied = defaults?.newWork ?? defaults?.planning
    if (!applied) return
    newFeatureModel.value = String(applied.model ?? '').trim()
    newFeatureThinking.value = normalizeThinking(applied.modelReasoningEffort)
  } catch {
    // ignore
  }
}

const QNA_OPTION_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    text: { type: 'string' },
    recommended: { type: 'boolean' },
  },
  required: ['key', 'text', 'recommended'],
  additionalProperties: false,
} as const

const QNA_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    createdAt: { type: 'string' },
    selectedKey: { type: 'string' },
    notes: { type: 'string' },
    attachments: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'createdAt', 'selectedKey', 'notes', 'attachments'],
  additionalProperties: false,
} as const

const QNA_QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    prompt: { type: 'string' },
    options: { type: 'array', items: QNA_OPTION_SCHEMA },
    recommendedKey: { type: 'string' },
    answers: { type: 'array', items: QNA_ANSWER_SCHEMA },
  },
  required: ['id', 'prompt', 'options', 'recommendedKey', 'answers'],
  additionalProperties: false,
} as const

const QNA_ROUND_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    questions: { type: 'array', items: QNA_QUESTION_SCHEMA },
  },
  required: ['id', 'title', 'questions'],
  additionalProperties: false,
} as const

const QNA_STATE_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    featureSlug: { type: 'string' },
    updatedAt: { type: 'string' },
    rounds: { type: 'array', items: QNA_ROUND_SCHEMA },
  },
  required: ['version', 'featureSlug', 'updatedAt', 'rounds'],
  additionalProperties: false,
} as const

const PLAN_CREATE_SCHEMA = {
  type: 'object',
  properties: {
    planMarkdown: { type: 'string' },
    qna: QNA_STATE_SCHEMA,
  },
  required: ['planMarkdown', 'qna'],
  additionalProperties: false,
} as const

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRunDone(runId: string, timeoutMs = 6 * 60 * 60 * 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = getRun(runId)
    if (r && r.status !== 'running') return r
    await sleep(250)
  }
  throw new Error('Timed out waiting for run to complete.')
}

function sanitizeSlug(raw: string): string {
  return String(raw ?? '').trim()
}

function isValidSlug(value: string): boolean {
  if (!value.length) return false
  if (value.includes('/') || value.includes('\\\\')) return false
  if (value.includes('..')) return false
  if (/\\s/.test(value)) return false
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)
}

async function readHouseStyle(workspacePath: string): Promise<string> {
  try {
    return (await window.codexDesigner?.readTextFile?.(workspacePath, '.codex-designer/share/house-style.md')) ?? ''
  } catch {
    return ''
  }
}

async function createFeature() {
  if (submitting.value) return
  const workspacePath = String(newFeatureWorkspacePath.value ?? '').trim()
  if (!workspacePath) return

  const nextSlug = sanitizeSlug(slug.value)
  if (!isValidSlug(nextSlug)) {
    submitError.value = 'Enter a valid feature slug (letters/numbers, hyphen/underscore).'
    return
  }

  submitting.value = true
  submitError.value = null
  submitRunId.value = null

  try {
    const briefText = String(brief.value ?? '').trim()

    // 1. Create stub artifacts immediately
    const stubQnaState: QnaStateV1 = createEmptyQnaStateV1(nextSlug)
    const stubPlan = `# ${nextSlug} — Plan

Related Q&A: \`docs/${nextSlug}.qna.md\`

## Initial Plan

Codex is generating the initial plan and Q&A...
`
    const stubQnaMd = renderQnaMarkdownFromState(stubQnaState)

    await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.qna.json`, JSON.stringify(stubQnaState, null, 2) + '\n')
    await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.qna.md`, stubQnaMd)
    await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.plan.md`, stubPlan)

    // 2. Switch to the session
    await openWorkspace(workspacePath)
    setWorkspaceExpanded(workspacePath, true)
    selectSession(workspacePath, nextSlug)
    closeNewFeature()

    // 3. Start background generation (run)
    // We do NOT await this part to block the UI, but we catch errors to show them via toast?
    // Since closeNewFeature() is called, this component might unmount.
    // However, Vue component methods continue to execute even if the component is unmounted,
    // as long as we don't access reactive state that has been destroyed.
    // But validation/setup is done, so we are safe to run this detached.
    
    // We capture necessary variables in closure
    const houseStyleMarkdown = await readHouseStyle(workspacePath)
    const prompt = buildPlanningCreatePrompt({
      featureSlug: nextSlug,
      brief: briefText,
      houseStyleMarkdown,
    })

    startRun({
      workspacePath,
      featureSlug: nextSlug,
      role: 'planning',
      profileId: 'yolo',
      model: newFeatureModel.value || undefined,
      modelReasoningEffort: newFeatureThinking.value || undefined,
      input: prompt,
      outputSchema: PLAN_CREATE_SCHEMA,
      uiAction: 'planning-create',
      uiUserMessage: `Create feature: ${nextSlug}${briefText.length ? `\n\n${briefText}` : ''}`,
    }).then(async (runId) => {
      // NOTE: We do not set submitRunId.value here because the modal is closed.
      const rec = await waitForRunDone(runId)
      if (rec.status !== 'completed') throw new Error(rec.error ?? 'Planning run failed.')
      if (!rec.finalResponse) throw new Error('No structured output received.')

      const parsedRes = parseLenientJson(rec.finalResponse)
      if (!parsedRes) throw new Error('Failed to parse structured output.')
      const parsed = parsedRes.value as { planMarkdown: string; qna: QnaStateV1 }
      const qnaState = normalizeQnaStateV1(parsed.qna).state
      const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
      assertValidPlanningPlanMarkdown(plan, nextSlug)
      const qnaMd = renderQnaMarkdownFromState(qnaState)

      await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.qna.json`, JSON.stringify(qnaState, null, 2) + '\n')
      await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.qna.md`, qnaMd)
      await window.codexDesigner!.writeTextFile(workspacePath, `docs/${nextSlug}.plan.md`, plan)
      
      // Notify UI to reload artifacts
      window.dispatchEvent(new CustomEvent('codex-designer:artifacts-updated'))
    }).catch((e) => {
      console.error('Values creation background run failed:', e)
      // Ideally show a toast here, but we don't have access to global toast system easily unless we import it
    })

  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e)
    submitting.value = false
  }
}

function close() {
  if (submitting.value) return
  closeNewFeature()
}

watch(
  () => newFeatureOpen.value,
  async (open) => {
    if (!open) return
    submitError.value = null
    submitRunId.value = null
    submitting.value = false
    slug.value = ''
    brief.value = ''
    const workspacePath = String(newFeatureWorkspacePath.value ?? '').trim()
    await loadNewFeatureRunDefaults(workspacePath)
    await nextTick()
    slugInput.value?.focus()
  }
)
</script>

<template>
  <div v-if="newFeatureOpen" class="fixed inset-0 z-50">
    <button class="absolute inset-0 bg-black/50" type="button" :disabled="submitting" @click="close"></button>

    <div class="absolute left-1/2 top-8 w-[min(720px,calc(100vw-2rem))] -translate-x-1/2">
      <div class="rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <div class="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="material-symbols-rounded text-[22px] text-brand-500">add</span>
              <div class="text-sm font-black">New feature</div>
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Generates `docs/&lt;slug&gt;.plan.md` + `docs/&lt;slug&gt;.qna.json` + `docs/&lt;slug&gt;.qna.md`.
            </div>
          </div>
          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
            type="button"
            aria-label="Close"
            :disabled="submitting"
            @click="close"
          >
            <span class="material-symbols-rounded text-[20px]">close</span>
          </button>
        </div>

        <div class="space-y-4 px-5 py-4">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Feature slug</div>
            <input
              ref="slugInput"
              v-model="slug"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
              placeholder="e.g. usability-enhancements"
              :disabled="submitting"
              @keydown.enter.prevent="createFeature"
            />
          </div>

          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Brief (optional)</div>
            <textarea
              v-model="brief"
              class="mt-2 min-h-[120px] w-full resize-y rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
              placeholder="A short description to seed the plan and Q&A."
              :disabled="submitting"
            ></textarea>
          </div>

          <div
            v-if="submitError"
            class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          >
            {{ submitError }}
          </div>

          <div v-if="submitRun" class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            <div class="font-mono">run: {{ submitRun.runId }}</div>
            <div class="mt-1">status: {{ submitRun.status }}</div>
            <div v-if="submitRun.error" class="mt-1 text-red-700 dark:text-red-200">{{ submitRun.error }}</div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
            type="button"
            :disabled="submitting"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
            type="button"
            :disabled="submitting || !slug.trim().length"
            @click="createFeature"
          >
            <span class="material-symbols-rounded text-[18px]" aria-hidden="true">{{
              submitting ? 'progress_activity' : 'play_arrow'
            }}</span>
            {{ submitting ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
