<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppState } from '../lib/appState'
import { parseQnaMarkdown } from '../lib/qna'
import { listCodexModels, type CodexModelInfo } from '../lib/models'
import { buildImplementationPrompt, buildPlanningCreatePrompt, buildPlanningNextRoundPrompt } from '../lib/prompts'
import {
  parseQnaStateJson,
  renderQnaMarkdownFromState,
  normalizeQnaStateV1,
  type QnaAnswerRevisionV1,
  type QnaQuestionV1,
  type QnaRoundV1,
  type QnaStateV1,
} from '../lib/qnaState'
import { useRunStore, type ModelReasoningEffort } from '../lib/runStore'
import { createEmptyTestPlan, ensureRound, renderTestMarkdown, type TestPlan, type TestRound } from '../lib/tests'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import AutoGrowTextarea from '../components/AutoGrowTextarea.vue'
import RunEventStream from '../components/RunEventStream.vue'
import ModelsInspector from '../components/ModelsInspector.vue'
import AttachmentPreviews from '../components/AttachmentPreviews.vue'
import ToastHost from '../components/ToastHost.vue'

const { activeWorkspace, openWorkspace, initGit } = useAppState()
const route = useRoute()
const router = useRouter()
const { startRun, abortRun, getRun } = useRunStore()

const selectedSlug = computed(() => (route.params.slug ? String(route.params.slug) : null))
const selectedFeatureExists = computed(() => {
  if (!activeWorkspace.value || !selectedSlug.value) return false
  return activeWorkspace.value.features.some((f) => f.slug === selectedSlug.value)
})

const q = ref('')
const filtered = computed(() => {
  const features = activeWorkspace.value?.features ?? []
  const query = q.value.trim().toLowerCase()
  if (!query) return features
  return features.filter((f) => f.slug.toLowerCase().includes(query))
})

function openFeature(slug: string) {
  router.push(`/session/${encodeURIComponent(slug)}?tab=planning`)
}

function closeFeature() {
  router.push('/session')
}

const tab = computed(() => {
  const raw = String(route.query.tab ?? 'planning')
  if (raw === 'plan' || raw === 'implement' || raw === 'testing') return raw
  return 'planning'
})

function setTab(next: string) {
  router.replace({ query: { ...route.query, tab: next } })
}

const planningProfileId = ref<'careful' | 'yolo'>('yolo')
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
const oneShotNetwork = ref(false)

const implementationProfileId = ref<'careful' | 'yolo'>('yolo')
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
const implementationOneShotNetwork = ref(false)
const lastImplementationRunId = ref<string | null>(null)
const lastImplementationRun = computed(() => getRun(lastImplementationRunId.value))
const lastImplementationCheckpoint = computed(() => lastImplementationRun.value?.checkpoint ?? null)

const diffStat = ref<string>('')
const diffText = ref<string>('')
const diffLoading = ref(false)

const artifactsLoading = ref(false)
const planMarkdown = ref<string>('')
const qnaMarkdown = ref<string>('')
const qnaState = shallowRef<QnaStateV1 | null>(null)
const planLoadError = ref<string | null>(null)
const qnaLoadError = ref<string | null>(null)
const qnaLocked = ref(false)

const draftSelected = ref<Record<string, string>>({})
const draftNotes = ref<Record<string, string>>({})
const draftCache = ref<Record<string, { selectedKey: string; notes: string }>>({})
const qnaEditOpen = ref<Record<string, boolean>>({})
const qnaRoundOpen = ref<Record<string, boolean>>({})
const qnaRounds = computed(() => qnaState.value?.rounds ?? [])
const qnaComplete = computed(() => {
  const rounds = qnaRounds.value
  if (!rounds.length) return false
  const last = rounds[rounds.length - 1]
  return (last?.questions?.length ?? 0) === 0
})

const activeRunId = ref<string | null>(null)
const activeRun = computed(() => getRun(activeRunId.value))
const isRunBusy = computed(() => activeRun.value?.status === 'running')

const codexModels = ref<CodexModelInfo[]>([])
const modelsLoading = ref(false)
const modelsError = ref<string | null>(null)

const testPlan = ref<TestPlan | null>(null)
const testLoadError = ref<string | null>(null)
const commitMode = ref<'careful' | 'yolo'>('careful')
const commitMessage = ref<string>('')
const commitResult = ref<{ commit: string; stdout: string; stderr: string } | null>(null)

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let suppressDraftAutosave = false
let draftsSaveTimer: ReturnType<typeof setTimeout> | null = null

const DRAFTS_PATH = `.codex-designer/cache/drafts.json`

type DraftEntryV2 = { selectedKey: string; notes: string }
type DraftsFileV2 = {
  version: 2
  updatedAt: string
  drafts: Record<string, Record<string, DraftEntryV2>>
}

async function loadDraftCache() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  try {
    const raw = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, DRAFTS_PATH)
    const parsed = JSON.parse(raw) as any
    if (parsed?.version === 2) {
      const next = parsed?.drafts?.[selectedSlug.value]
      if (next && typeof next === 'object') {
        draftCache.value = { ...next }
        return
      }
      draftCache.value = {}
      return
    }
    if (parsed?.version === 1) {
      const legacy = parsed?.drafts?.[selectedSlug.value]
      if (legacy && typeof legacy === 'object') {
        const next: Record<string, DraftEntryV2> = {}
        for (const [k, v] of Object.entries(legacy)) {
          next[String(k)] = { selectedKey: '', notes: String(v ?? '') }
        }
        draftCache.value = next
        return
      }
      draftCache.value = {}
    } else {
      draftCache.value = {}
    }
  } catch {
    draftCache.value = {}
  }
}

async function writeDraftCacheForFeature(
  featureSlug: string,
  selected: Record<string, string>,
  notes: Record<string, string>
) {
  if (!activeWorkspace.value) return
  let parsed: DraftsFileV2 | null = null
  try {
    const raw = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, DRAFTS_PATH)
    parsed = JSON.parse(raw) as DraftsFileV2
  } catch {
    parsed = null
  }

  const drafts = { ...((parsed && parsed.version === 2 ? parsed.drafts : {}) ?? {}) }

  const allKeys = new Set<string>([
    ...Object.keys(selected ?? {}),
    ...Object.keys(notes ?? {}),
  ])

  const entries: Record<string, DraftEntryV2> = {}
  for (const qId of allKeys) {
    const sel = String(selected?.[qId] ?? '').trim()
    const n = String(notes?.[qId] ?? '').trimEnd()
    if (!sel.length && !n.trim().length) continue
    entries[qId] = { selectedKey: sel, notes: n }
  }

  if (Object.keys(entries).length) drafts[featureSlug] = entries
  else delete drafts[featureSlug]

  const next: DraftsFileV2 = {
    version: 2,
    updatedAt: new Date().toISOString(),
    drafts,
  }
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, DRAFTS_PATH, JSON.stringify(next, null, 2) + '\n')
}

function scheduleDraftAutosave() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (suppressDraftAutosave) return
  if (draftsSaveTimer) clearTimeout(draftsSaveTimer)
  draftsSaveTimer = setTimeout(() => {
    draftsSaveTimer = null
    void writeDraftCacheForFeature(selectedSlug.value!, draftSelected.value, draftNotes.value).catch(() => {})
  }, 500)
}

async function waitForRunDone(runId: string, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = getRun(runId)
    if (r && r.status !== 'running') return r
    await sleep(250)
  }
  throw new Error('Timed out waiting for run to complete.')
}

function stripCodeFences(text: string): string {
  const trimmed = (text ?? '').trim()
  const m = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*)\n```$/)
  return m ? m[1] : text
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function extractWorkspaceImagePaths(markdown: string): string[] {
  const raw = String(markdown ?? '')
  const matches = raw.match(/docs\/assets\/[^\s)\]]+/g) ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    const cleaned = m.replace(/[)\],.]+$/g, '')
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

async function loadArtifacts() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  artifactsLoading.value = true
  planLoadError.value = null
  qnaLoadError.value = null
  testLoadError.value = null
  qnaLocked.value = false
  draftCache.value = {}
  qnaState.value = null
  qnaRoundOpen.value = {}

  try {
    planMarkdown.value = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.plan.md`)
  } catch (e) {
    planMarkdown.value = ''
    planLoadError.value = e instanceof Error ? e.message : String(e)
  }

  let loadedQnaState: QnaStateV1 | null = null
  try {
    const raw = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.json`)
    loadedQnaState = parseQnaStateJson(raw)
  } catch {
    loadedQnaState = null
  }

  if (!loadedQnaState) {
    try {
      qnaMarkdown.value = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`)
      loadedQnaState = migrateLegacyQnaMarkdownToState(selectedSlug.value, qnaMarkdown.value)
      await window.codexDesigner!.writeTextFile(
        activeWorkspace.value.path,
        `docs/${selectedSlug.value}.qna.json`,
        JSON.stringify(loadedQnaState, null, 2) + '\n'
      )
    } catch (e) {
      qnaMarkdown.value = ''
      qnaLoadError.value = e instanceof Error ? e.message : String(e)
      loadedQnaState = null
    }
  } else {
    const norm = normalizeQnaStateV1(loadedQnaState)
    if (norm.changed) {
      loadedQnaState = norm.state
      await window.codexDesigner!.writeTextFile(
        activeWorkspace.value.path,
        `docs/${selectedSlug.value}.qna.json`,
        JSON.stringify(loadedQnaState, null, 2) + '\n'
      )
    }
    try {
      qnaMarkdown.value = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`)
    } catch {
      qnaMarkdown.value = renderQnaMarkdownFromState(loadedQnaState)
      await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`, qnaMarkdown.value)
    }
  }

  qnaState.value = loadedQnaState
  resetQnaRoundOpen()

  await loadDraftCache()

  try {
    const raw = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.test.json`)
    testPlan.value = JSON.parse(raw) as TestPlan
  } catch (e) {
    testPlan.value = createEmptyTestPlan(selectedSlug.value)
    testLoadError.value = null
  }

  try {
    const rawState = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `.codex-designer/cache/state.json`)
    const parsed = JSON.parse(rawState) as any
    const implThreadId = parsed?.features?.[selectedSlug.value]?.implementationThreadId
    qnaLocked.value = typeof implThreadId === 'string' && implThreadId.trim().length > 0
  } catch {
    qnaLocked.value = false
  }

  artifactsLoading.value = false
}

function resetQnaRoundOpen() {
  const rounds = qnaRounds.value
  const next: Record<string, boolean> = {}
  for (const r of rounds) next[r.id] = false
  if (rounds.length) next[rounds[rounds.length - 1].id] = true
  qnaRoundOpen.value = next
}

function toggleQnaRound(id: string) {
  qnaRoundOpen.value = { ...qnaRoundOpen.value, [id]: !qnaRoundOpen.value[id] }
}

function migrateLegacyQnaMarkdownToState(featureSlug: string, markdown: string): QnaStateV1 {
  const legacy = parseQnaMarkdown(markdown)
  const now = new Date().toISOString()

  const parseLegacyAnswer = (recommendedKey: string, text: string) => {
    const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
    const trimmed = raw.trim()
    if (/^[A-Z]$/.test(trimmed)) {
      return { selectedKey: trimmed, notes: '' }
    }
    const first = raw.split('\n')[0] ?? ''
    const m = first.match(/^\s*([A-Z])\s*[:\)\-]\s*(.*)\s*$/i)
    if (m) {
      const key = String(m[1] ?? '').trim().toUpperCase()
      const restFirst = String(m[2] ?? '').trimEnd()
      const restLines = raw.split('\n').slice(1)
      const rebuilt = [restFirst, ...restLines].join('\n').trimStart().trimEnd()
      return { selectedKey: key, notes: rebuilt }
    }
    return { selectedKey: recommendedKey, notes: raw }
  }

  const rounds: QnaRoundV1[] = legacy.rounds.map((r, rIdx) => {
    const roundNumber = rIdx + 1
    const title = r.title?.toLowerCase().startsWith('round') ? r.title : `Round ${roundNumber}`
    const questions = r.questions.map((q, qIdx) => {
      const options = (q.options ?? []).map((o) => ({
        key: String(o.key),
        text: String(o.text ?? ''),
        recommended: !!o.recommended,
      }))
      const fallbackKey = options[0]?.key ?? 'A'
      const recommendedKey = (q.recommendedKey ?? options.find((o) => o.recommended)?.key ?? fallbackKey).toUpperCase()
      for (const opt of options) opt.recommended = opt.key === recommendedKey

      const answers = (q.answers ?? []).map((a, aIdx) => {
        const text = String(a.text ?? '').trimEnd()
        const parsed = parseLegacyAnswer(recommendedKey, text)
        const selectedKey = parsed.selectedKey
        const notes = parsed.notes
        return {
          id: `rev-${aIdx + 1}`,
          createdAt: now,
          selectedKey,
          notes,
          attachments: extractWorkspaceImagePaths(notes),
        }
      })

      return {
        id: `r${roundNumber}-q${qIdx + 1}`,
        prompt: q.prompt,
        options,
        recommendedKey,
        answers,
      }
    })
    return { id: `round-${roundNumber}`, title, questions }
  })

  return { version: 1, featureSlug, updatedAt: now, rounds }
}

async function applyPlanningCreateOutput(runId: string, workspacePath: string, featureSlug: string) {
  const rec = await waitForRunDone(runId, LONG_RUN_TIMEOUT_MS)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Planning run failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')
  const parsed = JSON.parse(stripCodeFences(rec.finalResponse)) as { planMarkdown: string; qna: QnaStateV1 }
  const qnaState = normalizeQnaStateV1(parsed.qna).state
  const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\r\n/g, '\n'))
  const qnaMd = renderQnaMarkdownFromState(qnaState)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.json`, JSON.stringify(qnaState, null, 2) + '\n')
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.md`, qnaMd)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.plan.md`, plan)
  await openWorkspace(workspacePath)
  if (selectedSlug.value === featureSlug) await loadArtifacts()
}

async function applyPlanningNextRoundOutput(runId: string, workspacePath: string, featureSlug: string) {
  const rec = await waitForRunDone(runId, LONG_RUN_TIMEOUT_MS)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Planning run failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')
  const parsed = JSON.parse(stripCodeFences(rec.finalResponse)) as { planMarkdown: string; qnaRound: QnaRoundV1 }
  const plan = ensureTrailingNewline(String(parsed.planMarkdown ?? '').replace(/\r\n/g, '\n'))
  const qnaRound = parsed.qnaRound

  const raw = await window.codexDesigner!.readTextFile(workspacePath, `docs/${featureSlug}.qna.json`)
  const existing = parseQnaStateJson(raw)
  if (!existing) throw new Error('Failed to read existing Q&A JSON state.')

  const nextState: QnaStateV1 = {
    ...existing,
    updatedAt: new Date().toISOString(),
    rounds: [...existing.rounds, qnaRound],
  }

  const normalized = normalizeQnaStateV1(nextState).state
  const qnaMd = renderQnaMarkdownFromState(normalized)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.json`, JSON.stringify(normalized, null, 2) + '\n')
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.qna.md`, qnaMd)
  await window.codexDesigner!.writeTextFile(workspacePath, `docs/${featureSlug}.plan.md`, plan)
  await loadArtifacts()
}

watch(
  () => selectedSlug.value,
  () => {
    if (!selectedSlug.value) return
    void loadArtifacts()
  },
  { immediate: true }
)

watch(
  () => ({ state: qnaState.value, cache: draftCache.value }),
  ({ state, cache }) => {
    if (!state) return
    const nextSelected: Record<string, string> = {}
    const nextNotes: Record<string, string> = {}
    const nextOpen: Record<string, boolean> = {}

    for (const round of state.rounds) {
      for (const q of round.questions) {
        const cached = cache?.[q.id]
        if (cached) {
          nextSelected[q.id] = String(cached.selectedKey ?? '')
          nextNotes[q.id] = String(cached.notes ?? '')
          nextOpen[q.id] = true
          continue
        }

        nextSelected[q.id] = ''
        nextNotes[q.id] = ''
        nextOpen[q.id] = q.answers.length === 0
      }
    }

    suppressDraftAutosave = true
    draftSelected.value = nextSelected
    draftNotes.value = nextNotes
    qnaEditOpen.value = nextOpen
    queueMicrotask(() => {
      suppressDraftAutosave = false
    })
  },
  { immediate: true }
)

watch(
  [draftSelected, draftNotes],
  () => {
    scheduleDraftAutosave()
  },
  { deep: true }
)

function normalizeNotes(text: unknown): string {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
}

function uniqSorted(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function getCurrentAnswer(q: QnaQuestionV1): QnaAnswerRevisionV1 | null {
  return q.answers.length ? q.answers[q.answers.length - 1] : null
}

function isEditingQnaQuestion(q: QnaQuestionV1): boolean {
  if (!q.answers.length) return true
  return qnaEditOpen.value[q.id] === true
}

function selectedOptionText(q: QnaQuestionV1, key: string): string {
  return q.options.find((o) => o.key === key)?.text ?? ''
}

function beginRevision(q: QnaQuestionV1) {
  qnaEditOpen.value[q.id] = true
  const existingSel = String(draftSelected.value[q.id] ?? '').trim()
  const existingNotes = String(draftNotes.value[q.id] ?? '').trim()
  if (existingSel.length || existingNotes.length) return
  const cur = getCurrentAnswer(q)
  if (!cur) return
  draftSelected.value[q.id] = cur.selectedKey
  draftNotes.value[q.id] = cur.notes
}

function inferSelectedKeyFromNotes(q: QnaQuestionV1, notes: string): { selectedKey: string | null; nextNotes: string } {
  const raw = String(notes ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const first = raw.split('\n')[0] ?? ''
  const m = first.match(/^\s*([A-Z])\s*[:\)\-]\s*(.*)\s*$/i)
  if (!m) return { selectedKey: null, nextNotes: raw }
  const key = String(m[1] ?? '').trim().toUpperCase()
  if (!q.options.some((o) => o.key === key)) return { selectedKey: null, nextNotes: raw }
  const restFirst = String(m[2] ?? '').trimEnd()
  const restLines = raw.split('\n').slice(1)
  const rebuilt = [restFirst, ...restLines].join('\n').trimStart()
  return { selectedKey: key, nextNotes: rebuilt.trimEnd() }
}

async function commitCurrentRound() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value) return
  if (!qnaState.value) return

  const now = new Date().toISOString()
  const nextState = structuredClone(qnaState.value)
  const latestRoundId = nextState.rounds.length ? nextState.rounds[nextState.rounds.length - 1].id : null

  let changed = false
  for (const round of nextState.rounds) {
    const inLatestRound = latestRoundId ? round.id === latestRoundId : true
    for (const q of round.questions) {
      const draftSel = String(draftSelected.value[q.id] ?? '').trim()
      const draftN = normalizeNotes(draftNotes.value[q.id] ?? '')
      const hasDraft = draftSel.length > 0 || draftN.trim().length > 0

      const shouldCommit =
        q.answers.length === 0 ? inLatestRound : (qnaEditOpen.value[q.id] === true && hasDraft)
      if (!shouldCommit) continue

      const inferred = draftSel.length ? { selectedKey: null as string | null, nextNotes: draftN } : inferSelectedKeyFromNotes(q, draftN)
      const selectedKey = (draftSel || inferred.selectedKey || q.recommendedKey).toUpperCase()
      const notes = inferred.nextNotes
      const attachments = uniqSorted(extractWorkspaceImagePaths(notes))

      const cur = getCurrentAnswer(q)
      if (cur) {
        const same =
          cur.selectedKey === selectedKey &&
          normalizeNotes(cur.notes) === notes &&
          arraysEqual(uniqSorted(cur.attachments ?? []), attachments)
        if (same) {
          qnaEditOpen.value[q.id] = false
          continue
        }
      }

      q.answers.push({
        id: `rev-${q.answers.length + 1}`,
        createdAt: now,
        selectedKey,
        notes,
        attachments,
      })
      changed = true
      qnaEditOpen.value[q.id] = false
    }
  }

  if (!changed) return
  nextState.updatedAt = now
  await window.codexDesigner!.writeTextFile(
    activeWorkspace.value.path,
    `docs/${selectedSlug.value}.qna.json`,
    JSON.stringify(nextState, null, 2) + '\n'
  )
  const nextMd = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`, nextMd)
  qnaState.value = nextState
  qnaMarkdown.value = nextMd

  suppressDraftAutosave = true
  draftCache.value = {}
  draftSelected.value = {}
  draftNotes.value = {}
  queueMicrotask(() => {
    suppressDraftAutosave = false
  })

  await writeDraftCacheForFeature(selectedSlug.value, {}, {})
}

async function runNextRound(force = false) {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value) return
  if (!force && qnaComplete.value) return
  if (!qnaState.value) return
  await commitCurrentRound()
  const nextRoundNumber = (qnaState.value?.rounds?.length ?? 0) + 1
  const images = extractWorkspaceImagePaths(qnaMarkdown.value)
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'planning',
    profileId: planningProfileId.value,
    model: planningModelValue.value || undefined,
    modelReasoningEffort: planningThinkingValue.value || undefined,
    oneShotNetwork: planningProfileId.value === 'careful' ? oneShotNetwork.value : undefined,
    input: inputWithImages(buildPlanningNextRoundPrompt({ featureSlug: selectedSlug.value, nextRoundNumber }), images),
    outputSchema: PLAN_NEXT_ROUND_SCHEMA,
  })
  activeRunId.value = runId
  oneShotNetwork.value = false
  void applyPlanningNextRoundOutput(runId, activeWorkspace.value.path, selectedSlug.value).catch((e) => {
    console.error(e)
  })
}

async function regenerateLatestRound() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value) return
  if (isRunBusy.value) return
  if (!qnaState.value) return

  const rounds = qnaState.value.rounds
  if (!rounds.length) return
  const latest = rounds[rounds.length - 1]

  const ok = window.confirm(
    `Regenerate ${latest.title}?\n\nThis will delete the current questions (and any answers) in the latest round and generate a new set.`
  )
  if (!ok) return

  const now = new Date().toISOString()
  const nextState: QnaStateV1 = {
    ...qnaState.value,
    updatedAt: now,
    rounds: qnaState.value.rounds.slice(0, -1),
  }

  const nextMd = renderQnaMarkdownFromState(nextState)
  await window.codexDesigner!.writeTextFile(
    activeWorkspace.value.path,
    `docs/${selectedSlug.value}.qna.json`,
    JSON.stringify(nextState, null, 2) + '\n'
  )
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`, nextMd)
  qnaState.value = nextState
  qnaMarkdown.value = nextMd

  suppressDraftAutosave = true
  draftCache.value = {}
  draftSelected.value = {}
  draftNotes.value = {}
  qnaEditOpen.value = {}
  queueMicrotask(() => {
    suppressDraftAutosave = false
  })
  await writeDraftCacheForFeature(selectedSlug.value, {}, {})

  const nextRoundNumber = (nextState.rounds?.length ?? 0) + 1
  const images = extractWorkspaceImagePaths(qnaMarkdown.value)
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'planning',
    profileId: planningProfileId.value,
    model: planningModelValue.value || undefined,
    modelReasoningEffort: planningThinkingValue.value || undefined,
    oneShotNetwork: planningProfileId.value === 'careful' ? oneShotNetwork.value : undefined,
    input: inputWithImages(buildPlanningNextRoundPrompt({ featureSlug: selectedSlug.value, nextRoundNumber }), images),
    outputSchema: PLAN_NEXT_ROUND_SCHEMA,
  })
  activeRunId.value = runId
  oneShotNetwork.value = false
  void applyPlanningNextRoundOutput(runId, activeWorkspace.value.path, selectedSlug.value).catch((e) => {
    console.error(e)
  })
}

async function stopRun() {
  if (!activeRunId.value) return
  await abortRun(activeRunId.value)
}

async function saveTestPlan() {
  if (!activeWorkspace.value || !selectedSlug.value || !testPlan.value) return
  const json = JSON.stringify(testPlan.value, null, 2) + '\n'
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.test.json`, json)
  const md = renderTestMarkdown(testPlan.value)
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.test.md`, md)
}

async function runImplementation() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  const images = extractWorkspaceImagePaths(`${planMarkdown.value}\n\n${qnaMarkdown.value}`)
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'implementation',
    profileId: implementationProfileId.value,
    model: implementationModelValue.value || undefined,
    modelReasoningEffort: implementationThinkingValue.value || undefined,
    oneShotNetwork: implementationProfileId.value === 'careful' ? implementationOneShotNetwork.value : undefined,
    input: inputWithImages(buildImplementationPrompt({ featureSlug: selectedSlug.value }), images),
  })
  activeRunId.value = runId
  lastImplementationRunId.value = runId
  implementationOneShotNetwork.value = false
}

function getFeedbackContext() {
  if (!testPlan.value || !selectedSlug.value) return null
  const round = getCurrentRound()
  if (!round) return null

  const failing = testPlan.value.tests
    .map((t) => {
      const res = round.results[t.id]
      const status = res?.status ?? 'not_run'
      if (status !== 'fail' && status !== 'blocked') return null
      const fb = res?.feedback?.[0] ?? { text: '', attachments: [] }
      return {
        id: t.id,
        title: t.title,
        status,
        steps: t.steps ?? [],
        expected: t.expected ?? '',
        feedbackText: fb.text ?? '',
        attachments: Array.isArray(fb.attachments) ? fb.attachments : [],
      }
    })
    .filter(Boolean) as Array<{
    id: string
    title: string
    status: string
    steps: string[]
    expected: string
    feedbackText: string
    attachments: string[]
  }>

  const attachments = Array.from(new Set(failing.flatMap((f) => f.attachments))).filter((p) => typeof p === 'string')
  return { round, failing, attachments }
}

const canImplementFeedback = computed(() => {
  const ctx = getFeedbackContext()
  return !!ctx && ctx.failing.length > 0
})

async function runImplementFeedback() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  const ctx = getFeedbackContext()
  if (!ctx || ctx.failing.length === 0) return

  let text = `${buildImplementationPrompt({ featureSlug: selectedSlug.value })}\n\n`
  text += `# Manual testing feedback\n\n`
  text += `Please focus on fixing the failing/blocked items below. Use the plan and Q&A docs as source of truth, and update the implementation notes file as you go.\n\n`
  for (const f of ctx.failing) {
    text += `## ${f.id} — ${f.title} (${f.status})\n\n`
    if (f.steps.length) {
      text += `Steps:\n`
      for (const s of f.steps) text += `- ${s}\n`
      text += `\n`
    }
    if (f.expected) text += `Expected:\n${f.expected}\n\n`
    if (f.feedbackText) text += `Observed / notes:\n${f.feedbackText}\n\n`
    if (f.attachments.length) {
      text += `Attachments:\n`
      for (const a of f.attachments) text += `- ${a}\n`
      text += `\n`
    }
  }

  const input: string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> =
    ctx.attachments.length
      ? [{ type: 'text', text }, ...ctx.attachments.map((rel) => ({ type: 'local_image' as const, path: rel }))]
      : text

  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'implementation',
    profileId: implementationProfileId.value,
    model: implementationModelValue.value || undefined,
    modelReasoningEffort: implementationThinkingValue.value || undefined,
    oneShotNetwork: implementationProfileId.value === 'careful' ? implementationOneShotNetwork.value : undefined,
    input,
  })
  activeRunId.value = runId
  lastImplementationRunId.value = runId
  implementationOneShotNetwork.value = false
}

async function loadDiff() {
  if (!activeWorkspace.value) return
  if (!lastImplementationCheckpoint.value) return
  diffLoading.value = true
  try {
    diffStat.value = await window.codexDesigner!.getGitDiffStat(
      activeWorkspace.value.path,
      lastImplementationCheckpoint.value
    )
    diffText.value = await window.codexDesigner!.getGitDiff(activeWorkspace.value.path, lastImplementationCheckpoint.value)
  } finally {
    diffLoading.value = false
  }
}

async function startTestingRound() {
  if (!testPlan.value) return
  const nextIndex = testPlan.value.rounds.length + 1
  testPlan.value.rounds.push({
    id: `round-${nextIndex}`,
    startedAt: new Date().toISOString(),
    results: {},
  })
  ensureRound(testPlan.value)
  await saveTestPlan()
}

async function generateTests() {
  if (!activeWorkspace.value || !selectedSlug.value) return

  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'testing',
    profileId: planningProfileId.value,
    model: planningModelValue.value || undefined,
    modelReasoningEffort: planningThinkingValue.value || undefined,
    oneShotNetwork: planningProfileId.value === 'careful' ? oneShotNetwork.value : undefined,
    input: `Generate a set of key manual tests for the feature "${selectedSlug.value}". Use docs/${selectedSlug.value}.plan.md and docs/${selectedSlug.value}.qna.md as the source of truth. Output JSON that matches the provided schema.`,
    outputSchema: TEST_GENERATION_SCHEMA,
  })
  activeRunId.value = runId
  oneShotNetwork.value = false

  const rec = await waitForRunDone(runId)
  if (rec.status !== 'completed') throw new Error(rec.error ?? 'Test generation failed.')
  if (!rec.finalResponse) throw new Error('No structured output received.')

  const parsed = JSON.parse(rec.finalResponse) as { tests: any[] }
  const plan = createEmptyTestPlan(selectedSlug.value)
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
}

function getCurrentRound() {
  if (!testPlan.value) return null
  return ensureRound(testPlan.value)
}

function getResult(testId: string) {
  const round = getCurrentRound()
  if (!round) return null
  if (!round.results[testId]) {
    round.results[testId] = { status: 'not_run', feedback: [{ text: '', attachments: [] }] }
  } else if (!round.results[testId].feedback.length) {
    round.results[testId].feedback.push({ text: '', attachments: [] })
  }
  return round.results[testId]
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

const CLIPBOARD_DEBUG_KEY = 'codex-designer:clipboard-debug'
const clipboardDebug = ref(false)
let clipboardDebugTicker: ReturnType<typeof setInterval> | null = null

try {
  clipboardDebug.value = localStorage.getItem(CLIPBOARD_DEBUG_KEY) === '1'
} catch {
  // ignore
}

function startClipboardDebugTicker() {
  if (clipboardDebugTicker) return
  clipboardDebugTicker = setInterval(async () => {
    try {
      const formats = await window.codexDesigner?.getClipboardFormats?.()
      const line = Array.isArray(formats) && formats.length ? formats.join(', ') : '(none)'
      console.log(`[clipboard-debug] ${new Date().toISOString()} formats: ${line}`)
    } catch (e) {
      console.log(`[clipboard-debug] ${new Date().toISOString()} formats: (error)`, e)
    }
  }, 10_000)
}

function stopClipboardDebugTicker() {
  if (!clipboardDebugTicker) return
  clearInterval(clipboardDebugTicker)
  clipboardDebugTicker = null
}

watch(
  clipboardDebug,
  (v) => {
    try {
      localStorage.setItem(CLIPBOARD_DEBUG_KEY, v ? '1' : '0')
    } catch {
      // ignore
    }

    if (v) {
      console.log('[clipboard-debug] enabled')
      startClipboardDebugTicker()
    } else {
      console.log('[clipboard-debug] disabled')
      stopClipboardDebugTicker()
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  stopClipboardDebugTicker()
})

function debugPaste(label: string, e: ClipboardEvent) {
  if (!clipboardDebug.value) return
  const dt = e.clipboardData
  if (!dt) {
    console.log(`[paste-debug:${label}] no clipboardData`)
    return
  }

  const types = Array.from(dt.types ?? [])
  const items = Array.from(dt.items ?? []).map((it) => ({ kind: it.kind, type: it.type }))
  const files = Array.from(dt.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size }))

  console.log(`[paste-debug:${label}] types=${JSON.stringify(types)} items=${JSON.stringify(items)} files=${JSON.stringify(files)}`)

  if (types.includes('text/plain')) {
    const preview = dt.getData('text/plain')
    if (preview) console.log(`[paste-debug:${label}] text/plain (first 200 chars):`, preview.slice(0, 200))
  }
  if (types.includes('text/html')) {
    const preview = dt.getData('text/html')
    if (preview) console.log(`[paste-debug:${label}] text/html (first 200 chars):`, preview.slice(0, 200))
  }

  void window.codexDesigner?.getClipboardFormats?.().then((formats) => {
    const line = Array.isArray(formats) && formats.length ? formats.join(', ') : '(none)'
    console.log(`[paste-debug:${label}] electron clipboard formats: ${line}`)
  })
}

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

async function onPasteFeedback(e: ClipboardEvent, testId: string) {
  if (!activeWorkspace.value || !selectedSlug.value || !testPlan.value) return
  const dt = e.clipboardData
  if (!dt) return
  debugPaste(`testing:${testId}`, e)

  const file = findImageFile(dt)
  const html = dt.getData('text/html')
  const text = dt.getData('text/plain')
  const dataUrlFromText = extractDataUrlImage(html) ?? extractDataUrlImage(text)

  if (!file && !dataUrlFromText) {
    e.preventDefault()
    const clipUrl = await window.codexDesigner?.readClipboardImageDataUrl?.()
    const parsed = parseImageDataUrl(clipUrl || '')
    if (!parsed) {
      pastePlainTextIntoTarget(e, text || '')
      return
    }

    const saved = await window.codexDesigner!.saveAttachment({
      workspacePath: activeWorkspace.value.path,
      featureSlug: selectedSlug.value,
      ext: parsed.ext,
      bytesBase64: parsed.bytesBase64,
    })

    const r = getResult(testId)
    if (!r) return
    if (!r.feedback.length) r.feedback.push({ text: '', attachments: [] })
    r.feedback[r.feedback.length - 1].attachments.push(saved.relPath)
    await saveTestPlan()
    showToast('Image attached')
    return
  }

  e.preventDefault()

  const dataUrl = dataUrlFromText ?? (file ? await readFileAsDataUrl(file) : '')
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) return

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    ext: parsed.ext,
    bytesBase64: parsed.bytesBase64,
  })

  const r = getResult(testId)
  if (!r) return
  if (!r.feedback.length) r.feedback.push({ text: '', attachments: [] })
  r.feedback[r.feedback.length - 1].attachments.push(saved.relPath)
  await saveTestPlan()
  showToast('Image attached')
}

const acceptanceOk = computed(() => {
  if (!testPlan.value) return false
  if (!testPlan.value.tests.length) return false
  const round = getCurrentRound()
  if (!round) return false

  for (const t of testPlan.value.tests) {
    const status = round.results[t.id]?.status ?? 'not_run'
    if (status === 'pass' || status === 'deferred') continue
    return false
  }
  return true
})

async function commitAcceptedChanges() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  commitResult.value = null

  if (commitMode.value === 'careful' && !acceptanceOk.value) {
    throw new Error('Acceptance not met (Careful). Mark tests pass/deferred before committing.')
  }

  const msg = commitMessage.value.trim() || `accept: ${selectedSlug.value}`
  commitMessage.value = msg
  const res = await window.codexDesigner!.gitCommitAll(activeWorkspace.value.path, msg)
  commitResult.value = res
}

const newWorkOpen = ref(false)
const newWorkSlug = ref('')
const newWorkBrief = ref('')
const newWorkAttachments = ref<string[]>([])
const newWorkAttachmentError = ref<string | null>(null)
const newWorkRunError = ref<string | null>(null)
const newWorkSubmitting = ref(false)
const newWorkProfileId = ref<'careful' | 'yolo'>('yolo')
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
const newWorkRunId = ref<string | null>(null)
const newWorkRun = computed(() => getRun(newWorkRunId.value))

function openNewWorkModal() {
  newWorkOpen.value = true
  newWorkAttachmentError.value = null
  newWorkRunError.value = null
}

async function onPasteNewWork(e: ClipboardEvent) {
  if (!activeWorkspace.value) return
  const slug = newWorkSlug.value.trim()
  if (!slug) {
    newWorkAttachmentError.value = 'Enter a feature slug before pasting images.'
    return
  }

  const dt = e.clipboardData
  if (!dt) return
  debugPaste('new-work', e)

  const file = findImageFile(dt)
  const html = dt.getData('text/html')
  const text = dt.getData('text/plain')
  const dataUrlFromText = extractDataUrlImage(html) ?? extractDataUrlImage(text)

  if (!file && !dataUrlFromText) {
    e.preventDefault()
    newWorkAttachmentError.value = null
    const clipUrl = await window.codexDesigner?.readClipboardImageDataUrl?.()
    const parsed = parseImageDataUrl(clipUrl || '')
    if (!parsed) {
      pastePlainTextIntoTarget(e, text || '')
      return
    }

    const saved = await window.codexDesigner!.saveAttachment({
      workspacePath: activeWorkspace.value.path,
      featureSlug: slug,
      ext: parsed.ext,
      bytesBase64: parsed.bytesBase64,
    })

    newWorkAttachments.value.push(saved.relPath)
    showToast('Image attached')
    return
  }

  e.preventDefault()
  newWorkAttachmentError.value = null

  const dataUrl = dataUrlFromText ?? (file ? await readFileAsDataUrl(file) : '')
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) return

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: activeWorkspace.value.path,
    featureSlug: slug,
    ext: parsed.ext,
    bytesBase64: parsed.bytesBase64,
  })

  newWorkAttachments.value.push(saved.relPath)
  showToast('Image attached')
}

async function onPasteQnaAnswer(e: ClipboardEvent, qId: string) {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value || isRunBusy.value) return
  const dt = e.clipboardData
  if (!dt) return
  debugPaste(`qna:${qId}`, e)

  const file = findImageFile(dt)
  const html = dt.getData('text/html')
  const text = dt.getData('text/plain')
  const dataUrlFromText = extractDataUrlImage(html) ?? extractDataUrlImage(text)

  if (!file && !dataUrlFromText) {
    e.preventDefault()
    const clipUrl = await window.codexDesigner?.readClipboardImageDataUrl?.()
    const parsed = parseImageDataUrl(clipUrl || '')
    if (!parsed) {
      pastePlainTextIntoTarget(e, text || '')
      return
    }

    const saved = await window.codexDesigner!.saveAttachment({
      workspacePath: activeWorkspace.value.path,
      featureSlug: selectedSlug.value,
      ext: parsed.ext,
      bytesBase64: parsed.bytesBase64,
    })

    const rel = saved.relPath
    const md = `![pasted image](${rel})`
    qnaEditOpen.value[qId] = true
    const existing = String(draftNotes.value[qId] ?? '')
    draftNotes.value[qId] = existing.trim().length ? `${existing}\n\n${md}` : md
    showToast('Image attached')
    return
  }

  e.preventDefault()

  const dataUrl = dataUrlFromText ?? (file ? await readFileAsDataUrl(file) : '')
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) return

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    ext: parsed.ext,
    bytesBase64: parsed.bytesBase64,
  })

  const rel = saved.relPath
  const md = `![pasted image](${rel})`
  qnaEditOpen.value[qId] = true
  const existing = String(draftNotes.value[qId] ?? '')
  draftNotes.value[qId] = existing.trim().length ? `${existing}\n\n${md}` : md
  showToast('Image attached')
}

async function deleteAttachmentIfPossible(relPath: string): Promise<void> {
  if (!activeWorkspace.value) return
  try {
    await window.codexDesigner?.deleteAttachment?.(activeWorkspace.value.path, relPath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    showToast(`Failed to delete attachment: ${msg}`, 3500)
  }
}

async function removeNewWorkAttachment(idx: number) {
  const rel = newWorkAttachments.value[idx]
  if (!rel) return
  newWorkAttachments.value.splice(idx, 1)
  await deleteAttachmentIfPossible(rel)
}

async function removeNewWorkAttachmentRel(relPath: string) {
  const idx = newWorkAttachments.value.findIndex((p) => p === relPath)
  if (idx === -1) return
  await removeNewWorkAttachment(idx)
}

function removeAttachmentRefsFromText(text: string, relPath: string): string {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n')
  const kept = lines.filter((line) => !line.includes(relPath))
  // Keep user formatting mostly intact, but avoid leaving giant blank gaps after removals.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function removeQnaDraftAttachment(qId: string, relPath: string) {
  const existing = String(draftNotes.value[qId] ?? '')
  draftNotes.value[qId] = removeAttachmentRefsFromText(existing, relPath)
  await deleteAttachmentIfPossible(relPath)
  showToast('Image removed')
}

async function removeTestFeedbackAttachment(testId: string, relPath: string) {
  const r = getResult(testId)
  if (!r) return
  const fb = r.feedback[0]
  if (!fb) return
  fb.attachments = (fb.attachments ?? []).filter((p: string) => p !== relPath)
  await saveTestPlan()
  await deleteAttachmentIfPossible(relPath)
  showToast('Image removed')
}

async function createNewWork() {
  if (!activeWorkspace.value) return
  if (newWorkSubmitting.value) return
  const slug = newWorkSlug.value.trim()
  if (!slug) return
  const brief = newWorkBrief.value.trim()

  newWorkAttachmentError.value = null
  newWorkRunError.value = null
  newWorkSubmitting.value = true

  try {
    const text = buildPlanningCreatePrompt({ featureSlug: slug, brief, attachments: newWorkAttachments.value })

    const input: string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> =
      newWorkAttachments.value.length
        ? [{ type: 'text', text }, ...newWorkAttachments.value.map((rel) => ({ type: 'local_image' as const, path: rel }))]
        : text
    const workspacePath = activeWorkspace.value.path
    const runId = await startRun({
      workspacePath,
      featureSlug: slug,
      role: 'planning',
      profileId: newWorkProfileId.value,
      model: newWorkModelValue.value || undefined,
      modelReasoningEffort: newWorkThinkingValue.value || undefined,
      input,
      outputSchema: PLAN_CREATE_SCHEMA,
    })
    newWorkRunId.value = runId
    activeRunId.value = runId

    // Optimistically navigate; files will appear after the run completes.
    await router.push(`/session/${encodeURIComponent(slug)}?tab=planning`)
    newWorkOpen.value = false
    newWorkSlug.value = ''
    newWorkBrief.value = ''
    newWorkAttachments.value = []

    void openWorkspace(workspacePath)
    void applyPlanningCreateOutput(runId, workspacePath, slug).catch((e) => {
      console.error(e)
    })
  } catch (e) {
    newWorkRunError.value = e instanceof Error ? e.message : String(e)
  } finally {
    newWorkSubmitting.value = false
  }
}

onMounted(() => {
  // keep artifacts fresh when returning to this page
  if (selectedSlug.value) void loadArtifacts()
  void refreshModels()
})

const autoRoundForRunId = ref<string | null>(null)
watch(
  () => lastImplementationRun.value?.status,
  async (status) => {
    if (status !== 'completed') return
    if (!activeWorkspace.value || !selectedSlug.value) return
    if (!testPlan.value || !lastImplementationCheckpoint.value) return
    if (!lastImplementationRun.value) return
    if (autoRoundForRunId.value === lastImplementationRun.value.runId) return

    const stat = await window.codexDesigner!.getGitDiffStat(activeWorkspace.value.path, lastImplementationCheckpoint.value)
    if (!stat.trim()) return

    const prev = ensureRound(testPlan.value)
    const anyNotPass = testPlan.value.tests.some((t) => (prev.results[t.id]?.status ?? 'not_run') !== 'pass')
    if (!anyNotPass) return

    const nextIndex = testPlan.value.rounds.length + 1
    const nextRound: TestRound = {
      id: `round-${nextIndex}`,
      startedAt: new Date().toISOString(),
      results: {},
    }

    for (const t of testPlan.value.tests) {
      const prevStatus = prev.results[t.id]?.status ?? 'not_run'
      const nextStatus = prevStatus === 'pass' ? 'not_run' : prevStatus
      nextRound.results[t.id] = { status: nextStatus, feedback: [{ text: '', attachments: [] }] }
    }

    testPlan.value.rounds.push(nextRound)
    autoRoundForRunId.value = lastImplementationRun.value.runId
    await saveTestPlan()
  }
)
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">chat</span>
        <div class="min-w-0">
          <h2 class="text-lg font-black tracking-tight">Sessions</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Planning, implementation, and testing sessions live alongside your workspace docs.
          </p>
        </div>
      </div>

      <div v-if="!activeWorkspace" class="mt-4 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
        <div class="font-bold">No workspace selected.</div>
        <p class="mt-1 text-gray-600 dark:text-gray-300">
          Pick a workspace first to discover feature sessions (`docs/*.plan.md`).
        </p>
        <router-link
          class="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
          to="/workspace"
        >
          <span class="material-symbols-rounded text-[18px]">folder_open</span>
          Go to workspace
        </router-link>
      </div>
    </div>

    <div v-if="activeWorkspace" class="space-y-4">
      <div class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Workspace</div>
            <div class="mt-1 truncate font-mono text-xs">{{ activeWorkspace.path }}</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
              type="button"
              @click="openWorkspace(activeWorkspace.path)"
            >
              <span class="material-symbols-rounded text-[18px]">refresh</span>
              Refresh
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
              type="button"
              @click="openNewWorkModal"
            >
              <span class="material-symbols-rounded text-[18px]">add</span>
              New work
            </button>
          </div>
        </div>

        <div class="mt-4">
          <div class="relative">
            <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              >search</span
            >
            <input
              v-model="q"
              type="search"
              placeholder="Search features…"
              class="w-full rounded-xl bg-gray-100 py-2 pl-9 pr-3 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
            />
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <button
            v-for="f in filtered"
            :key="f.slug"
            class="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-bold shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
            type="button"
            @click="openFeature(f.slug)"
          >
            <span class="truncate">{{ f.slug }}</span>
            <span class="material-symbols-rounded text-[18px] text-gray-400">chevron_right</span>
          </button>

          <div
            v-if="!filtered.length"
            class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
          >
            No sessions found.
          </div>
        </div>
      </div>

      <div v-if="selectedSlug" class="fixed inset-0 z-50 !mt-0">
        <button
          class="absolute inset-0 bg-black/40"
          type="button"
          aria-label="Back to feature list"
          @click="closeFeature"
        ></button>

        <aside
          class="absolute right-0 top-0 flex h-full w-full max-w-[98vw] flex-col border-l border-gray-200 bg-gray-50 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
          aria-label="Feature details"
        >
          <div
            class="flex items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-3 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/70"
          >
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              type="button"
              @click="closeFeature"
            >
              <span class="material-symbols-rounded text-[18px]">arrow_back</span>
              Back
            </button>

            <div class="min-w-0">
              <div class="truncate text-sm font-black">{{ selectedSlug }}</div>
              <div class="truncate text-xs text-gray-500 dark:text-gray-400">Feature</div>
            </div>

            <button
              class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              type="button"
              aria-label="Close feature"
              @click="closeFeature"
            >
              <span class="material-symbols-rounded text-[20px]">close</span>
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div v-if="!selectedSlug" class="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
          <div class="font-bold">Select a feature session</div>
          <p class="mt-1 text-gray-600 dark:text-gray-300">
            Pick a feature on the left to view its plan/Q&A/implementation/testing artifacts.
          </p>
        </div>

        <div v-else class="space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="material-symbols-rounded text-[22px] text-brand-500">description</span>
                <h3 class="truncate text-xl font-black tracking-tight">{{ selectedSlug }}</h3>
                <span
                  v-if="!selectedFeatureExists"
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                >
                  pending
                </span>
              </div>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Plan + Q&A live in `docs/`. Runs stream via Codex SDK.
              </p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
              :class="
                tab === 'planning'
                  ? 'bg-brand-600 text-white shadow-brand-600/20'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
              "
              type="button"
              @click="setTab('planning')"
            >
              <span class="material-symbols-rounded text-[18px]">chat</span>
              Q&amp;A
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
              :class="
                tab === 'plan'
                  ? 'bg-brand-600 text-white shadow-brand-600/20'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
              "
              type="button"
              @click="setTab('plan')"
            >
              <span class="material-symbols-rounded text-[18px]">description</span>
              Plan
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
              :class="
                tab === 'implement'
                  ? 'bg-brand-600 text-white shadow-brand-600/20'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
              "
              type="button"
              @click="setTab('implement')"
            >
              <span class="material-symbols-rounded text-[18px]">build</span>
              Implement
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
              :class="
                tab === 'testing'
                  ? 'bg-brand-600 text-white shadow-brand-600/20'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
              "
              type="button"
              @click="setTab('testing')"
            >
              <span class="material-symbols-rounded text-[18px]">checklist</span>
              Testing
            </button>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-center justify-between gap-3">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Run</div>
              <div class="flex flex-wrap items-center gap-2">
                <label
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                  title="Logs clipboard formats every 10s + logs paste payloads when you paste into a notes field"
                >
                  <input v-model="clipboardDebug" type="checkbox" class="h-4 w-4 accent-brand-600" />
                  Clipboard debug
                </label>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  type="button"
                  :disabled="artifactsLoading"
                  @click="loadArtifacts"
                >
                  <span class="material-symbols-rounded text-[18px]">refresh</span>
                  Reload files
                </button>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  type="button"
                  :disabled="!isRunBusy"
                  @click="stopRun"
                >
                  <span class="material-symbols-rounded text-[18px]">stop</span>
                  Stop
                </button>
              </div>
            </div>

            <div v-if="activeRun" class="mt-4">
              <RunEventStream
                :events="activeRun.events"
                :status="activeRun.status"
                :started-at="activeRun.startedAt"
                :ended-at="activeRun.endedAt"
                :meta="{
                  profileId: activeRun.profileId,
                  model: activeRun.model,
                  modelReasoningEffort: activeRun.modelReasoningEffort,
                  sandboxMode: activeRun.sandboxMode,
                  approvalPolicy: activeRun.approvalPolicy,
                  networkAccessEnabled: activeRun.networkAccessEnabled,
                  oneShotNetwork: activeRun.oneShotNetwork,
                }"
                :max-events="100"
              />
            </div>
          </div>

          <div v-if="tab === 'planning'" class="space-y-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Planning</div>
                  <div class="mt-1 text-sm font-bold">Q&amp;A rounds</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    :disabled="qnaLocked || isRunBusy"
                    @click="commitCurrentRound"
                  >
                    <span class="material-symbols-rounded text-[18px]">save</span>
                    Commit round
                  </button>

                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="isRunBusy || qnaLocked || qnaComplete"
                    @click="runNextRound()"
                  >
                    <span class="material-symbols-rounded text-[18px]">autorenew</span>
                    Generate next round
                  </button>

                  <button
                    v-if="qnaRounds.length"
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    :disabled="isRunBusy || qnaLocked"
                    @click="regenerateLatestRound"
                  >
                    <span class="material-symbols-rounded text-[18px]">restart_alt</span>
                    Regenerate latest
                  </button>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      planningProfileId === 'careful'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    :disabled="isRunBusy || qnaLocked"
                    @click="planningProfileId = 'careful'"
                  >
                    <span class="material-symbols-rounded text-[18px]">verified</span>
                    Careful
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      planningProfileId === 'yolo'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    :disabled="isRunBusy || qnaLocked"
                    @click="planningProfileId = 'yolo'"
                  >
                    <span class="material-symbols-rounded text-[18px]">bolt</span>
                    YOLO
                  </button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <select
                    v-model="planningModelChoice"
                    class="w-[240px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="isRunBusy || qnaLocked"
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
                    class="w-[220px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="isRunBusy || qnaLocked"
                  />
                </div>

                <select
                  v-model="planningThinkingChoice"
                  class="w-[180px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                  aria-label="Thinking level"
                  :disabled="isRunBusy || qnaLocked"
                >
                  <option value="default">Thinking: Default</option>
                  <option value="minimal">Thinking: Minimal</option>
                  <option value="low">Thinking: Low</option>
                  <option value="medium">Thinking: Medium</option>
                  <option value="high">Thinking: High</option>
                  <option value="xhigh">Thinking: XHigh</option>
                </select>

                <label
                  v-if="planningProfileId === 'careful'"
                  class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                >
                  <input v-model="oneShotNetwork" type="checkbox" class="h-4 w-4 accent-brand-600" />
                  One-shot tool network
                </label>
              </div>

              <ModelsInspector
                :models="codexModels"
                :loading="modelsLoading"
                :error="modelsError"
                @refresh="refreshModels"
              />

              <div
                v-if="planningProfileId === 'careful' && oneShotNetwork"
                class="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                One-shot override is enabled. Tools/commands may use the network for the next run only.
              </div>

              <div
                v-if="qnaLocked"
                class="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                Implementation has started for this feature. Q&amp;A is locked to preserve history. If you need to revisit
                requirements, create a new session/feature slug.
              </div>

              <div
                v-else-if="qnaComplete"
                class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
              >
                <div>
                  No further follow-up questions were generated. Planning looks complete — proceed to Implementation.
                </div>
                <button
                  class="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-900 shadow-sm transition-colors hover:bg-emerald-50 dark:border-emerald-900/40 dark:bg-gray-950 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
                  type="button"
                  :disabled="isRunBusy"
                  @click="runNextRound(true)"
                >
                  <span class="material-symbols-rounded text-[18px]">restart_alt</span>
                  Generate anyway
                </button>
              </div>

              <div v-if="qnaLoadError" class="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                Q&amp;A file not found yet. Start with “New work” to generate the plan + Q&amp;A for this slug.
              </div>

              <div v-else class="mt-4 space-y-4">
                <div
                  v-for="round in qnaRounds"
                  :key="round.id"
                  class="rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-950"
                >
                  <button
                    class="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:hover:bg-gray-900/60"
                    type="button"
                    @click="toggleQnaRound(round.id)"
                  >
                    <div class="flex items-center gap-2 text-sm font-black">
                      <span class="material-symbols-rounded text-[18px] text-brand-500">flag</span>
                      <span>{{ round.title }}</span>
                      <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                        {{ round.questions.length }} Q
                      </span>
                    </div>
                    <span
                      class="material-symbols-rounded text-[18px] text-gray-400 transition-transform"
                      :class="qnaRoundOpen[round.id] ? 'rotate-180' : ''"
                    >
                      expand_more
                    </span>
                  </button>

                  <div v-show="qnaRoundOpen[round.id]" class="mt-3 space-y-3">
                    <div
                      v-for="qItem in round.questions"
                      :key="qItem.id"
                      class="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950"
                    >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-bold">{{ qItem.prompt }}</div>
                        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Recommended:</span>
                          <span class="rounded-full bg-brand-600/10 px-2 py-0.5 font-mono text-[11px] font-black text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                            {{ qItem.recommendedKey }}
                          </span>
                          <span class="truncate">
                            {{ selectedOptionText(qItem, qItem.recommendedKey) }}
                          </span>
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <button
                          v-if="qItem.answers.length && !isEditingQnaQuestion(qItem)"
                          class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                          type="button"
                          :disabled="qnaLocked || isRunBusy"
                          @click="beginRevision(qItem)"
                        >
                          <span class="material-symbols-rounded text-[18px]">edit</span>
                          Revise
                        </button>
                      </div>
                    </div>

                    <div v-if="qItem.answers.length" class="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Current answer
                      </div>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <span class="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-black text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                          {{ getCurrentAnswer(qItem)?.selectedKey }}
                        </span>
                        <span class="font-semibold">
                          {{ selectedOptionText(qItem, getCurrentAnswer(qItem)?.selectedKey || '') }}
                        </span>
                      </div>
                      <div v-if="(getCurrentAnswer(qItem)?.notes ?? '').trim().length" class="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                        {{ getCurrentAnswer(qItem)?.notes }}
                      </div>
                    </div>

                    <div v-if="isEditingQnaQuestion(qItem)" class="mt-3">
                      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Choose an option
                      </div>

                      <div v-if="qItem.options.length" class="mt-2 flex flex-col items-start gap-2">
                        <button
                          v-for="opt in qItem.options"
                          :key="opt.key"
                          class="inline-flex w-full items-center justify-start gap-2 rounded-xl px-3 py-2 text-left text-xs font-black shadow-sm transition-colors"
                          :class="
                            String(draftSelected[qItem.id] ?? '').trim().toUpperCase() === opt.key
                              ? 'bg-brand-600 text-white shadow-brand-600/20'
                              : String(draftSelected[qItem.id] ?? '').trim().length === 0 && opt.key === qItem.recommendedKey
                                ? 'border border-brand-400 bg-white text-gray-700 hover:bg-gray-50 dark:border-brand-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                          "
                          type="button"
                          :disabled="qnaLocked || isRunBusy"
                          @click="draftSelected[qItem.id] = opt.key"
                        >
                          <span class="min-w-[18px] rounded-full bg-black/5 px-2 py-0.5 font-mono text-[11px] font-black dark:bg-white/10">
                            {{ opt.key }}
                          </span>
                          <span class="min-w-0 flex-1 text-left text-[11px] font-semibold opacity-80">{{ opt.text }}</span>
                          <span
                            v-if="opt.key === qItem.recommendedKey"
                            class="ml-auto rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-black text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                          >
                            recommended
                          </span>
                        </button>
                      </div>

                      <div v-if="String(draftSelected[qItem.id] ?? '').trim().length === 0" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        No option selected. Commit will use Recommended: {{ qItem.recommendedKey }}.
                      </div>

                      <div class="mt-3">
                        <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                          Notes (optional)
                        </div>
                        <div
                          v-if="
                            activeWorkspace &&
                            extractWorkspaceImagePaths(String(draftNotes[qItem.id] ?? '')).length
                          "
                          class="mt-2"
                        >
                          <AttachmentPreviews
                            :workspace-path="activeWorkspace.path"
                            :attachments="extractWorkspaceImagePaths(String(draftNotes[qItem.id] ?? ''))"
                            :max="6"
                            allow-remove
                            @remove="(rel) => removeQnaDraftAttachment(qItem.id, rel)"
                          />
                        </div>
                        <AutoGrowTextarea
                          v-model="draftNotes[qItem.id]"
                          :min-rows="2"
                          class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                          placeholder="Add clarifications. Paste images here."
                          :disabled="qnaLocked || isRunBusy"
                          @paste="onPasteQnaAnswer($event as ClipboardEvent, qItem.id)"
                        />
                      </div>
                    </div>

                    <details
                      v-if="qItem.answers.length > 1"
                      class="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                    >
                      <summary class="cursor-pointer select-none text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Revisions ({{ qItem.answers.length }})
                      </summary>
                      <div class="mt-2 space-y-2">
                        <div
                          v-for="(a, idx) in qItem.answers"
                          :key="a.id"
                          class="rounded-lg border border-gray-200 bg-white px-2 py-2 dark:border-gray-800 dark:bg-gray-950"
                          :class="idx === qItem.answers.length - 1 ? 'ring-1 ring-brand-500/30' : ''"
                        >
                          <div class="flex items-center gap-2">
                            <span class="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-black text-gray-600 dark:bg-gray-800 dark:text-gray-200">#{{ idx + 1 }}</span>
                            <span v-if="idx === qItem.answers.length - 1" class="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-black text-white">current</span>
                            <span class="ml-auto font-mono text-[10px] text-gray-400">{{ a.createdAt }}</span>
                          </div>
                          <div class="mt-2 flex flex-wrap items-center gap-2">
                            <span class="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-black text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                              {{ a.selectedKey }}
                            </span>
                            <span class="font-semibold">
                              {{ selectedOptionText(qItem, a.selectedKey) }}
                            </span>
                          </div>
                          <div v-if="String(a.notes ?? '').trim().length" class="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                            {{ a.notes }}
                          </div>
                          <div v-if="Array.isArray(a.attachments) && a.attachments.length" class="mt-2 space-y-1 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Attachments</div>
                            <div v-for="p in a.attachments" :key="p">{{ p }}</div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
                </div>
              </div>
            </div>

          </div>

          <div v-else-if="tab === 'plan'" class="space-y-3">
            <div v-if="planLoadError" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              Plan file not found yet. Start with “New work” to generate the plan + Q&amp;A for this slug.
            </div>
            <div v-else class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <MarkdownViewer :markdown="planMarkdown" />
            </div>
          </div>

          <div v-else-if="tab === 'implement'" class="space-y-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Implementation</div>
                  <div class="mt-1 text-sm font-bold">Implement from plan</div>
                  <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Runs Codex against your workspace. Careful mode enforces git cleanliness; YOLO does not.
                  </p>
                </div>
                <button
                  class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                  type="button"
                  :disabled="
                    isRunBusy ||
                    (implementationProfileId === 'careful' &&
                      (!activeWorkspace?.isGitRepo || activeWorkspace?.isGitClean === false))
                  "
                  @click="runImplementation"
                >
                  <span class="material-symbols-rounded text-[18px]">play_arrow</span>
                  Implement plan
                </button>
              </div>

              <div
                v-if="implementationProfileId === 'careful' && activeWorkspace && !activeWorkspace.isGitRepo"
                class="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    This workspace is not a git repo. Initialize git before running implementation.
                  </div>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
                    type="button"
                    :disabled="isRunBusy"
                    @click="initGit"
                  >
                    <span class="material-symbols-rounded text-[18px]">fork_right</span>
                    git init
                  </button>
                </div>
              </div>

              <div
                v-else-if="
                  implementationProfileId === 'careful' &&
                  activeWorkspace &&
                  activeWorkspace.isGitRepo &&
                  activeWorkspace.isGitClean === false
                "
                class="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                Git working tree is dirty. Clean/commit/stash before running implementation, then refresh the workspace status.
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      implementationProfileId === 'careful'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    :disabled="isRunBusy"
                    @click="implementationProfileId = 'careful'"
                  >
                    <span class="material-symbols-rounded text-[18px]">verified</span>
                    Careful
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      implementationProfileId === 'yolo'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    :disabled="isRunBusy"
                    @click="implementationProfileId = 'yolo'"
                  >
                    <span class="material-symbols-rounded text-[18px]">bolt</span>
                    YOLO
                  </button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <select
                    v-model="implementationModelChoice"
                    class="w-[240px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="isRunBusy"
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
                    class="w-[220px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                    :disabled="isRunBusy"
                  />
                </div>

                <select
                  v-model="implementationThinkingChoice"
                  class="w-[180px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                  aria-label="Thinking level"
                  :disabled="isRunBusy"
                >
                  <option value="default">Thinking: Default</option>
                  <option value="minimal">Thinking: Minimal</option>
                  <option value="low">Thinking: Low</option>
                  <option value="medium">Thinking: Medium</option>
                  <option value="high">Thinking: High</option>
                  <option value="xhigh">Thinking: XHigh</option>
                </select>

                <label
                  v-if="implementationProfileId === 'careful'"
                  class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                >
                  <input v-model="implementationOneShotNetwork" type="checkbox" class="h-4 w-4 accent-brand-600" />
                  One-shot tool network
                </label>
              </div>

              <ModelsInspector
                :models="codexModels"
                :loading="modelsLoading"
                :error="modelsError"
                @refresh="refreshModels"
              />
            </div>

            <div v-if="lastImplementationRun" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-[11px] dark:border-gray-800 dark:bg-gray-950">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Last implementation run</div>
                <button
                  v-if="lastImplementationCheckpoint"
                  class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  type="button"
                  :disabled="diffLoading"
                  @click="loadDiff"
                >
                  <span class="material-symbols-rounded text-[18px]">difference</span>
                  Load diff
                </button>
              </div>
              <div class="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                <div class="font-mono">run: {{ lastImplementationRun.runId }}</div>
                <div v-if="lastImplementationCheckpoint" class="font-mono">
                  checkpoint: {{ lastImplementationCheckpoint.slice(0, 10) }}
                </div>
              </div>

              <div v-if="diffStat" class="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-[11px] text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Diff stat</div>
                <pre class="mt-2 whitespace-pre-wrap">{{ diffStat }}</pre>
              </div>

              <div v-if="diffText" class="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-[11px] text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Diff</div>
                <pre class="mt-2 whitespace-pre-wrap">{{ diffText }}</pre>
              </div>
            </div>
          </div>

          <div v-else-if="tab === 'testing'" class="space-y-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Testing</div>
                  <div class="mt-1 text-sm font-bold">Manual test rounds</div>
                </div>
                <div class="flex items-center gap-2">
                  <div
                    class="hidden items-center gap-2 rounded-xl px-3 py-2 text-xs font-black md:inline-flex"
                    :class="
                      acceptanceOk
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
                    "
                  >
                    <span class="material-symbols-rounded text-[18px]">{{
                      acceptanceOk ? 'check_circle' : 'warning'
                    }}</span>
                    {{ acceptanceOk ? 'Accepted' : 'Not accepted' }}
                  </div>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="isRunBusy"
                    @click="generateTests"
                  >
                    <span class="material-symbols-rounded text-[18px]">auto_fix</span>
                    Generate tests
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    @click="startTestingRound"
                  >
                    <span class="material-symbols-rounded text-[18px]">add</span>
                    Start testing round
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    @click="saveTestPlan"
                  >
                    <span class="material-symbols-rounded text-[18px]">save</span>
                    Save
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="isRunBusy || !canImplementFeedback"
                    @click="runImplementFeedback"
                  >
                    <span class="material-symbols-rounded text-[18px]">build</span>
                    Implement feedback
                  </button>
                </div>
              </div>

              <div v-if="testLoadError" class="mt-3 text-sm text-gray-600 dark:text-gray-300">
                No `docs/{{ selectedSlug }}.test.json` yet; it will be created when you generate or save tests.
              </div>

              <div v-if="testPlan" class="mt-4 space-y-3">
                <div class="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                  Paste images into any feedback box to attach screenshots (saved under `docs/assets/{{ selectedSlug }}/`).
                </div>

                <div v-if="!testPlan.tests.length" class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  No tests defined yet. (Next) Add “Generate tests” via Codex outputSchema.
                </div>

                <div v-else class="space-y-3">
                  <div
                    v-for="t in testPlan.tests"
                    :key="t.id"
                    class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-black">{{ t.id }} — {{ t.title }}</div>
                        <div v-if="t.description" class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          {{ t.description }}
                        </div>
                      </div>
                      <select
                        v-model="getResult(t.id)!.status"
                        class="rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs font-bold dark:border-gray-800 dark:bg-gray-900"
                        @change="saveTestPlan"
                      >
                        <option value="not_run">not_run</option>
                        <option value="pass">pass</option>
                        <option value="fail">fail</option>
                        <option value="deferred">deferred</option>
                        <option value="blocked">blocked</option>
                      </select>
                    </div>

                    <div class="mt-3 text-xs text-gray-600 dark:text-gray-300">
                      <div class="font-bold">Steps</div>
                      <ol class="mt-1 list-decimal space-y-1 pl-5">
                        <li v-for="(s, idx) in t.steps" :key="idx">{{ s }}</li>
                      </ol>
                      <div class="mt-3 font-bold">Expected</div>
                      <div class="mt-1">{{ t.expected }}</div>
                    </div>

                    <div class="mt-4">
                      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Feedback (paste image here)
                      </div>
                      <div
                        v-if="activeWorkspace && getResult(t.id)!.feedback[0]?.attachments?.length"
                        class="mt-2"
                      >
                        <AttachmentPreviews
                          :workspace-path="activeWorkspace.path"
                          :attachments="getResult(t.id)!.feedback[0].attachments"
                          :max="6"
                          allow-remove
                          @remove="(rel) => removeTestFeedbackAttachment(t.id, rel)"
                        />
                      </div>
                      <AutoGrowTextarea
                        v-model="getResult(t.id)!.feedback[0].text"
                        :min-rows="3"
                        class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                        placeholder="Notes…"
                        @paste="onPasteFeedback($event as ClipboardEvent, t.id)"
                        @blur="saveTestPlan"
                      />

                      <div v-if="getResult(t.id)!.feedback[0]?.attachments?.length" class="mt-2 space-y-1">
                        <div
                          v-for="(a, idx) in getResult(t.id)!.feedback[0].attachments"
                          :key="idx"
                          class="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400"
                        >
                          {{ a }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Commit</div>
                  <div class="mt-1 text-sm font-bold">Commit accepted changes</div>
                  <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Stages and commits all repo changes. Careful enforces acceptance; YOLO allows override.
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      commitMode === 'careful'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    @click="commitMode = 'careful'"
                  >
                    <span class="material-symbols-rounded text-[18px]">verified</span>
                    Careful
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                    :class="
                      commitMode === 'yolo'
                        ? 'bg-brand-600 text-white shadow-brand-600/20'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
                    "
                    type="button"
                    @click="commitMode = 'yolo'"
                  >
                    <span class="material-symbols-rounded text-[18px]">bolt</span>
                    YOLO
                  </button>
                </div>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <AutoGrowTextarea
                  v-model="commitMessage"
                  :min-rows="1"
                  :max-rows="4"
                  class="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                  placeholder="Commit message (auto-filled if blank)"
                />
                <button
                  class="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                  type="button"
                  :disabled="commitMode === 'careful' && !acceptanceOk"
                  @click="commitAcceptedChanges"
                >
                  <span class="material-symbols-rounded text-[18px]">commit</span>
                  Commit
                </button>
              </div>

              <div
                v-if="commitMode === 'careful' && !acceptanceOk"
                class="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                Acceptance not met. Mark all tests `pass` or `deferred` before committing (Careful).
              </div>

              <div v-if="commitResult" class="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-950">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Committed</div>
                <div class="mt-2">commit: {{ commitResult.commit }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- New work modal -->
    <div v-if="newWorkOpen" class="fixed inset-0 z-50">
      <button class="absolute inset-0 bg-black/50" type="button" @click="newWorkOpen = false"></button>
      <div class="absolute left-1/2 top-1/2 w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">New work</div>
            <div class="mt-1 text-lg font-black tracking-tight">Create plan + Q&amp;A</div>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Generates `docs/[feature].plan.md` + `docs/[feature].qna.md` in the workspace.
            </p>
          </div>
          <button
            class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            type="button"
            aria-label="Close"
            @click="newWorkOpen = false"
          >
            <span class="material-symbols-rounded text-[20px]">close</span>
          </button>
        </div>

        <div class="mt-4 grid gap-4">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Feature slug</div>
            <input
              v-model="newWorkSlug"
              type="text"
              placeholder="kebab-case-slug"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
            />
          </div>
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Brief</div>
            <AutoGrowTextarea
              v-model="newWorkBrief"
              :min-rows="6"
              class="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
              placeholder="Describe what you want built… (paste images too)"
              @paste="onPasteNewWork"
            />
          </div>

          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-start gap-3">
              <span class="material-symbols-rounded text-[22px] text-brand-500">attach_file</span>
              <div class="min-w-0">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Attachments</div>
                <div class="mt-1 text-sm font-bold">Paste images</div>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Paste screenshots into the brief box. Files are saved under `docs/assets/{{ newWorkSlug.trim() || '…' }}/`.
                </p>
              </div>
            </div>

            <div
              v-if="newWorkAttachmentError"
              class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
            >
              {{ newWorkAttachmentError }}
            </div>

            <div
              v-if="newWorkRunError"
              class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
            >
              {{ newWorkRunError }}
            </div>

            <div v-if="newWorkAttachments.length" class="mt-3 flex flex-wrap gap-2">
              <div v-if="activeWorkspace" class="w-full">
                <AttachmentPreviews
                  :workspace-path="activeWorkspace.path"
                  :attachments="newWorkAttachments"
                  :max="8"
                  size-class="h-24 w-24"
                  allow-remove
                  @remove="removeNewWorkAttachmentRel"
                />
              </div>
              <div
                v-for="(rel, idx) in newWorkAttachments"
                :key="rel"
                class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                <span class="material-symbols-rounded text-[16px] text-gray-400">image</span>
                <span class="max-w-[360px] truncate font-mono text-[11px]">{{ rel }}</span>
                <button
                  class="inline-flex items-center justify-center rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  type="button"
                  aria-label="Remove attachment"
                  @click="removeNewWorkAttachment(idx)"
                >
                  <span class="material-symbols-rounded text-[16px]">close</span>
                </button>
              </div>
            </div>

            <div
              v-else
              class="mt-3 rounded-xl bg-white p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300"
            >
              No images yet.
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <button
                class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                :class="
                  newWorkProfileId === 'careful'
                    ? 'bg-brand-600 text-white shadow-brand-600/20'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                "
                type="button"
                @click="newWorkProfileId = 'careful'"
              >
                <span class="material-symbols-rounded text-[18px]">verified</span>
                Careful
              </button>
              <button
                class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                :class="
                  newWorkProfileId === 'yolo'
                    ? 'bg-brand-600 text-white shadow-brand-600/20'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                "
                type="button"
                @click="newWorkProfileId = 'yolo'"
              >
                <span class="material-symbols-rounded text-[18px]">bolt</span>
                YOLO
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <select
                v-model="newWorkModelChoice"
                class="w-[240px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
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
                class="w-[220px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
              />

              <select
                v-model="newWorkThinkingChoice"
                class="w-[180px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                aria-label="Thinking level"
              >
                <option value="default">Thinking: Default</option>
                <option value="minimal">Thinking: Minimal</option>
                <option value="low">Thinking: Low</option>
                <option value="medium">Thinking: Medium</option>
                <option value="high">Thinking: High</option>
                <option value="xhigh">Thinking: XHigh</option>
              </select>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              type="button"
              @click="newWorkOpen = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
              type="button"
              :disabled="!newWorkSlug.trim() || newWorkSubmitting"
              @click="createNewWork"
            >
              <span class="material-symbols-rounded text-[18px]">{{
                newWorkSubmitting ? 'progress_activity' : 'play_arrow'
              }}</span>
              {{ newWorkSubmitting ? 'Starting…' : 'Create' }}
            </button>
          </div>

          <div v-if="newWorkRun" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-[11px] dark:border-gray-800 dark:bg-gray-900">
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Last run</div>
            <div class="mt-2 font-mono">run: {{ newWorkRun.runId }}</div>
            <div class="mt-1">status: {{ newWorkRun.status }}</div>
            <div v-if="newWorkRun.error" class="mt-1 text-red-700 dark:text-red-200">{{ newWorkRun.error }}</div>
          </div>
        </div>
      </div>
    </div>
    <ToastHost :toasts="toasts" />
  </div>
</template>
