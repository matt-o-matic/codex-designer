<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { parseLenientJson } from '../lib/json'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import { assertValidPlanningPlanMarkdown } from '../lib/planning'
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
import {
  buildWorkspaceDiffFromEvents,
  useRunStore,
  type ModelReasoningEffort,
  type RunRecord,
} from '../lib/runStore'
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
type DocumentTab = 'plan' | 'qna' | 'tests' | 'implementation'
const activeDocumentTab = ref<DocumentTab>('plan')
const showTodos = ref(false)

/* -------------------------------------------------------------------------
   Scroll Management (Chat / Left Pane)
   ------------------------------------------------------------------------- */
const scrollContainer = ref<HTMLDivElement | null>(null)
const pinnedToBottom = ref(true)
const showScrollBottom = ref(false)

const PIN_THRESHOLD_PX = 24
const SHOW_SCROLL_BUTTON_THRESHOLD_PX = 80

function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  pinnedToBottom.value = dist <= PIN_THRESHOLD_PX
  showScrollBottom.value = dist > SHOW_SCROLL_BUTTON_THRESHOLD_PX
}

async function keepPinnedAtBottom() {
  if (!pinnedToBottom.value) return
  await nextTick()
  const el = scrollContainer.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  requestAnimationFrame(() => {
    if (!pinnedToBottom.value) return
    const el2 = scrollContainer.value
    if (!el2) return
    el2.scrollTo({ top: el2.scrollHeight, behavior: 'auto' })
  })
}

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const el = scrollContainer.value
  if (!el) return
  pinnedToBottom.value = true
  el.scrollTo({ top: el.scrollHeight, behavior })
}

watch(mode, async () => {
  pinnedToBottom.value = true
  await keepPinnedAtBottom()
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
let refreshModelsRequest = 0
let modelsLoadedAt = 0
const MODEL_LIST_STALE_MS = 60_000

async function refreshModels(forceRefresh = false) {
  const requestId = ++refreshModelsRequest

  if (modelsLoading.value && !forceRefresh) return
  if (forceRefresh && modelsLoading.value) return

  const previous = codexModels.value
  modelsLoading.value = true
  modelsError.value = null

  try {
    const next = await listCodexModels({ forceRefresh })
    if (requestId !== refreshModelsRequest) return
    codexModels.value = next
    modelsLoadedAt = Date.now()
    reconcileModelChoicesWithCatalog()
  } catch (e) {
    if (requestId !== refreshModelsRequest) return
    if (forceRefresh) {
      codexModels.value = []
      modelsLoadedAt = 0
    } else {
      codexModels.value = previous
    }
    modelsError.value = e instanceof Error ? e.message : String(e)
    reconcileModelChoicesWithCatalog()
  } finally {
    if (requestId === refreshModelsRequest) {
      modelsLoading.value = false
    }
  }
}

function refreshModelsIfNeeded() {
  if (modelsLoading.value) return
  if (!codexModels.value.length) {
    void refreshModels(true)
    return
  }
  const now = Date.now()
  if (now - modelsLoadedAt >= MODEL_LIST_STALE_MS) {
    void refreshModels(true)
  }
}

function reconcileModelChoicesWithCatalog() {
  const available = new Set(codexModels.value.map((m) => m.model))
  if (!available.size) return

  for (const cfg of Object.values(configs.value)) {
    if (cfg.modelChoice === 'default') continue

    if (cfg.modelChoice === 'custom') {
      const custom = cfg.modelCustom.trim()
      if (custom && available.has(custom)) {
        cfg.modelChoice = custom
        cfg.modelCustom = ''
      }
      continue
    }

    if (available.has(cfg.modelChoice)) continue
    const prev = cfg.modelChoice
    cfg.modelChoice = 'custom'
    cfg.modelCustom = prev
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
  const workspacePath = String(props.workspacePath ?? '').trim()
  if (!workspacePath) return
  try {
    const defaults = (await window.codexDesigner?.getWorkspaceRunDefaults?.(workspacePath)) as WorkspaceRunDefaultsByRole | null
    if (String(props.workspacePath ?? '').trim() !== workspacePath) return
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
const qnaPlanNotes = ref('')
const qnaPlanNotesError = ref<string | null>(null)
const implementationMarkdown = ref<string | null>(null)
const implLoadError = ref<string | null>(null)
const implArtifactExistsByKey = ref<Record<string, boolean>>({})

let artifactsLoadSeq = 0
let runLogsLoadSeq = 0

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

async function loadHouseStyle(workspacePath = props.workspacePath) {
  const p = String(workspacePath ?? '').trim()
  if (!p) {
    houseStyleMarkdown.value = ''
    return
  }
  try {
    houseStyleMarkdown.value = await window.codexDesigner!.readTextFile(p, '.codex-designer/share/house-style.md')
  } catch {
    houseStyleMarkdown.value = ''
  }
}

async function loadArtifacts() {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!workspacePath || !featureSlug) return
  const artifactsKey = `${workspacePath}::${featureSlug}`

  const seq = ++artifactsLoadSeq
  artifactsLoading.value = true
  planLoadError.value = null
  qnaLoadError.value = null
  testLoadError.value = null
  implLoadError.value = null
  implementationMarkdown.value = null

  try {
    let nextPlanMarkdown = ''
    let nextPlanLoadError: string | null = null
    let nextQnaMarkdown = ''
    let nextQnaLoadError: string | null = null
    let nextQnaState: QnaStateV1 | null = null
    let nextTestLoadError: string | null = null
    let nextImplementationMarkdown: string | null = null
    let nextImplLoadError: string | null = null
    let nextImplExists = false

    try {
      nextPlanMarkdown = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.plan.md`)
    } catch (e) {
      nextPlanMarkdown = ''
      nextPlanLoadError = e instanceof Error ? e.message : String(e)
    }

    let loadedQna: QnaStateV1 | null = null
    try {
      const raw = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.qna.json`)
      const rawTrimmed = String(raw ?? '').trim().replace(/^\uFEFF/, '')
      const parsedRes = parseLenientJson(raw)
      const needsRewrite = !!parsedRes && parsedRes.jsonText !== rawTrimmed
      const parsed = parseQnaStateJson(raw)
      if (!parsed) throw new Error('Invalid Q&A JSON (expected version: 1).')
      const norm = normalizeQnaStateV1(parsed)
      loadedQna = norm.state
      if (norm.changed || needsRewrite) {
        await window.codexDesigner!.writeTextFile(
          workspacePath,
          `docs/${featureSlug}.qna.json`,
          JSON.stringify(loadedQna, null, 2) + '\n'
        )
      }
    } catch (e) {
      loadedQna = null
      nextQnaLoadError = e instanceof Error ? e.message : String(e)
    }

    if (loadedQna) {
      try {
        nextQnaMarkdown = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.qna.md`)
      } catch {
        nextQnaMarkdown = renderQnaMarkdownFromState(loadedQna)
        await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.md`, nextQnaMarkdown)
      }
      nextQnaState = loadedQna
    } else {
      nextQnaMarkdown = ''
      nextQnaState = null
    }

    let testNeedsRewrite = false
    let nextTestPlan: TestPlan | null = null
    try {
      const raw = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.test.json`)
      const rawTrimmed = String(raw ?? '').trim().replace(/^\uFEFF/, '')
      const parsed = parseLenientJson(raw)
      if (!parsed) throw new Error('Invalid test plan JSON.')
      testNeedsRewrite = parsed.jsonText !== rawTrimmed
      nextTestPlan = parsed.value as TestPlan
    } catch {
      nextTestPlan = createEmptyTestPlan(featureSlug)
      nextTestLoadError = null
    }
    if (nextTestPlan) {
      ensureRound(nextTestPlan)
      if (testNeedsRewrite) {
        await window.codexDesigner!.writeTextFile(
          workspacePath,
          `docs/${featureSlug}.test.json`,
          JSON.stringify(nextTestPlan, null, 2) + '\n'
        )
      }
    }

    try {
      nextImplementationMarkdown = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.impl.md`)
      nextImplExists = true
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (!errorMessage.includes('ENOENT')) {
        nextImplLoadError = errorMessage
        nextImplExists = true
      }
      nextImplementationMarkdown = null
    }

    await loadHouseStyle(workspacePath)

    if (seq !== artifactsLoadSeq) return

    planMarkdown.value = nextPlanMarkdown
    planLoadError.value = nextPlanLoadError

    qnaMarkdown.value = nextQnaMarkdown
    qnaLoadError.value = nextQnaLoadError
    qnaState.value = nextQnaState
    qnaPlanNotes.value = String(nextQnaState?.notes ?? '')

    testPlan.value = nextTestPlan
    testLoadError.value = nextTestLoadError

    implArtifactExistsByKey.value = { ...implArtifactExistsByKey.value, [artifactsKey]: nextImplExists }
    implementationMarkdown.value = nextImplementationMarkdown
    implLoadError.value = nextImplLoadError
  } finally {
    if (seq === artifactsLoadSeq) artifactsLoading.value = false
  }
}

// Allow external triggers to reload artifacts (e.g. background creation completing)
const onArtifactsUpdated = () => void loadArtifacts()
onMounted(() => {
  window.addEventListener('codex-designer:artifacts-updated', onArtifactsUpdated)
})
onUnmounted(() => {
  window.removeEventListener('codex-designer:artifacts-updated', onArtifactsUpdated)
})

const hasImplementationArtifact = computed(() => {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!workspacePath || !featureSlug) return false
  const key = `${workspacePath}::${featureSlug}`
  return implArtifactExistsByKey.value[key] === true
})
const qnaWriteLocked = computed(() => hasImplementationArtifact.value)
const documentTabs = computed(() => {
  const tabs: DocumentTab[] = ['plan', 'qna', 'tests']
  if (hasImplementationArtifact.value) tabs.push('implementation')
  return tabs
})
const implementationTabLabel = 'Implementation'

watch(
  () => hasImplementationArtifact.value,
  (has) => {
    if (!has && activeDocumentTab.value === 'implementation') {
      activeDocumentTab.value = 'plan'
    }
  }
)

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
  if (qnaWriteLocked.value) return
  qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: !qnaEditOpen.value[q.id] }
  if (!qnaEditOpen.value[q.id]) {
    // reset drafts when closing
    const cur = q.answers.length ? q.answers[q.answers.length - 1] : null
    draftSelected.value = { ...draftSelected.value, [q.id]: cur?.selectedKey ?? '' }
    draftNotes.value = { ...draftNotes.value, [q.id]: cur?.notes ?? '' }
  }
}

async function saveQnaPlanNotes(ctx?: { workspacePath: string; featureSlug: string }): Promise<{ state: QnaStateV1; markdown: string } | null> {
  const workspacePath = String(ctx?.workspacePath ?? props.workspacePath ?? '').trim()
  const featureSlug = String(ctx?.featureSlug ?? props.featureSlug ?? '').trim()
  if (!qnaState.value) return null
  if (qnaWriteLocked.value) return null
  const nextNotes = String(qnaPlanNotes.value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  const curNotes = String(qnaState.value.notes ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  if (nextNotes === curNotes) return null

  const nextState: QnaStateV1 = structuredClone(qnaState.value)
  nextState.notes = nextNotes
  nextState.updatedAt = new Date().toISOString()

  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\n')
  const md = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.md`, md)

  if (props.workspacePath === workspacePath && props.featureSlug === featureSlug) {
    qnaState.value = nextState
    qnaMarkdown.value = md
  }
  return { state: nextState, markdown: md }
}

async function saveQnaAnswer(q: QnaQuestionV1) {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!qnaState.value) return
  if (qnaWriteLocked.value) return

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

  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.json`, JSON.stringify(nextState, null, 2) + '\n')
  const md = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.md`, md)

  if (props.workspacePath !== workspacePath || props.featureSlug !== featureSlug) return
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

async function saveTestPlan(ctx?: { workspacePath: string; featureSlug: string }) {
  const workspacePath = String(ctx?.workspacePath ?? props.workspacePath ?? '').trim()
  const featureSlug = String(ctx?.featureSlug ?? props.featureSlug ?? '').trim()
  if (!testPlan.value) return
  const plan = structuredClone(testPlan.value)
  ensureRound(plan)
  const json = JSON.stringify(plan, null, 2) + '\n'
  const md = renderTestMarkdown(plan)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.test.json`, json)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.test.md`, md)
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

async function applyPlanningNextRoundOutput(runId: string, ctx: { workspacePath: string; featureSlug: string }) {
  const rec = await waitForRunDone(runId)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Planning run failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')

  const parsedRes = parseLenientJson(rec.finalResponse)
  if (!parsedRes) throw new Error('Failed to parse structured output.')
  const parsed = parsedRes.value as { planMarkdown: string; qnaRound: QnaRoundV1 }
  const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  assertValidPlanningPlanMarkdown(plan, props.featureSlug)
  const qnaRound = parsed.qnaRound

  const raw = await window.codexDesigner!.readTextFile(ctx.workspacePath, `docs/${ctx.featureSlug}.qna.json`)
  const existing = parseQnaStateJson(raw)
  if (!existing) throw new Error('Failed to read existing Q&A JSON state.')

  const nextState: QnaStateV1 = {
    ...existing,
    updatedAt: new Date().toISOString(),
    rounds: [...existing.rounds, qnaRound],
  }

  const normalized = normalizeQnaStateV1(nextState).state
  const qnaMd = renderQnaMarkdownFromState(normalized)

  await window.codexDesigner!.writeTextFile(ctx.workspacePath, `docs/${ctx.featureSlug}.qna.json`, JSON.stringify(normalized, null, 2) + '\n')
  await window.codexDesigner!.writeTextFile(ctx.workspacePath, `docs/${ctx.featureSlug}.qna.md`, qnaMd)
  await window.codexDesigner!.writeTextFile(ctx.workspacePath, `docs/${ctx.featureSlug}.plan.md`, plan)

  if (props.workspacePath === ctx.workspacePath && props.featureSlug === ctx.featureSlug) {
    await loadArtifacts()
  }
}

async function runNextPlanningRound(notes?: string, opts?: { force?: boolean }) {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  const ctx = { workspacePath, featureSlug }
  if (!workspacePath || !featureSlug) return

  if (qnaWriteLocked.value) return
  if (isRoleBusy('planning')) return
  if (!qnaState.value) return
  if (qnaComplete.value && !opts?.force) return
  const qnaPlanNotesSnapshot = String(qnaPlanNotes.value ?? '')
  const qnaMarkdownSnapshot = String(qnaMarkdown.value ?? '')
  const nextRoundNumber = (qnaState.value?.rounds?.length ?? 0) + 1

  await loadHouseStyle(workspacePath)

  qnaPlanNotesError.value = null
  let savedNotes: { state: QnaStateV1; markdown: string } | null = null
  try {
    savedNotes = await saveQnaPlanNotes(ctx)
  } catch (e) {
    qnaPlanNotesError.value = e instanceof Error ? e.message : String(e)
    return
  }

  const qnaMdForImages = savedNotes?.markdown ?? qnaMarkdownSnapshot
  const combinedNotes = [qnaPlanNotesSnapshot, notes].filter((n) => String(n ?? '').trim().length > 0).join('\n\n')
  const images = extractWorkspaceImagePaths(`${qnaMdForImages}\n\n${combinedNotes}`)

  const prompt = buildPlanningNextRoundPrompt({
    featureSlug,
    nextRoundNumber,
    additionalNotes: combinedNotes,
    houseStyleMarkdown: houseStyleMarkdown.value,
  })

  const runId = await startRun({
    workspacePath,
    featureSlug,
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
  void applyPlanningNextRoundOutput(runId, ctx).catch((e) => {
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
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!workspacePath || !featureSlug) return
  if (isRoleBusy('testing')) return

  const runId = await startRun({
    workspacePath,
    featureSlug,
    role: 'testing',
    profileId: configs.value.testing.profileId,
    model: modelValue(configs.value.testing) || undefined,
    modelReasoningEffort: (thinkingValue(configs.value.testing) as ModelReasoningEffort | '') || undefined,
    oneShotNetwork: configs.value.testing.profileId === 'careful' ? configs.value.testing.oneShotNetwork : undefined,
    input: `Generate a set of key manual tests for the feature "${featureSlug}". Use docs/${featureSlug}.plan.md and docs/${featureSlug}.qna.md as the source of truth. Output JSON that matches the provided schema.`,
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
  const plan = createEmptyTestPlan(featureSlug)
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
  const json = JSON.stringify(plan, null, 2) + '\n'
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.test.json`, json)
  const md = renderTestMarkdown(plan)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.test.md`, md)

  if (props.workspacePath === workspacePath && props.featureSlug === featureSlug) {
    testPlan.value = plan
  }
  showToast('Tests generated')
}

async function runImplementation() {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!workspacePath || !featureSlug) return
  if (isRoleBusy('implementation')) return
  const planSnapshot = String(planMarkdown.value ?? '')
  const qnaSnapshot = String(qnaMarkdown.value ?? '')
  await loadHouseStyle(workspacePath)
  const images = extractWorkspaceImagePaths(`${planSnapshot}\n\n${qnaSnapshot}`)
  const prompt = buildImplementationPrompt({ featureSlug, houseStyleMarkdown: houseStyleMarkdown.value })

  const runId = await startRun({
    workspacePath,
    featureSlug,
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
  const text = String(composerText.value ?? '').trim()
  if (isRoleBusy(role)) return false

  if (role === 'planning') {
    if (qnaWriteLocked.value) return false
    if (!qnaState.value) return false
    if (qnaComplete.value) return text.length > 0
    return true
  }
  if (role === 'testing') {
    return !!testPlan.value
  }
  return text.length > 0
}

async function sendComposer() {
  refreshModelsIfNeeded()
  const text = String(composerText.value ?? '').trim()
  const role = targetMode.value
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (isRoleBusy(role)) return

  if (role === 'planning') {
    const force = qnaComplete.value
    if (force && !text.length) return
    await runNextPlanningRound(text, { force })
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

  await loadHouseStyle(workspacePath)

  const cfg = configs.value[role]
  const attachments = extractWorkspaceImagePaths(text)
  const prompt =
    role === 'implementation'
      ? buildImplementationFollowupPrompt({
          featureSlug,
          message: text,
          attachments,
          houseStyleMarkdown: houseStyleMarkdown.value,
        })
      : `Continue the existing ${role} work for \`${featureSlug}\`.\n\n${text}`

  const images = extractWorkspaceImagePaths(prompt)

  await startRun({
    workspacePath,
    featureSlug,
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

function onKeydownComposer(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    const isMod = e.metaKey || e.ctrlKey
    if (isMod) {
      if (!isRoleBusy(targetMode.value) && canSendComposer()) {
        e.preventDefault()
        sendComposer().catch((err) => showToast(err instanceof Error ? err.message : String(err)))
      }
    }
  }
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

async function attachPastedImage(e: ClipboardEvent, afterSave: (relPath: string) => void | Promise<void>) {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
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
      workspacePath,
      featureSlug,
      ext: normalized.ext,
      bytesBase64: normalized.bytesBase64,
    })

    await afterSave(saved.relPath)
    showToast('Image attached')
    return
  }

  e.preventDefault()

  const dataUrl = dataUrlFromText ?? (file ? await readFileAsDataUrl(file) : '')
  const normalized = await normalizeClipboardImageForSaving(dataUrl)
  if (!normalized) return

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath,
    featureSlug,
    ext: normalized.ext,
    bytesBase64: normalized.bytesBase64,
  })

  await afterSave(saved.relPath)
  showToast('Image attached')
}

async function onPasteComposer(e: ClipboardEvent) {
  await attachPastedImage(e, (rel) => {
    const md = `![pasted image](${rel})`
    // Use the same cursor-aware logic as text paste
    const el = e.target as HTMLTextAreaElement
    const start = el.selectionStart ?? composerText.value.length
    const end = el.selectionEnd ?? composerText.value.length
    const existing = composerText.value
    const next = existing.slice(0, start) + md + existing.slice(end)
    composerText.value = next

    // Adjust caret after next tick
    nextTick(() => {
      const caret = start + md.length
      el.selectionStart = caret
      el.selectionEnd = caret
      el.focus()
    })
  })
}

async function onPasteQnaNotes(e: ClipboardEvent, q: QnaQuestionV1) {
  if (qnaWriteLocked.value) return
  await attachPastedImage(e, (rel) => {
    qnaEditOpen.value = { ...qnaEditOpen.value, [q.id]: true }
    
    const el = e.target as HTMLTextAreaElement
    const start = el?.selectionStart ?? (draftNotes.value[q.id] ?? '').length
    const end = el?.selectionEnd ?? (draftNotes.value[q.id] ?? '').length
    const existing = String(draftNotes.value[q.id] ?? '')
    const md = `![pasted image](${rel})`
    const next = existing.slice(0, start) + md + existing.slice(end)
    
    draftNotes.value = { ...draftNotes.value, [q.id]: next }

    if (el) {
      nextTick(() => {
        const caret = start + md.length
        el.selectionStart = caret
        el.selectionEnd = caret
        el.focus()
      })
    }
  })
}

async function onPasteTestFeedback(e: ClipboardEvent, round: TestRound, testId: string) {
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  await attachPastedImage(e, async (rel) => {
    const res = getResult(round, testId)
    if (!res.feedback[0].attachments.includes(rel)) {
      res.feedback[0].attachments.push(rel)
    }
    await saveTestPlan({ workspacePath, featureSlug })
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
  const workspacePath = String(props.workspacePath ?? '').trim()
  const featureSlug = String(props.featureSlug ?? '').trim()
  if (!workspacePath || !featureSlug) return

  const seq = ++runLogsLoadSeq
  runLogsLoading.value = true
  try {
    const metas = (await window.codexDesigner?.listRunLogs?.({
      workspacePath,
      featureSlug,
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

    if (seq === runLogsLoadSeq) {
      runLogsById.value = map
    }
  } finally {
    if (seq === runLogsLoadSeq) runLogsLoading.value = false
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
  workspaceDiff: RunRecord['workspaceDiff']
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
      workspaceDiff: r.workspaceDiff ?? null,
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
      workspaceDiff: buildWorkspaceDiffFromEvents(log.events),
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

const activityStreamSignal = computed(() => {
  const list = runsByMode.value[mode.value] ?? []
  return list.map((r) => {
    const evts = r.events ?? []
    const last = evts.length ? evts[evts.length - 1] : null
    return [r.runId, r.status, r.finalResponse.length, last]
  })
})

// Keep the activity pane pinned while streaming updates arrive.
watch(
  activityStreamSignal,
  async () => {
    if (!pinnedToBottom.value) return
    await keepPinnedAtBottom()
    onScroll()
  },
  { flush: 'post' }
)

type TodoOverlayItem = { text: string; completed: boolean }
type TodoOverlayState = { 
  runId: string
  role: SessionMode | null
  items: TodoOverlayItem[]
  done: number
  total: number
  status: string 
}

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
const todoPosition = ref({ x: 0, y: 0 })
const isDraggingTodo = ref(false)

function startDraggingTodo(e: MouseEvent) {
  isDraggingTodo.value = true
  const startX = e.clientX - todoPosition.value.x
  const startY = e.clientY - todoPosition.value.y

  const onMouseMove = (ev: MouseEvent) => {
    todoPosition.value = {
      x: ev.clientX - startX,
      y: ev.clientY - startY,
    }
  }

  const onMouseUp = () => {
    isDraggingTodo.value = false
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const todoOverlay = computed<TodoOverlayState | null>(() => {
  // Sort runs by startedAt descending to get the most recent ones first
  const candidates = [...mergedRuns.value].sort((a, b) => b.startedAt - a.startedAt)
  
  // Try to find the latest run that has a todo list
  for (const r of candidates) {
    const list = extractLatestTodoList(r.events)
    if (!list || list.length === 0) continue
    
    const done = list.filter((i) => i.completed).length
    return { 
      runId: r.runId, 
      role: (r.role as any) ?? null, 
      items: list, 
      done, 
      total: list.length,
      status: r.status
    }
  }
  return null
})

// Watcher to handle auto-showing and auto-hiding the todo list
watch(
  todoOverlay,
  (val, oldVal) => {
    if (!val) {
      showTodos.value = false
      return
    }

    // Auto-show when a NEW run with todos starts
    if (val.status === 'running' && val.runId !== todoDismissedRunId.value) {
      showTodos.value = true
    }

    // Auto-hide when the current run transitions out of "running"
    if (oldVal && oldVal.runId === val.runId && oldVal.status === 'running' && val.status !== 'running') {
      showTodos.value = false
    }
  },
  { immediate: true }
)

watch(
  () => todoOverlay.value?.runId ?? null,
  (next, prev) => {
    if (next !== prev) {
      // If the run changed, we reset the dismissal state (unless it's null)
      if (next) {
        // We don't necessarily clear it immediately if it's the same run
        // but if it's a NEW run, we want it to be able to pop up again.
      }
    }
  }
)

function hideTodos() {
  if (todoOverlay.value) {
    todoDismissedRunId.value = todoOverlay.value.runId
  }
  showTodos.value = false
}

function runTitle(r: RunCardRecord): string {
  if (r.uiAction) return r.uiAction
  return `${r.role ?? 'run'}`
}

function abort(runId: string) {
  void abortRun(runId).catch((e) => showToast(e instanceof Error ? e.message : String(e)))
}

onMounted(() => {
  void refreshModels(true)
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
          class="flex-1 overflow-y-auto p-4"
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
                    :disabled="qnaWriteLocked || isRoleBusy('planning') || qnaComplete"
                    @click="runNextPlanningRound()"
                  >
                    <span class="material-symbols-rounded text-[16px]">play_arrow</span>
                    Next Round
                  </button>
                </div>
              </div>
              <div v-if="qnaComplete && !qnaWriteLocked" class="mt-2 text-xs text-gray-600 dark:text-gray-300">
                Planning is complete. Type a note below and click Reopen Q&amp;A to generate another round.
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
                  :workspace-diff="r.workspaceDiff"
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
                  :workspace-diff="r.workspaceDiff"
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
                  :workspace-diff="r.workspaceDiff"
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
            @click="scrollToBottom()"
            aria-label="Scroll to bottom"
          >
            <span class="material-symbols-rounded block text-[20px] text-brand-600 dark:text-brand-400">arrow_downward</span>
          </button>

          <div class="mx-auto max-w-3xl">
            <div class="flex gap-4">
              <div class="flex-1">
                 <AttachmentPreviews
                  v-if="extractWorkspaceImagePaths(composerText).length"
                  class="mb-2"
                  :workspace-path="workspacePath"
                  :attachments="extractWorkspaceImagePaths(composerText)"
                  :max="6"
                />

                <AutoGrowTextarea
                  v-model="composerText"
                  :min-rows="2"
                  :max-rows="12"
                  class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none ring-0 placeholder:text-gray-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-brand-500 dark:focus:bg-gray-950"
                  :placeholder="
                    targetMode === 'implementation'
                      ? 'Type a message...'
                      : targetMode === 'planning' && qnaComplete
                        ? 'Type to reopen Q&A...'
                        : 'Add notes for the next round... (optional)'
                  "
                  :disabled="isRoleBusy(targetMode)"
                  @paste="onPasteComposer($event as ClipboardEvent)"
                  @keydown="onKeydownComposer"
                />
                
                <!-- Composer Controls -->
                    <div class="mt-2 flex items-center justify-between">
                   <div class="flex items-center gap-2">
                      <select
                        v-model="targetConfig.modelChoice"
                        class="rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:ring-0 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        :disabled="modelsLoading"
                      >
                        <option value="default" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Model: Default</option>
                        <option v-if="!modelsLoading && !codexModels.length" value="" disabled class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                          No models loaded
                        </option>
                        <option v-for="m in codexModels" :key="m.model" :value="m.model" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                          {{ m.displayName }}
                        </option>
                         <option value="custom" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Model: Custom</option>
                      </select>

                      <input
                        v-if="targetConfig.modelChoice === 'custom'"
                        v-model="targetConfig.modelCustom"
                        type="text"
                        class="w-48 rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-500 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:text-gray-200"
                        placeholder="Custom model"
                      />

                      <select
                        v-model="targetConfig.thinkingChoice"
                        class="rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:ring-0 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <option value="default" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: Default</option>
                        <option value="minimal" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: Minimal</option>
                        <option value="low" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: Low</option>
                        <option value="medium" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: Medium</option>
                        <option value="high" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: High</option>
                        <option value="xhigh" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Thinking: XHigh</option>
                      </select>

                      <button
                        class="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        type="button"
                        :disabled="modelsLoading"
                        title="Refresh models from Codex"
                        aria-label="Refresh models from Codex"
                        @click="refreshModels(true)"
                      >
                        <span class="material-symbols-rounded text-[16px]">refresh</span>
                      </button>
                      <div v-if="modelsError" class="text-[10px] font-medium text-red-600 dark:text-red-400">
                        {{ modelsError }}
                      </div>
                   </div>
                  <button
                    class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="!canSendComposer() || isRoleBusy(targetMode)"
                    @click="sendComposer().catch((e) => showToast(e instanceof Error ? e.message : String(e)))"
                  >
                    {{
                      targetMode === 'implementation'
                        ? 'Send'
                        : targetMode === 'planning' && qnaComplete
                          ? 'Reopen Q&A'
                          : 'Next Round'
                    }}
                    <span class="material-symbols-rounded text-[16px]">{{ targetMode === 'implementation' ? 'send' : 'play_arrow' }}</span>
                  </button>
                </div>
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
            v-for="tab in documentTabs"
            :key="tab"
            class="relative flex-1 px-4 py-3 text-xs font-bold transition-colors hover:text-gray-900 dark:hover:text-gray-100"
             :class="activeDocumentTab === tab ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400'"
            @click="activeDocumentTab = tab"
          >
            {{ tab === 'qna' ? 'Q&A' : tab === 'implementation' ? implementationTabLabel : tab.charAt(0).toUpperCase() + tab.slice(1) }}
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

             <div
               v-else-if="qnaWriteLocked"
               class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
             >
               Q&amp;A is read-only because <span class="font-mono">docs/{{ featureSlug }}.impl.md</span> exists.
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
                      :disabled="qnaWriteLocked"
                    />
                    <div class="mt-2 flex justify-end">
                       <button
                        class="text-[10px] font-bold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                         :disabled="qnaWriteLocked"
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
                            <!-- Answer history -->
                            <div class="text-xs pl-2 border-l-2 border-brand-500 text-gray-600 dark:text-gray-400 space-y-2">
                              <template v-if="q.answers.length">
                                <div class="space-y-1">
                                  <div class="flex items-baseline justify-between gap-2">
                                    <div class="min-w-0">
                                      <span class="font-mono font-bold">{{ q.answers[q.answers.length - 1].selectedKey }}</span>
                                      <span class="ml-1">{{ selectedOptionText(q, q.answers[q.answers.length - 1].selectedKey) }}</span>
                                    </div>
                                    <div class="shrink-0 text-[10px] text-gray-400">
                                      {{ new Date(q.answers[q.answers.length - 1].createdAt).toLocaleString() }}
                                    </div>
                                  </div>
                                  <div
                                    v-if="String(q.answers[q.answers.length - 1].notes ?? '').trim().length"
                                    class="whitespace-pre-wrap text-[11px] text-gray-600 dark:text-gray-400"
                                  >
                                    {{ q.answers[q.answers.length - 1].notes }}
                                  </div>
                                </div>

                                <details v-if="q.answers.length > 1" class="mt-1">
                                  <summary class="cursor-pointer text-[10px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                                    Previous answers ({{ q.answers.length - 1 }})
                                  </summary>
                                  <div class="mt-2 space-y-2">
                                    <div
                                      v-for="a in q.answers.slice(0, -1).slice().reverse()"
                                      :key="a.id"
                                      class="rounded-lg border border-gray-200 bg-white/60 p-2 dark:border-gray-700 dark:bg-gray-900/60"
                                    >
                                      <div class="flex items-baseline justify-between gap-2">
                                        <div class="min-w-0">
                                          <span class="font-mono font-bold">{{ a.selectedKey }}</span>
                                          <span class="ml-1">{{ selectedOptionText(q, a.selectedKey) }}</span>
                                        </div>
                                        <div class="shrink-0 text-[10px] text-gray-400">
                                          {{ new Date(a.createdAt).toLocaleString() }}
                                        </div>
                                      </div>
                                      <div
                                        v-if="String(a.notes ?? '').trim().length"
                                        class="mt-1 whitespace-pre-wrap text-[11px] text-gray-600 dark:text-gray-400"
                                      >
                                        {{ a.notes }}
                                      </div>
                                    </div>
                                  </div>
                                </details>
                              </template>
                              <template v-else>
                                <div class="italic text-gray-500">Not answered yet.</div>
                                <div class="text-[10px] text-gray-500">
                                  Recommended: <span class="font-mono font-bold">{{ q.recommendedKey }}</span> — {{ selectedOptionText(q, q.recommendedKey) }}
                                </div>
                              </template>
                            </div>
                            <button 
                              class="text-[10px] text-brand-600 underline"
                              :disabled="qnaWriteLocked"
                              :class="qnaWriteLocked ? 'opacity-50 cursor-not-allowed' : ''"
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
                                  class="text-left text-[10px] px-2 py-1.5 rounded border transition-colors"
                                  :class="(draftSelected[q.id] || inferredSelectedKey(q)) === opt.key 
                                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm' 
                                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'"
                                  :disabled="qnaWriteLocked"
                                  @click="draftSelected = { ...draftSelected, [q.id]: opt.key }"
                                >
                                  <span class="font-bold mr-1">{{ opt.key }}</span> {{ opt.text }}
                                </button>
                              </div>
                              <AutoGrowTextarea
                                v-model="draftNotes[q.id]"
                                class="w-full text-xs p-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
                                placeholder="Notes..."
                                :disabled="qnaWriteLocked"
                                @paste="onPasteQnaNotes($event as ClipboardEvent, q)"
                              />
                              <button 
                                class="w-full py-1 bg-brand-600 text-white rounded text-[10px] font-bold"
                                :disabled="qnaWriteLocked"
                                :class="qnaWriteLocked ? 'opacity-50 cursor-not-allowed' : ''"
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
                      <div v-for="t in testPlan.tests" :key="t.id" class="space-y-2">
                        <div class="flex items-start justify-between gap-2 text-xs">
                          <div class="font-medium flex-1">{{ t.id }}: {{ t.title }}</div>
                          <select
                            class="shrink-0 rounded border-gray-200 py-0.5 pl-2 pr-6 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            :value="getResult(round, t.id).status"
                            @change="setTestStatus(round, t.id, ($event.target as HTMLSelectElement).value).catch(console.error)"
                          >
                            <option value="not_run" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Not Run</option>
                            <option value="pass" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Pass</option>
                            <option value="fail" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Fail</option>
                            <option value="deferred" class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">Deferred</option>
                          </select>
                        </div>

                        <!-- Feedback/Notes -->
                          <AutoGrowTextarea
                            v-model="getResult(round, t.id).feedback[0].text"
                            class="w-full text-[10px] p-2 rounded bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800"
                            placeholder="Add feedback / results..."
                            @blur="saveTestPlan()"
                            @paste="onPasteTestFeedback($event as ClipboardEvent, round, t.id)"
                          />
                        <AttachmentPreviews
                          v-if="getResult(round, t.id).feedback[0].attachments.length"
                          :workspace-path="workspacePath"
                          :attachments="getResult(round, t.id).feedback[0].attachments"
                          size-class="h-12 w-12"
                          :max="4"
                        />
                      </div>
                    </div>
                 </div>
             </div>
             <div v-else class="text-xs text-gray-500">No test plan loaded.</div>
           </div>

           <!-- Implementation Notes Tab -->
            <div v-if="activeDocumentTab === 'implementation'" class="space-y-4">
              <div v-if="implLoadError" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                {{ implLoadError }}
              </div>
              <div v-else-if="implementationMarkdown === null" class="text-xs text-gray-500">
                Implementation notes file not found yet (`docs/${featureSlug}.impl.md`).
              </div>
              <MarkdownViewer
                v-else
                class="prose prose-sm prose-gray dark:prose-invert max-w-none"
               :markdown="implementationMarkdown"
             />
           </div>

           <!-- Removed Todos Tab (moved to overlay) -->
        </div>
      </div>
    </div>
  </div>

  <!-- Todo Overlay -->
  <div
    v-if="showTodos"
    class="fixed z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-stone-900"
    :style="{
      left: todoPosition.x + 'px',
      top: todoPosition.y + 'px',
      maxHeight: '50vh'
    }"
  >
    <div 
      class="flex cursor-move items-center justify-between border-b border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-stone-800/50"
      @mousedown="startDraggingTodo"
    >
      <div class="flex items-center gap-2">
        <span class="material-symbols-rounded text-[20px] text-brand-600 dark:text-brand-400">checklist</span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Todo List</span>
      </div>
      <button 
        class="rounded p-1 hover:bg-gray-200 dark:hover:bg-stone-700"
        @click="hideTodos"
      >
        <span class="material-symbols-rounded text-[20px] text-gray-400">close</span>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 shrink-0">
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
       <div v-else class="text-xs text-gray-500 italic p-3">
          No active todo list found.
       </div>
    </div>
  </div>
  
  <ToastHost :toasts="toasts" />
</template>
