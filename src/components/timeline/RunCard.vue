<script setup lang="ts">
import { computed } from 'vue'
import MarkdownViewer from '../MarkdownViewer.vue'
import RunEventStream from '../RunEventStream.vue'
import AttachmentPreviews from '../AttachmentPreviews.vue'
import { parseLenientJson } from '../../lib/json'
import type { WorkspaceDiffSummary } from '../../lib/runStore'
import {
  createEmptyQnaStateV1,
  normalizeQnaStateV1,
  parseQnaStateJson,
  renderQnaMarkdownFromState,
  type QnaRoundV1,
} from '../../lib/qnaState'

type RunStatus = 'running' | 'completed' | 'failed' | 'aborted'

type RunMeta = {
  profileId?: string | null
  model?: string | null
  modelReasoningEffort?: string | null
  sandboxMode?: string | null
  approvalPolicy?: string | null
  networkAccessEnabled?: boolean | null
  oneShotNetwork?: boolean | null
}

const props = defineProps<{
  runId: string
  title: string
  subtitle?: string
  status: RunStatus
  startedAt: number
  endedAt: number | null
  workspacePath?: string
  userMessage?: string
  userAttachments?: string[]
  inputPrompt?: string
  finalResponse: string
  events: unknown[]
  meta?: RunMeta
  collapseKey?: string
  canStop?: boolean
  workspaceDiff?: WorkspaceDiffSummary | null
}>()

const emit = defineEmits<{
  (e: 'stop'): void
}>()

function badgeClass(status: RunStatus): string {
  if (status === 'running') return 'bg-brand-600 text-white'
  if (status === 'completed') return 'bg-emerald-600 text-white'
  if (status === 'aborted') return 'bg-amber-600 text-white'
  return 'bg-red-600 text-white'
}

function prettyDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m <= 0) return `${s}s`
  return `${m}m ${s}s`
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

const durationLabel = computed(() => {
  const end = props.status === 'running' ? Date.now() : props.endedAt ?? Date.now()
  return prettyDuration(end - props.startedAt)
})

const startedLabel = computed(() => formatTimestamp(props.startedAt))
const assistantLabel = computed(() => formatTimestamp(props.endedAt ?? props.startedAt))

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function joinMarkdownSections(sections: string[]): string {
  const normalized = sections
    .map((s) => String(s ?? '').trimEnd())
    .filter((s) => s.length > 0)
  if (!normalized.length) return ''
  return ensureTrailingNewline(normalized.join('\n\n---\n\n'))
}

function extractSlugFromPlanMarkdown(planMarkdown: string): string | null {
  const firstNonEmptyLine =
    String(planMarkdown ?? '')
      .split(/\r?\n/)
      .find((l) => l.trim().length) ?? ''

  const m = firstNonEmptyLine.match(/^#\s+(.+?)\s+(?:—|-)\s+Plan\s*$/)
  const slug = String(m?.[1] ?? '').trim()
  return slug.length ? slug : null
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

function tryRenderStructuredOutput(text: string): string | null {
  try {
    const trimmed = String(text ?? '').trim()
    if (!trimmed.length) return null
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('```')) return null

    const parsed = parseLenientJson(text)?.value

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>

    const planMarkdown = typeof obj.planMarkdown === 'string' ? obj.planMarkdown : null
    const sections: string[] = []
    if (planMarkdown) sections.push(planMarkdown)

    if (obj.qna && planMarkdown) {
      const qnaState = parseQnaStateJson(safeStringify(obj.qna))
      if (qnaState) {
        const { state } = normalizeQnaStateV1(qnaState)
        sections.push(renderQnaMarkdownFromState(state))
        return joinMarkdownSections(sections)
      }
    }

    if (obj.qnaRound && planMarkdown) {
      const slug = extractSlugFromPlanMarkdown(planMarkdown) ?? 'feature'
      const qnaRound = obj.qnaRound as QnaRoundV1
      const state = createEmptyQnaStateV1(slug)
      state.rounds = [qnaRound]
      const { state: normalized } = normalizeQnaStateV1(state)
      sections.push(renderQnaMarkdownFromState(normalized))
      return joinMarkdownSections(sections)
    }

    if (planMarkdown) return ensureTrailingNewline(planMarkdown)
    return null
  } catch {
    return null
  }
}

function toMarkdown(text: string): string {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const structured = tryRenderStructuredOutput(raw)
  if (structured) return structured

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return `\`\`\`json\n${trimmed}\n\`\`\`\n`
  }
  return raw
}

const markdown = computed(() => toMarkdown(props.finalResponse))

const showUserMessage = computed(() => String(props.userMessage ?? '').trim().length > 0)
const showUserAttachments = computed(
  () => !!props.workspacePath && Array.isArray(props.userAttachments) && props.userAttachments.length > 0
)

const diffUpdatedLabel = computed(() => {
  const t = props.workspaceDiff?.updatedAtMs
  return typeof t === 'number' && Number.isFinite(t) ? formatTimestamp(t) : ''
})

function diffStatusLabel(status: WorkspaceDiffSummary['files'][number]['status']): string {
  if (status === 'added') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  if (status === 'untracked') return '??'
  if (status === 'modified') return 'M'
  return '?'
}

function diffStatusClass(status: WorkspaceDiffSummary['files'][number]['status']): string {
  if (status === 'added') return 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'deleted') return 'bg-rose-600/10 text-rose-700 dark:text-rose-200'
  if (status === 'renamed' || status === 'copied') return 'bg-brand-600/10 text-brand-700 dark:text-brand-200'
  if (status === 'untracked') return 'bg-amber-600/10 text-amber-700 dark:text-amber-200'
  if (status === 'modified') return 'bg-gray-500/10 text-gray-700 dark:text-gray-200'
  return 'bg-gray-500/10 text-gray-700 dark:text-gray-200'
}
</script>

<template>
  <section class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <header class="flex items-start justify-between gap-3 px-4 py-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <div class="truncate text-sm font-black">{{ title }}</div>
          <span class="rounded-full px-2 py-0.5 text-[11px] font-black" :class="badgeClass(status)">
            {{ status }}
          </span>
          <span class="text-[11px] font-semibold text-gray-400">· {{ startedLabel }}</span>
          <span class="text-[11px] font-semibold text-gray-400">· {{ durationLabel }}</span>
        </div>
        <div v-if="subtitle" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ subtitle }}</div>
      </div>

      <div class="flex flex-none items-center gap-2">
        <button
          v-if="canStop && status === 'running'"
          class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          type="button"
          @click="emit('stop')"
        >
          <span class="material-symbols-rounded text-[18px]">stop</span>
          Stop
        </button>
      </div>
    </header>

    <div class="px-4 pb-4">
      <div
        v-if="showUserMessage"
        class="mb-3 rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-900/40 dark:bg-brand-900/20"
      >
        <div class="flex items-baseline justify-between gap-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-brand-700 dark:text-brand-200">You</div>
          <div class="text-[10px] font-semibold text-brand-700/70 dark:text-brand-200/70">{{ startedLabel }}</div>
        </div>

        <AttachmentPreviews
          v-if="showUserAttachments"
          class="mt-2"
          :workspace-path="workspacePath!"
          :attachments="userAttachments!"
          :max="6"
        />

        <div class="mt-2 rounded-xl bg-white/70 p-3 dark:bg-gray-900/40">
          <MarkdownViewer :markdown="String(userMessage ?? '')" />
        </div>
      </div>

      <details class="mb-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950" open>
        <summary class="cursor-pointer select-none text-[10px] font-black uppercase tracking-widest text-gray-400">
          Diagnostics
        </summary>
        <div class="mt-3">
          <RunEventStream
            :events="events"
            :status="status"
            :started-at="startedAt"
            :ended-at="endedAt"
            :meta="meta"
            :max-events="100"
            :collapse-key="collapseKey"
            :default-collapsed="true"
          />
        </div>
      </details>
      
      <div v-if="markdown.trim().length" class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
        <div class="mb-2 flex items-baseline justify-between gap-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Codex</div>
          <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{{ assistantLabel }}</div>
        </div>
        <MarkdownViewer :markdown="markdown" />
      </div>
      <div v-else class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        No final response yet.
      </div>

      <div
        v-if="workspaceDiff && (workspaceDiff.error || workspaceDiff.files.length)"
        class="mt-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950"
      >
        <div class="flex items-baseline justify-between gap-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Edited files</div>
          <div v-if="diffUpdatedLabel" class="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
            updated {{ diffUpdatedLabel }}
          </div>
        </div>

        <div v-if="workspaceDiff.error" class="mt-2 text-xs text-rose-700 dark:text-rose-200">
          {{ workspaceDiff.error }}
        </div>

        <div v-else class="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
          <div
            v-for="f in workspaceDiff.files"
            :key="f.path"
            class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="min-w-0 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">
              {{ f.path }}
            </div>
            <div class="flex flex-none items-center gap-2 font-mono text-[11px]">
              <span class="rounded-full px-2 py-0.5 font-black" :class="diffStatusClass(f.status)">
                {{ diffStatusLabel(f.status) }}
              </span>
              <span class="text-emerald-700 dark:text-emerald-200">+{{ f.additions ?? '—' }}</span>
              <span class="text-rose-700 dark:text-rose-200">-{{ f.deletions ?? '—' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
