<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import {
  buildImplementationFollowupPrompt,
  buildImplementationPrompt,
  buildPlanningNextRoundPrompt,
} from '../lib/prompts'
import {
  normalizeQnaStateV1,
  parseQnaStateJson,
  renderQnaMarkdownFromState,
  type QnaAnswerRevisionV1,
  type QnaQuestionV1,
  type QnaRoundV1,
  type QnaStateV1,
} from '../lib/qnaState'
import { useRunStore, type ModelReasoningEffort, type RunRecord } from '../lib/runStore'
import { createEmptyTestPlan, ensureRound, renderTestMarkdown, type TestPlan, type TestRound, type TestStatus } from '../lib/tests'
import { useWorkbenchUi, type SessionMode } from '../lib/workbenchUi'
import AutoGrowTextarea from './AutoGrowTextarea.vue'
import AttachmentPreviews from './AttachmentPreviews.vue'
import TimelineCard from './timeline/TimelineCard.vue'
import DocumentCard from './timeline/DocumentCard.vue'
import RunCard from './timeline/RunCard.vue'
import ToastHost from './ToastHost.vue'

const props = defineProps<{
  workspacePath: string
  featureSlug: string
}>()

const { activeMode, setActiveMode } = useWorkbenchUi()
const mode = computed(() => activeMode.value)

function setMode(next: SessionMode) {
  setActiveMode(props.workspacePath, props.featureSlug, next)
}

type ToastItem = { id: string; message: string }
const toasts = ref<ToastItem[]>([])
let toastCounter = 0

function showToast(message: string, ttlMs = 1800) {
  const id = `${Date.now()}-${toastCounter++}`
  toasts.value = [...toasts.value, { id, message }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, ttlMs)
}

function shortWorkspaceLabel(p: string): string {
  const normalized = (p ?? '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized || p
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

type ModeConfig = {
  profileId: 'careful' | 'yolo'
  modelChoice: string
  modelCustom: string
  thinkingChoice: 'default' | ModelReasoningEffort
  oneShotNetwork: boolean
}

const configs = ref<Record<SessionMode, ModeConfig>>({
  planning: { profileId: 'yolo', modelChoice: 'default', modelCustom: '', thinkingChoice: 'default', oneShotNetwork: false },
  implementation: { profileId: 'yolo', modelChoice: 'default', modelCustom: '', thinkingChoice: 'default', oneShotNetwork: false },
  testing: { profileId: 'yolo', modelChoice: 'default', modelCustom: '', thinkingChoice: 'default', oneShotNetwork: false },
})

const dockTargetOverride = ref<'current' | SessionMode>('current')
const targetMode = computed<SessionMode>(() => (dockTargetOverride.value === 'current' ? mode.value : dockTargetOverride.value))
const targetConfig = computed(() => configs.value[targetMode.value])

function modelValue(cfg: ModeConfig): string {
  if (cfg.modelChoice === 'default') return ''
  if (cfg.modelChoice === 'custom') return cfg.modelCustom.trim()
  return cfg.modelChoice
}

function thinkingValue(cfg: ModeConfig): ModelReasoningEffort | '' {
  if (cfg.thinkingChoice === 'default') return ''
  return cfg.thinkingChoice
}

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

function applyModelChoiceFromValue(model: string | undefined, cfg: ModeConfig) {
  const raw = String(model ?? '').trim()
  if (!raw) {
    cfg.modelChoice = 'default'
    cfg.modelCustom = ''
    return
  }
  const known = codexModels.value.some((m) => m.model === raw)
  if (known) {
    cfg.modelChoice = raw
    cfg.modelCustom = ''
    return
  }
  cfg.modelChoice = 'custom'
  cfg.modelCustom = raw
}

function applyThinkingChoiceFromValue(value: string | undefined, cfg: ModeConfig) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    cfg.thinkingChoice = 'default'
    return
  }
  const allowed: Array<ModelReasoningEffort> = ['minimal', 'low', 'medium', 'high', 'xhigh']
  if (allowed.includes(raw as ModelReasoningEffort)) {
    cfg.thinkingChoice = raw as ModelReasoningEffort
    return
  }
  cfg.thinkingChoice = 'default'
}

type WorkspaceRunDefaults = { model?: string; modelReasoningEffort?: ModelReasoningEffort | '' }
type WorkspaceRunDefaultsByRole = { planning?: WorkspaceRunDefaults; implementation?: WorkspaceRunDefaults; testing?: WorkspaceRunDefaults }

async function loadWorkspaceRunDefaults() {
  try {
    const defaults = (await window.codexDesigner?.getWorkspaceRunDefaults?.(props.workspacePath)) as WorkspaceRunDefaultsByRole | null
    if (!defaults) return
    applyModelChoiceFromValue(defaults.planning?.model, configs.value.planning)
    applyThinkingChoiceFromValue(defaults.planning?.modelReasoningEffort, configs.value.planning)

    applyModelChoiceFromValue(defaults.implementation?.model, configs.value.implementation)
    applyThinkingChoiceFromValue(defaults.implementation?.modelReasoningEffort, configs.value.implementation)

    applyModelChoiceFromValue(defaults.testing?.model, configs.value.testing)
    applyThinkingChoiceFromValue(defaults.testing?.modelReasoningEffort, configs.value.testing)
  } catch {
    // ignore (defaults are optional)
  }
}

const artifactsLoading = ref(false)
const planMarkdown = ref('')
const planLoadError = ref<string | null>(null)
const qnaMarkdown = ref('')
const qnaLoadError = ref<string | null>(null)
const qnaState = shallowRef<QnaStateV1 | null>(null)
const qnaLocked = ref(false)
const qnaPlanNotes = ref('')
const qnaPlanNotesError = ref<string | null>(null)

const qnaRoundOpen = ref<Record<string, boolean>>({})
const qnaEditOpen = ref<Record<string, boolean>>({})
const draftSelected = ref<Record<string, string>>({})
const draftNotes = ref<Record<string, string>>({})

const qnaRounds = computed(() => qnaState.value?.rounds ?? [])
const qnaComplete = computed(() => {
  const rounds = qnaRounds.value
  if (!rounds.length) return false
  const last = rounds[rounds.length - 1]
  return (last?.questions?.length ?? 0) === 0
})

const testPlan = ref<TestPlan | null>(null)
const testLoadError = ref<string | null>(null)
const testMarkdown = computed(() => (testPlan.value ? renderTestMarkdown(testPlan.value) : ''))

// NOTE: This must be defined before the immediate watch() that calls loadRunLogs(),
// otherwise we'll hit the temporal-dead-zone for this ref.
const runLogsLoading = ref(false)
const runLogsById = ref<Record<string, { meta: any; events: unknown[] }>>({})

const houseStyleMarkdown = ref('')

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function stripCodeFences(text: string): string {
  const trimmed = (text ?? '').trim()
  const m = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*)\n```$/)
  return m ? m[1] : text
}

function extractWorkspaceImagePaths(markdown: string): string[] {
  const raw = String(markdown ?? '')
  const matches = raw.match(/docs\/assets\/[^\s)\]]+/g) ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    const cleaned = m.replace(/[)\\],.]+$/g, '')
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
  }
  return out
}

function inputWithImages(
  text: string,
  images: string[]
): string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> {
  const uniq = Array.from(new Set(images.filter((p) => typeof p === 'string' && p.trim().length)))
  if (!uniq.length) return text
  return [{ type: 'text', text }, ...uniq.map((p) => ({ type: 'local_image' as const, path: p }))]
}

async function loadHouseStyle() {
  try {
    houseStyleMarkdown.value = await window.codexDesigner!.readTextFile(props.workspacePath, '.codex-designer/share/house-style.md')
  } catch {
    houseStyleMarkdown.value = ''
  }
}

async function loadArtifacts() {
  if (!props.workspacePath || !props.featureSlug) return
  artifactsLoading.value = true
  planLoadError.value = null
  qnaLoadError.value = null
  testLoadError.value = null
  qnaLocked.value = false

  try {
    planMarkdown.value = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.plan.md`)
  } catch (e) {
    planMarkdown.value = ''
    planLoadError.value = e instanceof Error ? e.message : String(e)
  }

  let loadedQna: QnaStateV1 | null = null
  try {
    const raw = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`)
    const parsed = parseQnaStateJson(raw)
    if (!parsed) throw new Error('Invalid Q&A JSON (expected version: 1).')
    const norm = normalizeQnaStateV1(parsed)
    loadedQna = norm.state
    if (norm.changed) {
      await window.codexDesigner!.writeTextFile(
        props.workspacePath,
        `docs/${props.featureSlug}.qna.json`,
        JSON.stringify(loadedQna, null, 2) + '\\n'
      )
    }
  } catch (e) {
    loadedQna = null
    qnaLoadError.value = e instanceof Error ? e.message : String(e)
  }

  if (loadedQna) {
    try {
      qnaMarkdown.value = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`)
    } catch {
      qnaMarkdown.value = renderQnaMarkdownFromState(loadedQna)
      await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, qnaMarkdown.value)
    }
  } else {
    qnaMarkdown.value = ''
  }

  qnaState.value = loadedQna
  qnaPlanNotes.value = String(loadedQna?.notes ?? '')

  try {
    const raw = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.test.json`)
    testPlan.value = JSON.parse(raw) as TestPlan
  } catch {
    testPlan.value = createEmptyTestPlan(props.featureSlug)
    testLoadError.value = null
  }
  if (testPlan.value) ensureRound(testPlan.value)

  try {
    const rawState = await window.codexDesigner!.readTextFile(props.workspacePath, `.codex-designer/cache/state.json`)
    const parsed = JSON.parse(rawState) as any
    const implThreadId = parsed?.features?.[props.featureSlug]?.implementationThreadId
    qnaLocked.value = typeof implThreadId === 'string' && implThreadId.trim().length > 0
  } catch {
    qnaLocked.value = false
  }

  await loadHouseStyle()

  artifactsLoading.value = false
}

watch(
  () => [props.workspacePath, props.featureSlug],
  () => {
    void loadArtifacts()
    void loadWorkspaceRunDefaults()
    void loadRunLogs()
  },
  { immediate: true }
)

watch(
  () => codexModels.value.map((m) => m.model).join('|'),
  () => void loadWorkspaceRunDefaults()
)

function resetQnaRoundOpen() {
  const rounds = qnaRounds.value
  const next: Record<string, boolean> = {}
  for (const r of rounds) next[r.id] = false
  if (rounds.length) next[rounds[rounds.length - 1].id] = true
  qnaRoundOpen.value = next
}

watch(
  () => qnaState.value,
  (state) => {
    if (!state) {
      qnaRoundOpen.value = {}
      qnaEditOpen.value = {}
      draftSelected.value = {}
      draftNotes.value = {}
      return
    }

    resetQnaRoundOpen()

    const nextSelected: Record<string, string> = {}
    const nextNotes: Record<string, string> = {}
    const nextEdit: Record<string, boolean> = {}

    for (const round of state.rounds) {
      for (const q of round.questions) {
        const cur = q.answers.length ? q.answers[q.answers.length - 1] : null
        nextSelected[q.id] = cur?.selectedKey ?? ''
        nextNotes[q.id] = cur?.notes ?? ''
        nextEdit[q.id] = q.answers.length === 0
      }
    }

    draftSelected.value = nextSelected
    draftNotes.value = nextNotes
    qnaEditOpen.value = nextEdit
  },
  { immediate: true }
)

function selectedOptionText(q: QnaQuestionV1, key: string): string {
  const upper = String(key ?? '').trim().toUpperCase()
  const found = q.options.find((o) => String(o.key).toUpperCase() === upper)
  return found ? found.text : ''
}

function inferredSelectedKey(q: QnaQuestionV1): string {
  const draft = String(draftSelected.value[q.id] ?? '').trim().toUpperCase()
  if (draft) return draft
  const cur = q.answers.length ? q.answers[q.answers.length - 1] : null
  return cur?.selectedKey ?? q.recommendedKey
}

function inferredNotes(q: QnaQuestionV1): string {
  const draft = String(draftNotes.value[q.id] ?? '')
  if (draft.trim().length) return draft
  const cur = q.answers.length ? q.answers[q.answers.length - 1] : null
  return cur?.notes ?? ''
}

function toggleRound(id: string) {
  qnaRoundOpen.value = { ...qnaRoundOpen.value, [id]: !qnaRoundOpen.value[id] }
}

function toggleQuestionEdit(q: QnaQuestionV1) {
  if (qnaLocked.value) return
  qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: !qnaEditOpen.value[q.id] }
  if (!qnaEditOpen.value[q.id]) {
    // reset drafts when closing
    const cur = q.answers.length ? q.answers[q.answers.length - 1] : null
    draftSelected.value = { ...draftSelected.value, [q.id]: cur?.selectedKey ?? '' }
    draftNotes.value = { ...draftNotes.value, [q.id]: cur?.notes ?? '' }
  }
}

async function saveQnaPlanNotes() {
  if (!qnaState.value) return
  if (qnaLocked.value) return
  const nextNotes = String(qnaPlanNotes.value ?? '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').trimEnd()
  const curNotes = String(qnaState.value.notes ?? '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').trimEnd()
  if (nextNotes === curNotes) return

  const nextState: QnaStateV1 = structuredClone(qnaState.value)
  nextState.notes = nextNotes
  nextState.updatedAt = new Date().toISOString()

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\\n')
  const md = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, md)
  qnaState.value = nextState
  qnaMarkdown.value = md
}

async function saveQnaAnswer(q: QnaQuestionV1) {
  if (!qnaState.value) return
  if (qnaLocked.value) return

  const selectedKey = inferredSelectedKey(q)
  const notes = String(inferredNotes(q) ?? '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').trimEnd()
  const attachments = extractWorkspaceImagePaths(notes)
  const now = new Date().toISOString()

  const nextState: QnaStateV1 = structuredClone(qnaState.value)
  nextState.updatedAt = now

  for (const round of nextState.rounds) {
    for (const qq of round.questions) {
      if (qq.id !== q.id) continue
      const rev: QnaAnswerRevisionV1 = {
        id: `rev-${(qq.answers?.length ?? 0) + 1}`,
        createdAt: now,
        selectedKey,
        notes,
        attachments,
      }
      qq.answers = [...(qq.answers ?? []), rev]
    }
  }

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\\n')
  const md = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, md)
  qnaState.value = nextState
  qnaMarkdown.value = md

  qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: false }
  showToast('Answer saved')
}

function getResult(round: TestRound, testId: string) {
  if (!round.results[testId]) {
    round.results[testId] = { status: 'not_run', feedback: [{ text: '', attachments: [] }] }
  } else if (!round.results[testId].feedback.length) {
    round.results[testId].feedback.push({ text: '', attachments: [] })
  }
  return round.results[testId]
}

async function setTestStatus(round: TestRound, testId: string, status: string) {
  const allowed: TestStatus[] = ['not_run', 'pass', 'fail', 'deferred', 'blocked']
  if (!allowed.includes(status as TestStatus)) return
  getResult(round, testId).status = status as TestStatus
  await saveTestPlan()
}

async function saveTestPlan() {
  if (!testPlan.value) return
  const json = JSON.stringify(testPlan.value, null, 2) + '\\n'
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.test.json`, json)
  const md = renderTestMarkdown(testPlan.value)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.test.md`, md)
}

async function startTestingRound() {
  if (!testPlan.value) return
  const nextIndex = testPlan.value.rounds.length + 1
  testPlan.value.rounds.push({ id: `round-${nextIndex}`, startedAt: new Date().toISOString(), results: {} })
  ensureRound(testPlan.value)
  await saveTestPlan()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRunDone(runId: string, timeoutMs = LONG_RUN_TIMEOUT_MS) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = getRun(runId)
    if (r && r.status !== 'running') return r
    await sleep(250)
  }
  throw new Error('Timed out waiting for run to complete.')
}

const { runs, startRun, abortRun, getRun } = useRunStore()
const sessionRuns = computed(() => {
  return Object.values(runs.value ?? {}).filter((r) => r.workspacePath === props.workspacePath && r.featureSlug === props.featureSlug)
})

function isRoleBusy(role: SessionMode): boolean {
  return sessionRuns.value.some((r) => r.status === 'running' && r.role === role)
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

const PLAN_NEXT_ROUND_SCHEMA = {
  type: 'object',
  properties: {
    planMarkdown: { type: 'string' },
    qnaRound: QNA_ROUND_SCHEMA,
  },
  required: ['planMarkdown', 'qnaRound'],
  additionalProperties: false,
} as const

const LONG_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000

async function applyPlanningNextRoundOutput(runId: string) {
  const rec = await waitForRunDone(runId)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Planning run failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')

  const parsed = JSON.parse(stripCodeFences(rec.finalResponse)) as { planMarkdown: string; qnaRound: QnaRoundV1 }
  const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\\r\\n/g, '\\n'))
  const qnaRound = parsed.qnaRound

  const raw = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`)
  const existing = parseQnaStateJson(raw)
  if (!existing) throw new Error('Failed to read existing Q&A JSON state.')

  const nextState: QnaStateV1 = {
    ...existing,
    updatedAt: new Date().toISOString(),
    rounds: [...existing.rounds, qnaRound],
  }

  const normalized = normalizeQnaStateV1(nextState).state
  const qnaMd = renderQnaMarkdownFromState(normalized)

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(normalized, null, 2) + '\\n')
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, qnaMd)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.plan.md`, plan)

  await loadArtifacts()
}

async function runNextPlanningRound() {
  if (qnaLocked.value) return
  if (isRoleBusy('planning')) return
  if (!qnaState.value) return
  if (qnaComplete.value) return

  await loadHouseStyle()

  qnaPlanNotesError.value = null
  try {
    await saveQnaPlanNotes()
  } catch (e) {
    qnaPlanNotesError.value = e instanceof Error ? e.message : String(e)
    return
  }

  const nextRoundNumber = (qnaState.value?.rounds?.length ?? 0) + 1
  const images = extractWorkspaceImagePaths(qnaMarkdown.value)

  const prompt = buildPlanningNextRoundPrompt({
    featureSlug: props.featureSlug,
    nextRoundNumber,
    additionalNotes: qnaPlanNotes.value,
    houseStyleMarkdown: houseStyleMarkdown.value,
  })

  const runId = await startRun({
    workspacePath: props.workspacePath,
    featureSlug: props.featureSlug,
    role: 'planning',
    profileId: configs.value.planning.profileId,
    model: modelValue(configs.value.planning) || undefined,
    modelReasoningEffort: (thinkingValue(configs.value.planning) as ModelReasoningEffort | '') || undefined,
    oneShotNetwork: configs.value.planning.profileId === 'careful' ? configs.value.planning.oneShotNetwork : undefined,
    input: inputWithImages(prompt, images),
    outputSchema: PLAN_NEXT_ROUND_SCHEMA,
    uiAction: 'planning-next-round',
  })

  configs.value.planning.oneShotNetwork = false
  void applyPlanningNextRoundOutput(runId).catch((e) => {
    console.error(e)
    showToast(e instanceof Error ? e.message : String(e))
  })
}

const TEST_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          expected: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'description', 'steps', 'expected', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['tests'],
  additionalProperties: false,
} as const

async function generateTests() {
  if (!props.workspacePath || !props.featureSlug) return
  if (isRoleBusy('testing')) return

  const runId = await startRun({
    workspacePath: props.workspacePath,
    featureSlug: props.featureSlug,
    role: 'testing',
    profileId: configs.value.testing.profileId,
    model: modelValue(configs.value.testing) || undefined,
    modelReasoningEffort: (thinkingValue(configs.value.testing) as ModelReasoningEffort | '') || undefined,
    oneShotNetwork: configs.value.testing.profileId === 'careful' ? configs.value.testing.oneShotNetwork : undefined,
    input: `Generate a set of key manual tests for the feature "${props.featureSlug}". Use docs/${props.featureSlug}.plan.md and docs/${props.featureSlug}.qna.md as the source of truth. Output JSON that matches the provided schema.`,
    outputSchema: TEST_GENERATION_SCHEMA,
    uiAction: 'testing-generate-tests',
  })

  configs.value.testing.oneShotNetwork = false

  const rec = await waitForRunDone(runId)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Test generation failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')

  const parsed = JSON.parse(rec.finalResponse) as { tests: any[] }
  const plan = createEmptyTestPlan(props.featureSlug)
  plan.generatedAt = new Date().toISOString()
  plan.tests = (parsed.tests ?? []).map((t, idx) => ({
    id: String(t.id || `T${idx + 1}`),
    title: String(t.title || `Test ${idx + 1}`),
    description: t.description ? String(t.description) : undefined,
    steps: Array.isArray(t.steps) ? t.steps.map((s: any) => String(s)) : [],
    expected: String(t.expected || ''),
    tags: Array.isArray(t.tags) ? t.tags.map((s: any) => String(s)) : undefined,
  }))
  ensureRound(plan)
  testPlan.value = plan
  await saveTestPlan()
  showToast('Tests generated')
}

async function runImplementation() {
  if (isRoleBusy('implementation')) return
  await loadHouseStyle()
  const images = extractWorkspaceImagePaths(`${planMarkdown.value}\\n\\n${qnaMarkdown.value}`)
  const prompt = buildImplementationPrompt({ featureSlug: props.featureSlug, houseStyleMarkdown: houseStyleMarkdown.value })

  const runId = await startRun({
    workspacePath: props.workspacePath,
    featureSlug: props.featureSlug,
    role: 'implementation',
    profileId: configs.value.implementation.profileId,
    model: modelValue(configs.value.implementation) || undefined,
    modelReasoningEffort: (thinkingValue(configs.value.implementation) as ModelReasoningEffort | '') || undefined,
    oneShotNetwork:
      configs.value.implementation.profileId === 'careful' ? configs.value.implementation.oneShotNetwork : undefined,
    input: inputWithImages(prompt, images),
    uiAction: 'implementation-plan',
  })

  configs.value.implementation.oneShotNetwork = false
  showToast(`Run started (${runId.slice(0, 8)}…)`)
}

const composerExpanded = ref(false)
const composerText = ref('')

function canSendComposer(): boolean {
  const text = String(composerText.value ?? '').trim()
  if (!text.length) return false
  return !isRoleBusy(targetMode.value)
}

async function sendComposer() {
  const text = String(composerText.value ?? '').trim()
  if (!text.length) return
  const role = targetMode.value
  if (isRoleBusy(role)) return

  await loadHouseStyle()

  const cfg = configs.value[role]
  const attachments = extractWorkspaceImagePaths(text)
  const prompt =
    role === 'implementation'
      ? buildImplementationFollowupPrompt({
          featureSlug: props.featureSlug,
          message: text,
          attachments,
          houseStyleMarkdown: houseStyleMarkdown.value,
        })
      : `Continue the existing ${role} work for \`${props.featureSlug}\`.\n\n${text}`

  const images = extractWorkspaceImagePaths(prompt)

  await startRun({
    workspacePath: props.workspacePath,
    featureSlug: props.featureSlug,
    role,
    profileId: cfg.profileId,
    model: modelValue(cfg) || undefined,
    modelReasoningEffort: (thinkingValue(cfg) as ModelReasoningEffort | '') || undefined,
    oneShotNetwork: cfg.profileId === 'careful' ? cfg.oneShotNetwork : undefined,
    input: inputWithImages(prompt, images),
    uiAction: `composer:${role}`,
    uiUserMessage: text,
  })

  cfg.oneShotNetwork = false
  composerText.value = ''
  composerExpanded.value = false
}

// --- Pasted images (composer + Q&A) ---
function findImageFile(dt: DataTransfer): File | null {
  const candidates: File[] = []
  for (const i of Array.from(dt.items ?? [])) {
    if (i.kind !== 'file') continue
    const f = i.getAsFile()
    if (f) candidates.push(f)
  }
  for (const f of Array.from(dt.files ?? [])) candidates.push(f)

  return (
    candidates.find((f) => (f.type || '').startsWith('image/')) ??
    candidates.find((f) => /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i.test(String(f.name ?? ''))) ??
    null
  )
}

function extractDataUrlImage(text: string): string | null {
  const raw = String(text ?? '')
  const m = raw.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/)
  return m ? m[0] : null
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read pasted image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

function parseImageDataUrl(dataUrl: string): { mime: string; bytesBase64: string; ext: string } | null {
  const match = String(dataUrl ?? '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return null
  const mime = match[1]
  const bytesBase64 = match[2]
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] ?? 'png'
  return { mime, bytesBase64, ext }
}

async function convertImageDataUrlToPng(dataUrl: string): Promise<string | null> {
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!pngBlob) return null

    const pngDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('Failed to read PNG blob'))
      reader.readAsDataURL(pngBlob)
    })
    return pngDataUrl.startsWith('data:image/png;base64,') ? pngDataUrl : null
  } catch {
    return null
  }
}

async function normalizeClipboardImageForSaving(dataUrl: string): Promise<{ ext: string; bytesBase64: string } | null> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) return null

  if (parsed.mime.toLowerCase() === 'image/bmp') {
    const converted = await convertImageDataUrlToPng(dataUrl)
    if (converted) {
      const pngParsed = parseImageDataUrl(converted)
      if (pngParsed) return { ext: 'png', bytesBase64: pngParsed.bytesBase64 }
    }
  }

  return { ext: parsed.ext, bytesBase64: parsed.bytesBase64 }
}

function pastePlainTextIntoTarget(e: ClipboardEvent, text: string) {
  const target = e.target
  if (!target || typeof (target as { value?: unknown }).value !== 'string') return

  const el = target as HTMLTextAreaElement
  const existing = String(el.value ?? '')
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : existing.length
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : existing.length
  const next = `${existing.slice(0, start)}${text}${existing.slice(end)}`
  el.value = next

  const caret = start + text.length
  if (typeof el.selectionStart === 'number') el.selectionStart = caret
  if (typeof el.selectionEnd === 'number') el.selectionEnd = caret
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function attachPastedImage(e: ClipboardEvent, afterSave: (relPath: string) => void) {
  const dt = e.clipboardData
  if (!dt) return

  const file = findImageFile(dt)
  const html = dt.getData('text/html')
  const text = dt.getData('text/plain')
  const dataUrlFromText = extractDataUrlImage(html) ?? extractDataUrlImage(text)
  const hasText = String(text || '').trim().length > 0
  const hasHtml = String(html || '').trim().length > 0
  const htmlLooksImagey = /<img\\b/i.test(String(html || ''))

  if (!file && !dataUrlFromText) {
    // Let normal text/rich-text pastes behave normally (no clipboard IPC).
    if (hasText || (hasHtml && !htmlLooksImagey)) return

    e.preventDefault()
    const clipUrl = await window.codexDesigner?.readClipboardImageDataUrl?.()
    const normalized = await normalizeClipboardImageForSaving(clipUrl || '')
    if (!normalized) {
      pastePlainTextIntoTarget(e, text || '')
      return
    }

    const saved = await window.codexDesigner!.saveAttachment({
      workspacePath: props.workspacePath,
      featureSlug: props.featureSlug,
      ext: normalized.ext,
      bytesBase64: normalized.bytesBase64,
    })

    afterSave(saved.relPath)
    showToast('Image attached')
    return
  }

  e.preventDefault()

  const dataUrl = dataUrlFromText ?? (file ? await readFileAsDataUrl(file) : '')
  const normalized = await normalizeClipboardImageForSaving(dataUrl)
  if (!normalized) return

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: props.workspacePath,
    featureSlug: props.featureSlug,
    ext: normalized.ext,
    bytesBase64: normalized.bytesBase64,
  })

  afterSave(saved.relPath)
  showToast('Image attached')
}

async function onPasteComposer(e: ClipboardEvent) {
  await attachPastedImage(e, (rel) => {
    const md = `![pasted image](${rel})`
    composerText.value = composerText.value.trim().length ? `${composerText.value}\\n\\n${md}` : md
  })
}

async function onPasteQnaNotes(e: ClipboardEvent, q: QnaQuestionV1) {
  if (qnaLocked.value) return
  await attachPastedImage(e, (rel) => {
    const md = `![pasted image](${rel})`
    qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: true }
    const existing = String(draftNotes.value[q.id] ?? '')
    draftNotes.value = { ...draftNotes.value, [q.id]: existing.trim().length ? `${existing}\\n\\n${md}` : md }
  })
}

// ---- Run log history ----
type RunLogMeta = {
  runId: string
  startedAt: string
  endedAt?: string
  status: 'running' | 'completed' | 'failed' | 'aborted'
  role: 'planning' | 'implementation' | 'testing' | 'generic'
  profileId: 'careful' | 'yolo'
  model?: string
  uiAction?: string
  uiUserMessage?: string
  input?: string
  inputImages?: string[]
  modelReasoningEffort?: ModelReasoningEffort
  sandboxMode?: string
  approvalPolicy?: string
  networkAccessEnabled?: boolean
  oneShotNetwork?: boolean
  error?: string
}

function isoToMs(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : Date.now()
}

function extractFinalResponse(events: unknown[], fallback: string | undefined): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as any
    if (evt?.type === 'run.result' && typeof evt.finalResponse === 'string') return evt.finalResponse
  }
  return String(fallback ?? '')
}

async function loadRunLogs() {
  runLogsLoading.value = true
  try {
    const metas = (await window.codexDesigner?.listRunLogs?.({
      workspacePath: props.workspacePath,
      featureSlug: props.featureSlug,
    })) as RunLogMeta[] | undefined

    const list = Array.isArray(metas) ? metas : []
    const map: Record<string, { meta: RunLogMeta | null; events: unknown[] }> = {}

    await Promise.all(
      list.map(async (m) => {
        const runId = String(m?.runId ?? '').trim()
        if (!runId) return
        try {
          const log = await window.codexDesigner!.readRunLog(runId, 500)
          map[runId] = { meta: (log.meta ?? m) as any, events: Array.isArray(log.events) ? log.events : [] }
        } catch {
          map[runId] = { meta: m, events: [] }
        }
      })
    )

    runLogsById.value = map
  } finally {
    runLogsLoading.value = false
  }
}

type RunCardRecord = {
  runId: string
  source: 'live' | 'log'
  role: RunRecord['role']
  status: RunRecord['status']
  startedAt: number
  endedAt: number | null
  finalResponse: string
  events: unknown[]
  uiAction: string | null
  uiUserMessage: string | null
  input: string | null
  inputImages: string[]
  meta: {
    profileId: string | null
    model: string | null
    modelReasoningEffort: string | null
    sandboxMode: string | null
    approvalPolicy: string | null
    networkAccessEnabled: boolean | null
    oneShotNetwork: boolean | null
  }
}

const mergedRuns = computed<RunCardRecord[]>(() => {
  const out: RunCardRecord[] = []
  const seen = new Set<string>()

  for (const r of sessionRuns.value) {
    seen.add(r.runId)
    out.push({
      runId: r.runId,
      source: 'live',
      role: r.role,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      finalResponse: r.finalResponse,
      events: r.events,
      uiAction: r.uiAction ?? null,
      uiUserMessage: r.uiUserMessage ?? null,
      input: r.input ?? null,
      inputImages: r.inputImages ?? [],
      meta: {
        profileId: r.profileId,
        model: r.model,
        modelReasoningEffort: r.modelReasoningEffort,
        sandboxMode: r.sandboxMode,
        approvalPolicy: r.approvalPolicy,
        networkAccessEnabled: r.networkAccessEnabled,
        oneShotNetwork: r.oneShotNetwork,
      },
    })
  }

  for (const [runId, log] of Object.entries(runLogsById.value)) {
    if (seen.has(runId)) continue
    const meta = log.meta
    if (!meta) continue
    const startedAt = isoToMs(meta.startedAt)
    const endedAt = meta.endedAt ? isoToMs(meta.endedAt) : null
    const finalResponse = extractFinalResponse(log.events, (meta as any).finalResponse)
    const uiAction = typeof (meta as any).uiAction === 'string' ? String((meta as any).uiAction) : null
    const uiUserMessage = typeof (meta as any).uiUserMessage === 'string' ? String((meta as any).uiUserMessage) : null
    const input = typeof (meta as any).input === 'string' ? String((meta as any).input) : null
    const inputImages = Array.isArray((meta as any).inputImages) ? (meta as any).inputImages.map((p: any) => String(p)) : []
    out.push({
      runId,
      source: 'log',
      role: meta.role as any,
      status: meta.status as any,
      startedAt,
      endedAt,
      finalResponse,
      events: log.events,
      uiAction,
      uiUserMessage,
      input,
      inputImages,
      meta: {
        profileId: meta.profileId ?? null,
        model: meta.model ?? null,
        modelReasoningEffort: (meta as any).modelReasoningEffort ?? null,
        sandboxMode: (meta as any).sandboxMode ?? null,
        approvalPolicy: (meta as any).approvalPolicy ?? null,
        networkAccessEnabled: (meta as any).networkAccessEnabled ?? null,
        oneShotNetwork: (meta as any).oneShotNetwork ?? null,
      },
    })
  }

  out.sort((a, b) => a.startedAt - b.startedAt)
  return out
})

const runsByMode = computed(() => {
  const by: Record<SessionMode, RunCardRecord[]> = { planning: [], implementation: [], testing: [] }
  for (const r of mergedRuns.value) {
    if (r.role === 'planning') by.planning.push(r)
    else if (r.role === 'implementation') by.implementation.push(r)
    else if (r.role === 'testing') by.testing.push(r)
  }
  return by
})

type TodoOverlayItem = { text: string; completed: boolean }
type TodoOverlayState = { runId: string; role: SessionMode | null; items: TodoOverlayItem[]; done: number; total: number }

function extractLatestTodoList(events: unknown[]): TodoOverlayItem[] | null {
  for (let i = (events ?? []).length - 1; i >= 0; i--) {
    const evt = (events as any)[i]
    const t = typeof evt?.type === 'string' ? evt.type : ''
    if (t !== 'item.started' && t !== 'item.updated' && t !== 'item.completed') continue
    const item = evt?.item
    if (!item || item.type !== 'todo_list') continue
    const rawItems = Array.isArray(item.items) ? item.items : []
    const normalized = rawItems
      .map((it: any) => ({ text: String(it?.text ?? '').trim(), completed: !!it?.completed }))
      .filter((it: TodoOverlayItem) => it.text.length > 0)
    return normalized.length ? normalized : null
  }
  return null
}

const todoDismissedRunId = ref<string | null>(null)

const todoOverlay = computed<TodoOverlayState | null>(() => {
  const running = mergedRuns.value.filter((r) => r.status === 'running')
  if (!running.length) return null

  const target = targetMode.value
  const preferred = running
    .filter((r) => r.role === target)
    .sort((a, b) => b.startedAt - a.startedAt)
  const fallback = running.sort((a, b) => b.startedAt - a.startedAt)

  const candidates = preferred.length ? preferred : fallback
  for (const r of candidates) {
    const list = extractLatestTodoList(r.events)
    if (!list) continue
    const done = list.filter((i) => i.completed).length
    return { runId: r.runId, role: (r.role as any) ?? null, items: list, done, total: list.length }
  }
  return null
})

watch(
  () => todoOverlay.value?.runId ?? null,
  (next) => {
    if (!next) return
    if (todoDismissedRunId.value === next) return
    todoDismissedRunId.value = null
  }
)

const showTodoOverlay = computed(() => {
  const overlay = todoOverlay.value
  if (!overlay) return false
  if (todoDismissedRunId.value && todoDismissedRunId.value === overlay.runId) return false
  return overlay.total > 0
})

function runTitle(r: RunCardRecord): string {
  if (r.uiAction) return r.uiAction
  return `${r.role ?? 'run'}`
}

function abort(runId: string) {
  void abortRun(runId).catch((e) => showToast(e instanceof Error ? e.message : String(e)))
}

onMounted(() => {
  void refreshModels()
})
</script>

<template>
  <div class="space-y-4">
    <TimelineCard
      icon="forum"
      :title="featureSlug"
      :subtitle="`${shortWorkspaceLabel(workspacePath)} · ${mode}`"
      tone="brand"
    >
      <div v-if="artifactsLoading" class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        Loading session artifacts…
      </div>
      <div v-else class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Plan</div>
          <div class="mt-1">
            <span v-if="planLoadError" class="text-amber-700 dark:text-amber-200">Missing</span>
            <span v-else class="text-emerald-700 dark:text-emerald-200">Loaded</span>
          </div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Q&amp;A</div>
          <div class="mt-1">
            <span v-if="qnaLoadError" class="text-amber-700 dark:text-amber-200">Missing</span>
            <span v-else class="text-emerald-700 dark:text-emerald-200">Loaded</span>
            <span
              v-if="qnaLocked"
              class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              locked
            </span>
          </div>
        </div>
      </div>
    </TimelineCard>

    <div v-if="mode === 'planning'" class="space-y-4 pb-24">
      <div v-if="planLoadError" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        Plan file not found for this session.
      </div>
      <DocumentCard
        v-else
        icon="description"
        title="Plan document"
        :subtitle="`docs/${featureSlug}.plan.md`"
        :markdown="planMarkdown"
      />

      <TimelineCard
        v-if="qnaLocked"
        icon="lock"
        title="Planning locked"
        subtitle="Implementation has started for this session."
        tone="warn"
      >
        <div class="text-sm text-gray-600 dark:text-gray-300">
          Q&amp;A edits and next-round generation are disabled after implementation begins (v1 safety).
        </div>
      </TimelineCard>

      <TimelineCard icon="settings" title="Planning actions">
        <div v-if="qnaLoadError" class="text-sm text-gray-600 dark:text-gray-300">
          Q&amp;A state not found yet.
        </div>
        <div v-else class="space-y-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Additional notes</div>
            <AutoGrowTextarea
              v-model="qnaPlanNotes"
              :min-rows="2"
              :max-rows="6"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
              :disabled="qnaLocked || isRoleBusy('planning')"
            />
            <div v-if="qnaPlanNotesError" class="mt-2 text-xs font-semibold text-red-700 dark:text-red-200">
              {{ qnaPlanNotesError }}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
              type="button"
              :disabled="qnaLocked || isRoleBusy('planning') || qnaComplete"
              @click="runNextPlanningRound"
            >
              <span class="material-symbols-rounded text-[18px]">play_arrow</span>
              Generate next round
            </button>

            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
              type="button"
              :disabled="qnaLocked || isRoleBusy('planning')"
              @click="saveQnaPlanNotes().then(() => showToast('Notes saved')).catch((e) => (qnaPlanNotesError = e instanceof Error ? e.message : String(e)))"
            >
              <span class="material-symbols-rounded text-[18px]">save</span>
              Save notes
            </button>
          </div>
        </div>
      </TimelineCard>

      <div v-if="qnaState" class="space-y-3">
        <details
          v-for="round in qnaRounds"
          :key="round.id"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
          :open="qnaRoundOpen[round.id] === true"
        >
          <summary
            class="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3"
            @click.prevent="toggleRound(round.id)"
          >
            <div class="min-w-0">
              <div class="truncate text-sm font-black">{{ round.title }}</div>
              <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ round.questions.length }} questions
              </div>
            </div>
            <span class="material-symbols-rounded text-[20px] text-gray-400">
              {{ qnaRoundOpen[round.id] ? 'expand_less' : 'expand_more' }}
            </span>
          </summary>

          <div class="px-4 pb-4">
            <div v-if="!round.questions.length" class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              Planning complete.
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="q in round.questions"
                :key="q.id"
                class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ q.id }}</div>
                    <div class="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                      {{ q.prompt }}
                    </div>
                  </div>

                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    type="button"
                    :disabled="qnaLocked"
                    @click="toggleQuestionEdit(q)"
                  >
                    <span class="material-symbols-rounded text-[18px]">{{ qnaEditOpen[q.id] ? 'close' : 'edit' }}</span>
                    {{ qnaEditOpen[q.id] ? 'Close' : 'Edit' }}
                  </button>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span class="rounded-full bg-gray-100 px-2 py-0.5 font-mono font-black text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {{ inferredSelectedKey(q) }}
                  </span>
                  <span class="font-semibold text-gray-700 dark:text-gray-200">
                    {{ selectedOptionText(q, inferredSelectedKey(q)) }}
                  </span>
                </div>

                <div v-if="qnaEditOpen[q.id]" class="mt-3 space-y-3">
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="opt in q.options"
                      :key="opt.key"
                      class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                      :class="
                        inferredSelectedKey(q) === opt.key
                          ? 'bg-brand-600 text-white shadow-brand-600/20'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                      "
                      type="button"
                      :disabled="qnaLocked"
                      @click="draftSelected = { ...draftSelected, [q.id]: opt.key }"
                    >
                      <span class="rounded-full bg-black/10 px-2 py-0.5 font-mono text-[10px] font-black" :class="inferredSelectedKey(q) === opt.key ? 'text-white' : 'text-gray-700 dark:text-gray-200'">
                        {{ opt.key }}
                      </span>
                      <span class="truncate">{{ opt.text }}</span>
                      <span v-if="opt.recommended" class="material-symbols-rounded text-[16px]">star</span>
                    </button>
                  </div>

                  <div>
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Notes</div>
                    <AttachmentPreviews
                      v-if="extractWorkspaceImagePaths(String(draftNotes[q.id] ?? '')).length"
                      :workspace-path="workspacePath"
                      :attachments="extractWorkspaceImagePaths(String(draftNotes[q.id] ?? ''))"
                      :max="6"
                    />
                    <AutoGrowTextarea
                      v-model="draftNotes[q.id]"
                      :min-rows="2"
                      :max-rows="10"
                      class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                      placeholder="Add clarifications. Paste images here."
                      :disabled="qnaLocked"
                      @paste="onPasteQnaNotes($event as ClipboardEvent, q)"
                    />
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                      type="button"
                      :disabled="qnaLocked"
                      @click="saveQnaAnswer(q)"
                    >
                      <span class="material-symbols-rounded text-[18px]">save</span>
                      Save answer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div v-if="runsByMode.planning.length" class="space-y-3">
        <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Planning runs</div>
        <RunCard
          v-for="r in runsByMode.planning"
          :key="r.runId"
          :run-id="r.runId"
          :title="runTitle(r)"
          :subtitle="r.runId"
          :status="r.status"
          :started-at="r.startedAt"
          :ended-at="r.endedAt"
          :workspace-path="workspacePath"
          :user-message="r.uiUserMessage ?? ''"
          :user-attachments="extractWorkspaceImagePaths(r.uiUserMessage ?? '')"
          :input-prompt="r.input ?? ''"
          :final-response="r.finalResponse"
          :events="r.events"
          :meta="r.meta"
          :collapse-key="`codex-designer:run-stream:${featureSlug}:${r.runId}`"
          :can-stop="r.status === 'running'"
          @stop="abort(r.runId)"
        />
      </div>
    </div>

    <div v-else-if="mode === 'testing'" class="space-y-4 pb-24">
      <DocumentCard icon="checklist" title="Test document" :subtitle="`docs/${featureSlug}.test.md`" :markdown="testMarkdown" />

      <TimelineCard icon="science" title="Testing actions">
        <div v-if="testLoadError" class="text-sm text-gray-600 dark:text-gray-300">
          {{ testLoadError }}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
            type="button"
            :disabled="isRoleBusy('testing')"
            @click="generateTests().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
          >
            <span class="material-symbols-rounded text-[18px]">auto_fix_high</span>
            Generate tests
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
            type="button"
            :disabled="!testPlan || isRoleBusy('testing')"
            @click="startTestingRound().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
          >
            <span class="material-symbols-rounded text-[18px]">add</span>
            Start new round
          </button>
        </div>
      </TimelineCard>

      <div v-if="testPlan && testPlan.tests.length" class="space-y-3">
        <details
          v-for="round in testPlan.rounds"
          :key="round.id"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <summary class="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-black">{{ round.id }}</div>
              <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ round.startedAt }}</div>
            </div>
            <span class="material-symbols-rounded text-[20px] text-gray-400">expand_more</span>
          </summary>

          <div class="px-4 pb-4">
            <div class="space-y-3">
              <div
                v-for="t in testPlan.tests"
                :key="t.id"
                class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ t.id }}</div>
                    <div class="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">{{ t.title }}</div>
                  </div>

                  <select
                    class="rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                    :value="getResult(round, t.id).status"
                    @change="setTestStatus(round, t.id, ($event.target as HTMLSelectElement).value).catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                  >
                    <option value="not_run">not_run</option>
                    <option value="pass">pass</option>
                    <option value="fail">fail</option>
                    <option value="deferred">deferred</option>
                    <option value="blocked">blocked</option>
                  </select>
                </div>

                <div class="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  <div v-if="t.description" class="mb-2">{{ t.description }}</div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Steps</div>
                  <ol class="mt-1 list-decimal space-y-1 pl-5">
                    <li v-for="(s, idx) in t.steps" :key="idx">{{ s }}</li>
                  </ol>
                  <div class="mt-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Expected</div>
                  <div class="mt-1">{{ t.expected }}</div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div v-if="runsByMode.testing.length" class="space-y-3">
        <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Testing runs</div>
        <RunCard
          v-for="r in runsByMode.testing"
          :key="r.runId"
          :run-id="r.runId"
          :title="runTitle(r)"
          :subtitle="r.runId"
          :status="r.status"
          :started-at="r.startedAt"
          :ended-at="r.endedAt"
          :workspace-path="workspacePath"
          :user-message="r.uiUserMessage ?? ''"
          :user-attachments="extractWorkspaceImagePaths(r.uiUserMessage ?? '')"
          :input-prompt="r.input ?? ''"
          :final-response="r.finalResponse"
          :events="r.events"
          :meta="r.meta"
          :collapse-key="`codex-designer:run-stream:${featureSlug}:${r.runId}`"
          :can-stop="r.status === 'running'"
          @stop="abort(r.runId)"
        />
      </div>
    </div>

    <div v-else class="space-y-4 pb-24">
      <TimelineCard icon="build" title="Implementation">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
            type="button"
            :disabled="isRoleBusy('implementation')"
            @click="runImplementation().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
          >
            <span class="material-symbols-rounded text-[18px]">play_arrow</span>
            Implement plan
          </button>
        </div>
        <div v-if="modelsError" class="mt-3 text-xs font-semibold text-red-700 dark:text-red-200">
          {{ modelsError }}
        </div>
      </TimelineCard>

      <div v-if="runLogsLoading" class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        Loading run history…
      </div>

      <div v-if="runsByMode.implementation.length" class="space-y-3">
        <RunCard
          v-for="r in runsByMode.implementation"
          :key="r.runId"
          :run-id="r.runId"
          :title="runTitle(r)"
          :subtitle="r.runId"
          :status="r.status"
          :started-at="r.startedAt"
          :ended-at="r.endedAt"
          :workspace-path="workspacePath"
          :user-message="r.uiUserMessage ?? ''"
          :user-attachments="extractWorkspaceImagePaths(r.uiUserMessage ?? '')"
          :input-prompt="r.input ?? ''"
          :final-response="r.finalResponse"
          :events="r.events"
          :meta="r.meta"
          :collapse-key="`codex-designer:run-stream:${featureSlug}:${r.runId}`"
          :can-stop="r.status === 'running'"
          @stop="abort(r.runId)"
        />
      </div>
      <div v-else class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        No implementation runs yet.
      </div>
    </div>

    <!-- Bottom dock -->
    <div
      class="sticky bottom-3 z-20 rounded-2xl border border-gray-200 bg-white/80 p-3 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-950/70"
    >
      <!-- Floating TODO overlay -->
      <div
        v-if="showTodoOverlay"
        class="absolute bottom-full right-0 z-30 mb-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="material-symbols-rounded text-[18px] text-brand-500">checklist</span>
              <div class="text-xs font-black text-gray-900 dark:text-gray-100">TODO</div>
              <div class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                {{ todoOverlay?.done }}/{{ todoOverlay?.total }}
              </div>
              <div
                v-if="todoOverlay?.role"
                class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                {{ todoOverlay?.role }}
              </div>
            </div>
            <div class="mt-1 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">
              run: {{ todoOverlay?.runId }}
            </div>
          </div>

          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            aria-label="Dismiss TODO overlay"
            @click="todoDismissedRunId = todoOverlay?.runId ?? null"
          >
            <span class="material-symbols-rounded text-[18px]">close</span>
          </button>
        </div>

        <div class="mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-1">
          <div
            v-for="(it, idx) in todoOverlay?.items ?? []"
            :key="`${todoOverlay?.runId ?? 'run'}-${idx}`"
            class="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-[12px] text-gray-800 dark:bg-gray-900 dark:text-gray-100"
            :class="it.completed ? 'opacity-70' : ''"
          >
            <span class="material-symbols-rounded mt-0.5 text-[18px] text-gray-400">
              {{ it.completed ? 'check_box' : 'check_box_outline_blank' }}
            </span>
            <div class="min-w-0 flex-1" :class="it.completed ? 'line-through' : ''">{{ it.text }}</div>
          </div>
        </div>
      </div>

      <!-- Config row -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
          :class="
            mode === 'planning'
              ? 'bg-brand-600 text-white shadow-brand-600/20'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          "
          type="button"
          @click="setMode('planning')"
        >
          <span class="material-symbols-rounded text-[18px]">chat</span>
          Planning
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
          :class="
            mode === 'implementation'
              ? 'bg-brand-600 text-white shadow-brand-600/20'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          "
          type="button"
          @click="setMode('implementation')"
        >
          <span class="material-symbols-rounded text-[18px]">build</span>
          Implementation
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
          :class="
            mode === 'testing'
              ? 'bg-brand-600 text-white shadow-brand-600/20'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          "
          type="button"
          @click="setMode('testing')"
        >
          <span class="material-symbols-rounded text-[18px]">checklist</span>
          Testing
        </button>

        <div class="flex-1"></div>

        <div class="flex flex-wrap items-center gap-2">
          <select
            v-model="dockTargetOverride"
            class="rounded-xl bg-white px-3 py-2 text-xs font-black outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
            aria-label="Composer target"
          >
            <option value="current">Target: Current tab</option>
            <option value="planning">Target: Planning</option>
            <option value="implementation">Target: Implementation</option>
            <option value="testing">Target: Testing</option>
          </select>

          <select
            v-model="targetConfig.profileId"
            class="rounded-xl bg-white px-3 py-2 text-xs font-black outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
            aria-label="Profile"
          >
            <option value="careful">Careful</option>
            <option value="yolo">YOLO</option>
          </select>

          <select
            v-model="targetConfig.modelChoice"
            class="w-[220px] rounded-xl bg-white px-3 py-2 text-xs font-black outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
            aria-label="Model"
            :disabled="modelsLoading"
          >
            <option value="default">Model: Default</option>
            <option v-for="m in codexModels" :key="m.model" :value="m.model">
              {{ m.displayName }}{{ m.isDefault ? ' (default)' : '' }}
            </option>
            <option value="custom">Model: Custom…</option>
          </select>

          <input
            v-if="targetConfig.modelChoice === 'custom'"
            v-model="targetConfig.modelCustom"
            type="text"
            placeholder="model id"
            class="w-[220px] rounded-xl bg-white px-3 py-2 text-xs font-black outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
          />

          <select
            v-model="targetConfig.thinkingChoice"
            class="rounded-xl bg-white px-3 py-2 text-xs font-black outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
            aria-label="Thinking level"
          >
            <option value="default">Thinking: Default</option>
            <option value="minimal">Thinking: Minimal</option>
            <option value="low">Thinking: Low</option>
            <option value="medium">Thinking: Medium</option>
            <option value="high">Thinking: High</option>
            <option value="xhigh">Thinking: XHigh</option>
          </select>

          <label
            v-if="targetConfig.profileId === 'careful'"
            class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          >
            <input v-model="targetConfig.oneShotNetwork" type="checkbox" class="h-4 w-4 accent-brand-600" />
            One-shot tool network
          </label>
        </div>
      </div>

      <!-- Composer -->
      <div class="mt-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs font-black text-gray-700 dark:text-gray-200">
            Composer
            <span class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200">
              target: {{ targetMode }}
            </span>
          </div>
          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            :aria-label="composerExpanded ? 'Collapse composer' : 'Expand composer'"
            @click="composerExpanded = !composerExpanded"
          >
            <span class="material-symbols-rounded text-[20px]">{{ composerExpanded ? 'expand_more' : 'expand_less' }}</span>
          </button>
        </div>

        <div class="mt-2">
          <AutoGrowTextarea
            v-model="composerText"
            :min-rows="composerExpanded ? 4 : 2"
            :max-rows="composerExpanded ? 20 : 4"
            :max-viewport-fraction="0.25"
            class="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
            placeholder="Message… (paste images here)"
            :disabled="isRoleBusy(targetMode)"
            @paste="onPasteComposer($event as ClipboardEvent)"
          />

          <AttachmentPreviews
            v-if="extractWorkspaceImagePaths(composerText).length"
            class="mt-2"
            :workspace-path="workspacePath"
            :attachments="extractWorkspaceImagePaths(composerText)"
            :max="6"
          />
        </div>

        <div class="mt-3 flex items-center justify-end gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
            type="button"
            :disabled="!canSendComposer()"
            @click="sendComposer().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
          >
            <span class="material-symbols-rounded text-[18px]">send</span>
            Send
          </button>
        </div>
      </div>
    </div>
  </div>

  <ToastHost :toasts="toasts" />
</template>
