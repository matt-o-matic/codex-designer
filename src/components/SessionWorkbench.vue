<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { parseLenientJson } from '../lib/json'
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
import MarkdownViewer from './MarkdownViewer.vue'
import AttachmentPreviews from './AttachmentPreviews.vue'
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
const activeDocumentTab = ref<'plan' | 'qna' | 'tests' | 'todos'>('plan')

/* -------------------------------------------------------------------------
   Scroll Management (Chat / Left Pane)
   ------------------------------------------------------------------------- */
const scrollContainer = ref<HTMLDivElement | null>(null)
const showScrollBottom = ref(false)

function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  showScrollBottom.value = dist > 50
}

function scrollToBottom() {
  const el = scrollContainer.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

watch(mode, async () => {
  await nextTick()
  scrollToBottom()
  // Immediate check for scroll position to update arrow visibility
  onScroll()
})

/* -------------------------------------------------------------------------
   Docs Pane Resizing
   ------------------------------------------------------------------------- */
const DOCS_PANE_WIDTH_KEY = 'codex-designer:docs-pane-width'
const docsPaneWidth = ref(400)
const isResizingDocs = ref(false)

function clampDocsWidth(px: number): number {
  const min = 300
  const max = 1200 // fairly wide on large screens
  if (!Number.isFinite(px)) return 400
  return Math.max(min, Math.min(max, Math.round(px)))
}

try {
  const raw = localStorage.getItem(DOCS_PANE_WIDTH_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed)) docsPaneWidth.value = clampDocsWidth(parsed)
} catch {
  // ignore
}

function startResizingDocs(e: MouseEvent) {
  isResizingDocs.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const startX = e.clientX
  const startWidth = docsPaneWidth.value

  const moveHandler = (ev: MouseEvent) => {
    // Pane is on the right. Moving left (smaller X) means simpler logic:
    // New Width = Start Width + (Start X - Current X)
    const delta = startX - ev.clientX
    docsPaneWidth.value = clampDocsWidth(startWidth + delta)
  }

  const upHandler = () => {
    isResizingDocs.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', moveHandler)
    window.removeEventListener('mouseup', upHandler)
    try {
      localStorage.setItem(DOCS_PANE_WIDTH_KEY, String(docsPaneWidth.value))
    } catch {
      // ignore
    }
  }

  window.addEventListener('mousemove', moveHandler)
  window.addEventListener('mouseup', upHandler)
}

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

// NOTE: This must be defined before the immediate watch() that calls loadRunLogs(),
// otherwise we'll hit the temporal-dead-zone for this ref.
const runLogsLoading = ref(false)
const runLogsById = ref<Record<string, { meta: any; events: unknown[] }>>({})

const houseStyleMarkdown = ref('')

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
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
    const rawTrimmed = String(raw ?? '').trim().replace(/^\uFEFF/, '')
    const parsedRes = parseLenientJson(raw)
    const needsRewrite = !!parsedRes && parsedRes.jsonText !== rawTrimmed
    const parsed = parseQnaStateJson(raw)
    if (!parsed) throw new Error('Invalid Q&A JSON (expected version: 1).')
    const norm = normalizeQnaStateV1(parsed)
    loadedQna = norm.state
    if (norm.changed || needsRewrite) {
      await window.codexDesigner!.writeTextFile(
        props.workspacePath,
        `docs/${props.featureSlug}.qna.json`,
        JSON.stringify(loadedQna, null, 2) + '\n'
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

  let testNeedsRewrite = false
  try {
    const raw = await window.codexDesigner!.readTextFile(props.workspacePath, `docs/${props.featureSlug}.test.json`)
    const rawTrimmed = String(raw ?? '').trim().replace(/^\uFEFF/, '')
    const parsed = parseLenientJson(raw)
    if (!parsed) throw new Error('Invalid test plan JSON.')
    testNeedsRewrite = parsed.jsonText !== rawTrimmed
    testPlan.value = parsed.value as TestPlan
  } catch {
    testPlan.value = createEmptyTestPlan(props.featureSlug)
    testLoadError.value = null
  }
  if (testPlan.value) {
    ensureRound(testPlan.value)
    if (testNeedsRewrite) {
      await window.codexDesigner!.writeTextFile(
        props.workspacePath,
        `docs/${props.featureSlug}.test.json`,
        JSON.stringify(testPlan.value, null, 2) + '\n'
      )
    }
  }

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

// Allow external triggers to reload artifacts (e.g. background creation completing)
const onArtifactsUpdated = () => void loadArtifacts()
onMounted(() => {
  window.addEventListener('codex-designer:artifacts-updated', onArtifactsUpdated)
})
onUnmounted(() => {
  window.removeEventListener('codex-designer:artifacts-updated', onArtifactsUpdated)
})

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
  const nextNotes = String(qnaPlanNotes.value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  const curNotes = String(qnaState.value.notes ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  if (nextNotes === curNotes) return

  const nextState: QnaStateV1 = structuredClone(qnaState.value)
  nextState.notes = nextNotes
  nextState.updatedAt = new Date().toISOString()

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\n')
  const md = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, md)
  qnaState.value = nextState
  qnaMarkdown.value = md
}

async function saveQnaAnswer(q: QnaQuestionV1) {
  if (!qnaState.value) return
  if (qnaLocked.value) return

  const selectedKey = inferredSelectedKey(q)
  const notes = String(inferredNotes(q) ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
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

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\n')
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
  const json = JSON.stringify(testPlan.value, null, 2) + '\n'
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

  const parsedRes = parseLenientJson(rec.finalResponse)
  if (!parsedRes) throw new Error('Failed to parse structured output.')
  const parsed = parsedRes.value as { planMarkdown: string; qnaRound: QnaRoundV1 }
  const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
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

  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.json`, JSON.stringify(normalized, null, 2) + '\n')
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.qna.md`, qnaMd)
  await window.codexDesigner!.writeTextFile(props.workspacePath, `docs/${props.featureSlug}.plan.md`, plan)

  await loadArtifacts()
}

async function runNextPlanningRound(notes?: string) {
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

  const combinedNotes = [qnaPlanNotes.value, notes].filter(Boolean).join('\n\n')

  const prompt = buildPlanningNextRoundPrompt({
    featureSlug: props.featureSlug,
    nextRoundNumber,
    additionalNotes: combinedNotes,
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

  const parsedRes = parseLenientJson(rec.finalResponse)
  if (!parsedRes) throw new Error('Failed to parse structured output.')
  const parsed = parsedRes.value as { tests: any[] }
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
  const images = extractWorkspaceImagePaths(`${planMarkdown.value}\n\n${qnaMarkdown.value}`)
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
  const role = targetMode.value
  if (isRoleBusy(role)) return false

  if (role === 'planning') {
    return !qnaLocked.value && !!qnaState.value && !qnaComplete.value
  }
  if (role === 'testing') {
    return !!testPlan.value
  }

  const text = String(composerText.value ?? '').trim()
  return text.length > 0
}

async function sendComposer() {
  const text = String(composerText.value ?? '').trim()
  const role = targetMode.value
  if (isRoleBusy(role)) return

  if (role === 'planning') {
    await runNextPlanningRound(text)
    composerText.value = ''
    composerExpanded.value = false
    return
  }

  if (role === 'testing') {
    await startTestingRound()
    composerText.value = ''
    composerExpanded.value = false
    // Note: currently testing rounds are local, but we might want to send a message to Codex too?
    // For now, let's just do what the "New Round" button did.
    return
  }

  if (!text.length) return

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
    composerText.value = composerText.value.trim().length ? `${composerText.value}\n\n${md}` : md
  })
}

async function onPasteQnaNotes(e: ClipboardEvent, q: QnaQuestionV1) {
  if (qnaLocked.value) return
  await attachPastedImage(e, (rel) => {
    const md = `![pasted image](${rel})`
    qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: true }
    const existing = String(draftNotes.value[q.id] ?? '')
    draftNotes.value = { ...draftNotes.value, [q.id]: existing.trim().length ? `${existing}\n\n${md}` : md }
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
          const log = await window.codexDesigner!.readRunLog(runId, 2000)
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

// Watch active runs to auto-scroll if near bottom
watch(
  () => runsByMode.value[mode.value].length,
  async () => {
    // Only scroll if we were already relatively close to bottom or it's a new run
    await nextTick()
    if (!scrollContainer.value) return
    const el = scrollContainer.value
    // Simple logic: just scroll to bottom on new run cards for now
    // A more complex logic would check if user is reading up history
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    if (dist < 400) {
      scrollToBottom()
    }
  }
)

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
  <div class="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900">
    <!-- Header -->
    <div class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-black tracking-tight text-gray-900 dark:text-gray-100">{{ featureSlug }}</h2>
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ shortWorkspaceLabel(workspacePath) }}</span>
      </div>
      
      <div class="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        <button
          v-for="m in (['planning', 'implementation', 'testing'] as const)"
          :key="m"
          class="rounded-md px-3 py-1.5 text-xs font-bold transition-colors"
          :class="mode === m ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'"
          @click="setMode(m)"
        >
          {{ m.charAt(0).toUpperCase() + m.slice(1) }}
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- Left: Activity / Chat -->
      <div class="flex flex-1 flex-col overflow-hidden relative">
        <div
          ref="scrollContainer"
          class="flex-1 overflow-y-auto p-4 scroll-smooth"
          @scroll="onScroll"
        >
          <div class="mx-auto max-w-3xl space-y-6">
            
            <!-- Context cards based on mode (if needed for quick actions) -->
            <div v-if="mode === 'planning'" class="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/20">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">Planning Actions</h3>
                <div class="flex gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="qnaLocked || isRoleBusy('planning') || qnaComplete"
                    @click="runNextPlanningRound()"
                  >
                    <span class="material-symbols-rounded text-[16px]">play_arrow</span>
                    Next Round
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="mode === 'implementation'" class="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/20">
               <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">Implementation Actions</h3>
                <button
                  class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                  type="button"
                  :disabled="isRoleBusy('implementation')"
                  @click="runImplementation().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                >
                  <span class="material-symbols-rounded text-[16px]">play_arrow</span>
                  Implement Plan
                </button>
              </div>
              <div v-if="modelsError" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ modelsError }}</div>
            </div>

             <div v-else-if="mode === 'testing'" class="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/20">
               <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">Testing Actions</h3>
                 <div class="flex gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
                    type="button"
                    :disabled="isRoleBusy('testing')"
                    @click="generateTests().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                  >
                    <span class="material-symbols-rounded text-[16px]">auto_fix_high</span>
                    Generate Tests
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="!testPlan || isRoleBusy('testing')"
                    @click="startTestingRound().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                  >
                    <span class="material-symbols-rounded text-[16px]">play_arrow</span>
                    Next Round
                  </button>
                 </div>
              </div>
            </div>

            <!-- Runs Stream -->
            <div class="space-y-6">
              <template v-if="mode === 'planning'">
                 <div v-if="!runsByMode.planning.length" class="text-center py-10 text-sm text-gray-500">
                    No planning runs yet. Start by generating the next round.
                 </div>
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
              </template>

              <template v-else-if="mode === 'implementation'">
                <div v-if="!runsByMode.implementation.length" class="text-center py-10 text-sm text-gray-500">
                    No implementation runs yet.
                 </div>
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
              </template>

              <template v-else-if="mode === 'testing'">
                <div v-if="!runsByMode.testing.length" class="text-center py-10 text-sm text-gray-500">
                    No testing runs yet.
                 </div>
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
              </template>
            </div>
          </div>
        </div>

        <!-- Composer Area -->
        <div class="shrink-0 border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 relative">
          <!-- Scroll to Bottom Button -->
          <button
            v-if="showScrollBottom"
            class="absolute left-1/2 -top-10 -translate-x-1/2 rounded-full border border-gray-200 bg-white p-2 shadow-lg transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            @click="scrollToBottom"
            aria-label="Scroll to bottom"
          >
            <span class="material-symbols-rounded block text-[20px] text-brand-600 dark:text-brand-400">arrow_downward</span>
          </button>

          <div class="mx-auto max-w-3xl">
            <div class="flex gap-4">
              <div class="flex-1">
                 <AutoGrowTextarea
                  v-model="composerText"
                  :min-rows="2"
                  :max-rows="12"
                  class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none ring-0 placeholder:text-gray-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-brand-500 dark:focus:bg-gray-950"
                  :placeholder="targetMode === 'implementation' ? 'Type a message...' : 'Add notes for the next round... (optional)'"
                  :disabled="isRoleBusy(targetMode)"
                  @paste="onPasteComposer($event as ClipboardEvent)"
                  @keydown.enter.prevent="() => { if (!isRoleBusy(targetMode) && canSendComposer()) sendComposer().catch((e) => showToast(e instanceof Error ? e.message : String(e))) }"
                />
                
                <!-- Composer Controls -->
                <div class="mt-2 flex items-center justify-between">
                   <div class="flex items-center gap-2">
                      <!-- Simplified Model Config (Icon Based?) -->
                      <select
                        v-model="targetConfig.modelChoice"
                        class="rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:ring-0 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        :disabled="modelsLoading"
                      >
                        <option value="default">Model: Default</option>
                        <option v-for="m in codexModels" :key="m.model" :value="m.model">
                          {{ m.displayName }}
                        </option>
                         <option value="custom">Model: Custom</option>
                      </select>

                      <select
                        v-model="targetConfig.thinkingChoice"
                        class="rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:ring-0 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <option value="default">Thinking: Default</option>
                        <option value="minimal">Thinking: Minimal</option>
                        <option value="low">Thinking: Low</option>
                        <option value="medium">Thinking: Medium</option>
                        <option value="high">Thinking: High</option>
                        <option value="xhigh">Thinking: XHigh</option>
                      </select>
                   </div>
                   <button
                    class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="!canSendComposer() || isRoleBusy(targetMode)"
                    @click="sendComposer().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                  >
                    {{ targetMode === 'implementation' ? 'Send' : 'Next Round' }}
                    <span class="material-symbols-rounded text-[16px]">{{ targetMode === 'implementation' ? 'send' : 'play_arrow' }}</span>
                  </button>
                </div>
                 <AttachmentPreviews
                  v-if="extractWorkspaceImagePaths(composerText).length"
                  class="mt-2"
                  :workspace-path="workspacePath"
                  :attachments="extractWorkspaceImagePaths(composerText)"
                  :max="6"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Resize Handle -->
      <div
        class="w-[5px] cursor-col-resize border-l border-r border-gray-200 bg-gray-50 hover:bg-brand-500 hover:border-brand-500 active:bg-brand-600 active:border-brand-600 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-brand-400 dark:hover:border-brand-400 dark:active:bg-brand-500 transition-colors z-10 flex-none"
        @mousedown.prevent="startResizingDocs"
      ></div>

      <!-- Right: Documents & Tools -->
      <div 
        class="flex shrink-0 flex-col bg-gray-50 dark:bg-gray-950"
        :style="{ width: docsPaneWidth + 'px' }"
      >
        <!-- Tabs -->
        <div class="flex border-b border-gray-200 px-2 dark:border-gray-800">
          <button
            v-for="tab in (['plan', 'qna', 'tests', 'todos'] as const)"
            :key="tab"
            class="relative flex-1 px-4 py-3 text-xs font-bold transition-colors hover:text-gray-900 dark:hover:text-gray-100"
             :class="activeDocumentTab === tab ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400'"
            @click="activeDocumentTab = tab"
          >
            {{ tab === 'qna' ? 'Q&A' : tab.charAt(0).toUpperCase() + tab.slice(1) }}
            <span
              v-if="activeDocumentTab === tab"
              class="absolute inset-x-0 bottom-0 h-0.5 bg-brand-600 dark:bg-brand-400"
            />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-4">
           <!-- Plan Tab -->
           <div v-if="activeDocumentTab === 'plan'" class="space-y-4">
             <div v-if="planLoadError" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
               {{ planLoadError }}
             </div>
             <div v-else class="prose prose-sm prose-gray dark:prose-invert max-w-none">
                <MarkdownViewer :markdown="planMarkdown || '*No plan content loaded.*'" />
             </div>
           </div>

           <!-- Q&A Tab -->
           <div v-if="activeDocumentTab === 'qna'" class="space-y-4">
             <div v-if="qnaLoadError" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
               {{ qnaLoadError }}
             </div>

              <!-- Q&A Rounds List -->
              <div v-if="qnaState" class="space-y-3">
                 <!-- Note editor component reused here -->
                 <div class="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                    <div class="text-[10px] uppercase font-black tracking-wider text-gray-500 mb-2">Global Notes</div>
                    <AutoGrowTextarea
                      v-model="qnaPlanNotes"
                      :min-rows="2"
                      :max-rows="6"
                      class="w-full text-xs bg-transparent outline-none resize-none"
                      placeholder="Add high-level implementation notes..."
                      :disabled="qnaLocked"
                    />
                    <div class="mt-2 flex justify-end">
                       <button
                        class="text-[10px] font-bold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                         :disabled="qnaLocked"
                         @click="saveQnaPlanNotes().then(() => showToast('Notes saved'))"
                       >
                         Save Notes
                       </button>
                    </div>
                 </div>

                 <div v-for="round in qnaRounds" :key="round.id" class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
                    <div 
                      class="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800"
                      @click="toggleRound(round.id)"
                    >
                       <span class="text-xs font-bold">{{ round.title }}</span>
                       <span class="material-symbols-rounded text-[16px]">{{ qnaRoundOpen[round.id] ? 'expand_less' : 'expand_more' }}</span>
                    </div>
                    
                    <div v-if="qnaRoundOpen[round.id]" class="p-3 space-y-3">
                        <div v-for="q in round.questions" :key="q.id" class="space-y-2">
                           <div class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ q.prompt }}</div>
                           <!-- Minimal view of answer -->
                           <div class="text-xs pl-2 border-l-2 border-brand-500 text-gray-600 dark:text-gray-400">
                              {{ selectedOptionText(q, inferredSelectedKey(q)) || 'Not answered' }}
                           </div>
                           <button 
                             class="text-[10px] text-brand-600 underline"
                             @click="toggleQuestionEdit(q)"
                           >
                              {{ qnaEditOpen[q.id] ? 'Close Editor' : 'Edit Answer' }}
                           </button>

                           <!-- Inline Editor (Simplified) -->
                           <div v-if="qnaEditOpen[q.id]" class="mt-2 space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
                              <div class="flex flex-col gap-1">
                                <button
                                  v-for="opt in q.options"
                                  :key="opt.key"
                                  class="text-left text-[10px] px-2 py-1.5 rounded border"
                                  :class="inferredSelectedKey(q) === opt.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700'"
                                  @click="draftSelected = { ...draftSelected, [q.id]: opt.key }"
                                >
                                  <span class="font-bold mr-1">{{ opt.key }}</span> {{ opt.text }}
                                </button>
                              </div>
                              <AutoGrowTextarea
                                v-model="draftNotes[q.id]"
                                class="w-full text-xs p-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
                                placeholder="Notes..."
                                @paste="onPasteQnaNotes($event as ClipboardEvent, q)"
                              />
                              <button 
                                class="w-full py-1 bg-brand-600 text-white rounded text-[10px] font-bold"
                                @click="saveQnaAnswer(q)"
                              >
                                Save
                              </button>
                           </div>
                        </div>
                    </div>
                 </div>
              </div>
           </div>

           <!-- Tests Tab -->
           <div v-if="activeDocumentTab === 'tests'" class="space-y-4">
              <div v-if="testLoadError" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
               {{ testLoadError }}
             </div>
             
             <div v-if="testPlan" class="space-y-4">
                 <!-- Test Rounds -->
                 <div v-for="round in testPlan.rounds" :key="round.id" class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div class="px-3 py-2 bg-gray-50 text-xs font-bold border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                       {{ round.id }} <span class="font-normal text-gray-500 ml-2">{{ new Date(round.startedAt).toLocaleDateString() }}</span>
                    </div>
                    <div class="p-3 space-y-3">
                       <div v-for="t in testPlan.tests" :key="t.id" class="flex items-start justify-between gap-2 text-xs">
                          <div class="font-medium flex-1">{{ t.id }}: {{ t.title }}</div>
                          <select
                            class="shrink-0 rounded border-gray-200 py-0.5 pl-2 pr-6 text-xs"
                            :value="getResult(round, t.id).status"
                            @change="setTestStatus(round, t.id, ($event.target as HTMLSelectElement).value).catch(console.error)"
                          >
                             <option value="not_run">Not Run</option>
                             <option value="pass">Pass</option>
                             <option value="fail">Fail</option>
                             <option value="deferred">Deferred</option>
                          </select>
                       </div>
                    </div>
                 </div>
             </div>
             <div v-else class="text-xs text-gray-500">No test plan loaded.</div>
           </div>

           <!-- Todos Tab -->
           <div v-if="activeDocumentTab === 'todos'" class="space-y-4">
              <!-- Show aggregate todos from recent runs -->
              <!-- TODO: Needs logic to aggregate or finding the "master" todo list -->
              <div class="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                 <div class="text-[10px] uppercase font-black tracking-wider text-gray-500 mb-2">
                    Latest Todo List
                    <span v-if="todoOverlay?.runId" class="normal-case font-normal ml-1 opacity-70">(Run {{ todoOverlay.runId }})</span>
                 </div>

                 <div v-if="todoOverlay && todoOverlay.items.length" class="space-y-1">
                    <div 
                      v-for="(item, idx) in todoOverlay.items" 
                      :key="idx" 
                      class="flex items-start gap-2 text-xs py-1"
                      :class="item.completed ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'"
                    >
                       <span class="material-symbols-rounded text-[14px]">{{ item.completed ? 'check_box' : 'check_box_outline_blank' }}</span>
                       <span>{{ item.text }}</span>
                    </div>
                 </div>
                 <div v-else class="text-xs text-gray-500 italic">
                    No active todo list found in recent runs.
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  </div>
  
  <ToastHost :toasts="toasts" />
</template>
