<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppState } from '../lib/appState'
import { applyAnswersToQnaMarkdown, parseQnaMarkdown } from '../lib/qna'
import { useRunStore } from '../lib/runStore'
import { createEmptyTestPlan, ensureRound, renderTestMarkdown, type TestPlan, type TestRound } from '../lib/tests'
import MarkdownViewer from '../components/MarkdownViewer.vue'

const { activeWorkspace, openWorkspace, initGit } = useAppState()
const route = useRoute()
const router = useRouter()
const { startRun, abortRun, getRun } = useRunStore()

const selectedSlug = computed(() => (route.params.slug ? String(route.params.slug) : null))
const selectedFeature = computed(() =>
  activeWorkspace.value?.features.find((f) => f.slug === selectedSlug.value) ?? null
)

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

const tab = computed(() => {
  const raw = String(route.query.tab ?? 'planning')
  if (raw === 'plan' || raw === 'implement' || raw === 'testing') return raw
  return 'planning'
})

function setTab(next: string) {
  router.replace({ query: { ...route.query, tab: next } })
}

const planningProfileId = ref<'careful' | 'yolo'>('yolo')
const planningModel = ref<string>('')
const oneShotNetwork = ref(false)

const implementationProfileId = ref<'careful' | 'yolo'>('yolo')
const implementationModel = ref<string>('')
const implementationOneShotNetwork = ref(false)
const lastImplementationRunId = ref<string | null>(null)
const lastImplementationRun = computed(() => getRun(lastImplementationRunId.value))
const lastImplementationCheckpoint = computed(() => {
  const r = lastImplementationRun.value
  if (!r) return null
  const evt = r.events.find((e: any) => e?.type === 'run.checkpoint' && typeof e?.headCommit === 'string') as any
  return evt?.headCommit ? String(evt.headCommit) : null
})

const diffStat = ref<string>('')
const diffText = ref<string>('')
const diffLoading = ref(false)

const artifactsLoading = ref(false)
const planMarkdown = ref<string>('')
const qnaMarkdown = ref<string>('')
const planLoadError = ref<string | null>(null)
const qnaLoadError = ref<string | null>(null)
const qnaLocked = ref(false)

const draftAnswers = ref<Record<string, string>>({})
const qnaData = computed(() => parseQnaMarkdown(qnaMarkdown.value))

const activeRunId = ref<string | null>(null)
const activeRun = computed(() => getRun(activeRunId.value))
const isRunBusy = computed(() => activeRun.value?.status === 'running')

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
        required: ['id', 'title', 'steps', 'expected'],
        additionalProperties: false,
      },
    },
  },
  required: ['tests'],
  additionalProperties: false,
} as const

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

async function loadArtifacts() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  artifactsLoading.value = true
  planLoadError.value = null
  qnaLoadError.value = null
  testLoadError.value = null
  qnaLocked.value = false

  try {
    planMarkdown.value = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.plan.md`)
  } catch (e) {
    planMarkdown.value = ''
    planLoadError.value = e instanceof Error ? e.message : String(e)
  }

  try {
    qnaMarkdown.value = await window.codexDesigner!.readTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`)
  } catch (e) {
    qnaMarkdown.value = ''
    qnaLoadError.value = e instanceof Error ? e.message : String(e)
  }

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

watch(
  () => selectedSlug.value,
  () => {
    if (!selectedSlug.value) return
    void loadArtifacts()
  },
  { immediate: true }
)

watch(
  () => qnaData.value.allQuestions,
  (questions) => {
    const next: Record<string, string> = {}
    for (const q of questions) next[q.id] = q.answer ?? ''
    draftAnswers.value = next
  },
  { immediate: true }
)

async function saveAnswers() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value) return
  const updates = qnaData.value.allQuestions.map((q) => ({
    id: q.id,
    answer: draftAnswers.value[q.id] ?? '',
  }))
  const next = applyAnswersToQnaMarkdown(qnaMarkdown.value, updates)
  await window.codexDesigner!.writeTextFile(activeWorkspace.value.path, `docs/${selectedSlug.value}.qna.md`, next)
  qnaMarkdown.value = next
}

async function runNextRound() {
  if (!activeWorkspace.value || !selectedSlug.value) return
  if (qnaLocked.value) return
  await saveAnswers()
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'planning',
    profileId: planningProfileId.value,
    model: planningModel.value.trim() || undefined,
    oneShotNetwork: planningProfileId.value === 'careful' ? oneShotNetwork.value : undefined,
    input:
      'I have answered the questions outlined in the Q&A document. Please update the plan and ask any additional follow-ups appended to the end of the Q&A doc. Please be sure you only ask questions that do not have an obvious answer.',
  })
  activeRunId.value = runId
  oneShotNetwork.value = false
}

async function stopRun() {
  if (!activeRunId.value) return
  await abortRun(activeRunId.value)
}

function pretty(e: unknown): string {
  try {
    return JSON.stringify(e, null, 2)
  } catch {
    return String(e)
  }
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
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    role: 'implementation',
    profileId: implementationProfileId.value,
    model: implementationModel.value.trim() || undefined,
    oneShotNetwork: implementationProfileId.value === 'careful' ? implementationOneShotNetwork.value : undefined,
    input: `$implement-plan ${selectedSlug.value}`,
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

  let text = `$implement-plan ${selectedSlug.value}\n\n`
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
    model: implementationModel.value.trim() || undefined,
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
    model: planningModel.value.trim() || undefined,
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

async function onPasteFeedback(e: ClipboardEvent, testId: string) {
  if (!activeWorkspace.value || !selectedSlug.value || !testPlan.value) return
  const dt = e.clipboardData
  if (!dt) return
  const item = Array.from(dt.items).find((i) => i.type.startsWith('image/'))
  if (!item) return

  const file = item.getAsFile()
  if (!file) return

  e.preventDefault()

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read pasted image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return
  const mime = match[1]
  const bytesBase64 = match[2]
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] ?? 'png'

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: activeWorkspace.value.path,
    featureSlug: selectedSlug.value,
    ext,
    bytesBase64,
  })

  const r = getResult(testId)
  if (!r) return
  if (!r.feedback.length) r.feedback.push({ text: '', attachments: [] })
  r.feedback[r.feedback.length - 1].attachments.push(saved.relPath)
  await saveTestPlan()
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
const newWorkProfileId = ref<'careful' | 'yolo'>('yolo')
const newWorkModel = ref('')
const newWorkRunId = ref<string | null>(null)
const newWorkRun = computed(() => getRun(newWorkRunId.value))

async function onPasteNewWork(e: ClipboardEvent) {
  if (!activeWorkspace.value) return
  const slug = newWorkSlug.value.trim()
  if (!slug) {
    newWorkAttachmentError.value = 'Enter a feature slug before pasting images.'
    return
  }

  const dt = e.clipboardData
  if (!dt) return
  const item = Array.from(dt.items).find((i) => i.type.startsWith('image/'))
  if (!item) return

  const file = item.getAsFile()
  if (!file) return

  e.preventDefault()
  newWorkAttachmentError.value = null

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read pasted image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return
  const mime = match[1]
  const bytesBase64 = match[2]
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] ?? 'png'

  const saved = await window.codexDesigner!.saveAttachment({
    workspacePath: activeWorkspace.value.path,
    featureSlug: slug,
    ext,
    bytesBase64,
  })

  newWorkAttachments.value.push(saved.relPath)
}

function removeNewWorkAttachment(idx: number) {
  newWorkAttachments.value.splice(idx, 1)
}

async function createNewWork() {
  if (!activeWorkspace.value) return
  const slug = newWorkSlug.value.trim()
  if (!slug) return
  const brief = newWorkBrief.value.trim()

  let text = `$plan-task ${slug}\n\n# Feature brief\n\n${brief}\n`
  if (newWorkAttachments.value.length) {
    text += `\n# Attachments\n\n`
    for (const rel of newWorkAttachments.value) text += `- ${rel}\n`
  }

  const input: string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> =
    newWorkAttachments.value.length
      ? [{ type: 'text', text }, ...newWorkAttachments.value.map((rel) => ({ type: 'local_image' as const, path: rel }))]
      : text
  const runId = await startRun({
    workspacePath: activeWorkspace.value.path,
    featureSlug: slug,
    role: 'planning',
    profileId: newWorkProfileId.value,
    model: newWorkModel.value.trim() || undefined,
    input,
  })
  newWorkRunId.value = runId
  activeRunId.value = runId

  // Optimistically navigate; files will appear after the run completes.
  await openWorkspace(activeWorkspace.value.path)
  router.push(`/session/${encodeURIComponent(slug)}?tab=planning`)
  newWorkOpen.value = false
  newWorkSlug.value = ''
  newWorkBrief.value = ''
  newWorkAttachments.value = []
  newWorkAttachmentError.value = null
}

onMounted(() => {
  // keep artifacts fresh when returning to this page
  if (selectedSlug.value) void loadArtifacts()
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
  <div class="space-y-6">
    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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

    <div v-if="activeWorkspace" class="grid gap-4 md:grid-cols-[360px_1fr]">
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
              @click="newWorkOpen = true"
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

      <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div v-if="!selectedFeature" class="rounded-xl bg-gray-50 p-5 text-sm dark:bg-gray-950">
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
                <h3 class="truncate text-xl font-black tracking-tight">{{ selectedFeature.slug }}</h3>
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

          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div class="flex items-center justify-between gap-3">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Run</div>
              <div class="flex items-center gap-2">
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

            <div v-if="activeRun" class="mt-2 text-xs text-gray-600 dark:text-gray-300">
              <div class="font-mono">run: {{ activeRun.runId }}</div>
              <div>Status: {{ activeRun.status }}</div>
              <div v-if="activeRun.error" class="mt-1 text-red-700 dark:text-red-200">
                {{ activeRun.error }}
              </div>
            </div>
          </div>

          <div v-if="tab === 'planning'" class="space-y-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Planning</div>
                  <div class="mt-1 text-sm font-bold">Q&amp;A rounds</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                    type="button"
                    :disabled="qnaLocked"
                    @click="saveAnswers"
                  >
                    <span class="material-symbols-rounded text-[18px]">save</span>
                    Save answers
                  </button>

                  <button
                    class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                    type="button"
                    :disabled="isRunBusy || qnaLocked"
                    @click="runNextRound"
                  >
                    <span class="material-symbols-rounded text-[18px]">autorenew</span>
                    Generate next round
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

                <input
                  v-model="planningModel"
                  type="text"
                  placeholder="Model (optional)"
                  class="w-[260px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                  :disabled="isRunBusy || qnaLocked"
                />

                <label
                  v-if="planningProfileId === 'careful'"
                  class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                >
                  <input v-model="oneShotNetwork" type="checkbox" class="h-4 w-4 accent-brand-600" />
                  One-shot tool network
                </label>
              </div>

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

              <div v-if="qnaLoadError" class="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                Q&amp;A file not found yet. Create a plan with “New work”, or run `$plan-task {{ selectedFeature.slug }}`.
              </div>

              <div v-else class="mt-4 space-y-6">
                <div v-for="round in qnaData.rounds" :key="round.title" class="space-y-3">
                  <div class="flex items-center gap-2 text-sm font-black">
                    <span class="material-symbols-rounded text-[18px] text-brand-500">flag</span>
                    {{ round.title }}
                  </div>

                  <div v-for="qItem in round.questions" :key="qItem.id" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                    <div class="text-sm font-bold">{{ qItem.prompt }}</div>

                    <div v-if="qItem.options.length" class="mt-3 flex flex-wrap gap-2">
                      <button
                        v-for="opt in qItem.options"
                        :key="opt.key"
                        class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition-colors"
                        :class="
                          (draftAnswers[qItem.id] ?? '').trim() === opt.key
                            ? 'bg-brand-600 text-white shadow-brand-600/20'
                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                        "
                        type="button"
                        :disabled="qnaLocked"
                        @click="draftAnswers[qItem.id] = opt.key"
                      >
                        {{ opt.key }}
                        <span class="text-[11px] font-semibold opacity-80">{{ opt.text }}</span>
                      </button>
                    </div>

                    <div class="mt-3">
                      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Answer
                      </div>
                      <input
                        v-model="draftAnswers[qItem.id]"
                        type="text"
                        class="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                        placeholder="Type an answer (or pick an option)"
                        :disabled="qnaLocked"
                      />
                    </div>

                    <div v-if="qItem.answers.length > 1" class="mt-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                      <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Answer history
                      </div>
                      <div class="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-200">
                        <div
                          v-for="(a, idx) in qItem.answers"
                          :key="a.lineIndex"
                          class="flex items-start justify-between gap-3 rounded-lg px-2 py-1"
                          :class="idx === qItem.answers.length - 1 ? 'bg-brand-50 dark:bg-brand-950/20' : 'bg-transparent'"
                        >
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-black text-gray-600 dark:bg-gray-800 dark:text-gray-200"
                                >#{{ idx + 1 }}</span
                              >
                              <span
                                v-if="idx === qItem.answers.length - 1"
                                class="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-black text-white"
                                >current</span
                              >
                            </div>
                            <div class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                              {{ a.text || '(blank)' }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="activeRun" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-950">
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Run events</div>
              <pre class="mt-2 whitespace-pre-wrap break-words">{{ pretty(activeRun.events.slice(-20)) }}</pre>
            </div>
          </div>

          <div v-else-if="tab === 'plan'" class="space-y-3">
            <div v-if="planLoadError" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              Plan file not found yet. Create a plan with “New work”, or run `$plan-task {{ selectedFeature.slug }}`.
            </div>
            <div v-else class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <MarkdownViewer :markdown="planMarkdown" />
            </div>
          </div>

          <div v-else-if="tab === 'implement'" class="space-y-4">
            <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Implementation</div>
                  <div class="mt-1 text-sm font-bold">Run `$implement-plan`</div>
                  <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Runs Codex against your workspace. Git safety + diffs/commit gating are implemented in the runner layer.
                  </p>
                </div>
                <button
                  class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
                  type="button"
                  :disabled="isRunBusy || !activeWorkspace?.isGitRepo || activeWorkspace?.isGitClean === false"
                  @click="runImplementation"
                >
                  <span class="material-symbols-rounded text-[18px]">play_arrow</span>
                  Implement plan
                </button>
              </div>

              <div
                v-if="activeWorkspace && !activeWorkspace.isGitRepo"
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
                v-else-if="activeWorkspace && activeWorkspace.isGitRepo && activeWorkspace.isGitClean === false"
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

                <input
                  v-model="implementationModel"
                  type="text"
                  placeholder="Model (optional)"
                  class="w-[260px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
                  :disabled="isRunBusy"
                />

                <label
                  v-if="implementationProfileId === 'careful'"
                  class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                >
                  <input v-model="implementationOneShotNetwork" type="checkbox" class="h-4 w-4 accent-brand-600" />
                  One-shot tool network
                </label>
              </div>
            </div>

            <div v-if="lastImplementationRun" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-950">
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
              <pre class="mt-3 whitespace-pre-wrap break-words">{{ pretty(lastImplementationRun.events.slice(-20)) }}</pre>

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
            <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
                No `docs/{{ selectedFeature.slug }}.test.json` yet; it will be created when you generate or save tests.
              </div>

              <div v-if="testPlan" class="mt-4 space-y-3">
                <div class="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                  Paste images into any feedback box to attach screenshots (saved under `docs/assets/{{ selectedFeature.slug }}/`).
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
                      <textarea
                        v-model="getResult(t.id)!.feedback[0].text"
                        rows="3"
                        class="mt-2 w-full resize-none rounded-xl bg-white px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
                        placeholder="Notes…"
                        @paste="onPasteFeedback($event as ClipboardEvent, t.id)"
                        @blur="saveTestPlan"
                      ></textarea>

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

            <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
                <input
                  v-model="commitMessage"
                  type="text"
                  placeholder="Commit message (auto-filled if blank)"
                  class="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-950"
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

    <!-- New work modal -->
    <div v-if="newWorkOpen" class="fixed inset-0 z-50">
      <button class="absolute inset-0 bg-black/50" type="button" @click="newWorkOpen = false"></button>
      <div class="absolute left-1/2 top-1/2 w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-950">
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
            <textarea
              v-model="newWorkBrief"
              rows="6"
              class="mt-2 w-full resize-none rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
              placeholder="Describe what you want built…"
              @paste="onPasteNewWork"
            ></textarea>
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

            <div v-if="newWorkAttachments.length" class="mt-3 flex flex-wrap gap-2">
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

            <input
              v-model="newWorkModel"
              type="text"
              placeholder="Model (optional)"
              class="w-[240px] rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none ring-0 focus:ring-2 focus:ring-brand-500 dark:bg-gray-900"
            />
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
              :disabled="!newWorkSlug.trim()"
              @click="createNewWork"
            >
              <span class="material-symbols-rounded text-[18px]">play_arrow</span>
              Create
            </button>
          </div>

          <div v-if="newWorkRun" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-900">
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Last run</div>
            <pre class="mt-2 whitespace-pre-wrap break-words">{{ pretty(newWorkRun.events.slice(-10)) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
