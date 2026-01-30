<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

type Tone = 'neutral' | 'good' | 'warn' | 'bad'

type UiEvent = {
  key: string
  icon: string
  tone: Tone
  title: string
  subtitle?: string
  detailsTitle?: string
  detailsBody?: string
  raw?: unknown
}

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
  events: unknown[]
  status: 'running' | 'completed' | 'failed' | 'aborted'
  startedAt?: number
  endedAt?: number | null
  meta?: RunMeta
  maxEvents?: number
  heightClass?: string
  collapseKey?: string
  defaultCollapsed?: boolean
}>()

const maxEvents = computed(() => (props.maxEvents && props.maxEvents > 0 ? props.maxEvents : 100))
const heightClass = computed(() => props.heightClass ?? 'h-[35vh] min-h-[120px]')

const collapseKey = computed(() => props.collapseKey ?? 'codex-designer:run-stream-collapsed')
const collapsed = ref(props.defaultCollapsed ?? true)

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function startTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopTicker() {
  if (!ticker) return
  clearInterval(ticker)
  ticker = null
}

watch(
  () => props.status,
  (s) => {
    if (s === 'running' && typeof props.startedAt === 'number') startTicker()
    else stopTicker()
  },
  { immediate: true }
)

watch(
  () => props.startedAt,
  () => {
    if (props.status === 'running' && typeof props.startedAt === 'number') startTicker()
    else stopTicker()
  }
)

watch(
  collapsed,
  (v) => {
    try {
      localStorage.setItem(collapseKey.value, v ? '1' : '0')
    } catch {
      // ignore
    }
  },
  { flush: 'post' }
)

onMounted(() => {
  try {
    const raw = localStorage.getItem(collapseKey.value)
    if (raw === '1') collapsed.value = true
    else if (raw === '0') collapsed.value = false
  } catch {
    // ignore
  }
})

onUnmounted(() => {
  stopTicker()
})

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const elapsedLabel = computed(() => {
  if (typeof props.startedAt !== 'number') return null
  const end =
    props.status === 'running'
      ? now.value
      : typeof props.endedAt === 'number'
        ? props.endedAt
        : now.value
  return formatDuration(end - props.startedAt)
})

const viewEvents = computed(() => {
  const evts = props.events ?? []
  if (evts.length <= maxEvents.value) return evts
  return evts.slice(evts.length - maxEvents.value)
})

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function firstLine(text: string): string {
  const line = (text ?? '').split(/\r?\n/)[0] ?? ''
  return line.length > 140 ? `${line.slice(0, 140)}…` : line
}

function tailLines(text: string, max = 14): string {
  const lines = (text ?? '').split(/\r?\n/)
  if (lines.length <= max) return text
  return lines.slice(lines.length - max).join('\n')
}

function toneFromStatus(status: string | undefined): Tone {
  if (!status) return 'neutral'
  if (status === 'failed') return 'bad'
  if (status === 'aborted') return 'warn'
  if (status === 'completed') return 'good'
  if (status === 'in_progress') return 'neutral'
  return 'neutral'
}

function summarizeEvent(evt: any, idx: number): UiEvent {
  const t = typeof evt?.type === 'string' ? evt.type : 'unknown'
  const key = `${idx}-${t}`

  // Our lifecycle events
  if (t === 'run.started') {
    return {
      key,
      icon: 'play_arrow',
      tone: 'neutral',
      title: 'Run started',
      subtitle: `${evt.role ?? 'unknown'}${evt.featureSlug ? ` • ${evt.featureSlug}` : ''}`,
      raw: evt,
    }
  }
  if (t === 'run.thread') {
    const tid = typeof evt.threadId === 'string' ? evt.threadId : ''
    return {
      key,
      icon: 'forum',
      tone: 'neutral',
      title: 'Thread started',
      subtitle: tid ? `${tid.slice(0, 14)}…` : undefined,
      raw: evt,
    }
  }
  if (t === 'run.checkpoint') {
    const head = typeof evt.headCommit === 'string' ? evt.headCommit : ''
    return {
      key,
      icon: 'commit',
      tone: 'neutral',
      title: 'Checkpoint recorded',
      subtitle: head ? head.slice(0, 10) : undefined,
      raw: evt,
    }
  }
  if (t === 'run.result') {
    const text = typeof evt.finalResponse === 'string' ? evt.finalResponse : ''
    return {
      key,
      icon: 'chat',
      tone: 'neutral',
      title: 'Final response captured',
      subtitle: text ? firstLine(text) : undefined,
      detailsTitle: 'Response',
      detailsBody: text ? (text.length > 20000 ? `${text.slice(0, 20000)}\n…(truncated)` : text) : '',
      raw: evt,
    }
  }
  if (t === 'run.completed') {
    return { key, icon: 'check_circle', tone: 'good', title: 'Run completed', raw: evt }
  }
  if (t === 'run.aborted') {
    return { key, icon: 'cancel', tone: 'warn', title: 'Run aborted', raw: evt }
  }
  if (t === 'run.failed') {
    const msg = typeof evt.message === 'string' ? evt.message : ''
    return {
      key,
      icon: 'error',
      tone: 'bad',
      title: 'Run failed',
      subtitle: msg ? firstLine(msg) : undefined,
      detailsTitle: 'Error',
      detailsBody: msg,
      raw: evt,
    }
  }

  // Codex SDK ThreadEvent
  if (t === 'thread.started') {
    const tid = typeof evt.thread_id === 'string' ? evt.thread_id : ''
    return {
      key,
      icon: 'forum',
      tone: 'neutral',
      title: 'Thread started',
      subtitle: tid ? `${tid.slice(0, 14)}…` : undefined,
      raw: evt,
    }
  }
  if (t === 'turn.started') {
    return { key, icon: 'autorenew', tone: 'neutral', title: 'Turn started', raw: evt }
  }
  if (t === 'turn.completed') {
    const usage = evt.usage
    const subtitle =
      usage && typeof usage === 'object'
        ? `tokens in:${usage.input_tokens ?? '?'} (cached:${usage.cached_input_tokens ?? '?'}) out:${usage.output_tokens ?? '?'}`
        : undefined
    return { key, icon: 'check', tone: 'good', title: 'Turn completed', subtitle, raw: evt }
  }
  if (t === 'turn.failed') {
    const msg = typeof evt?.error?.message === 'string' ? evt.error.message : ''
    return {
      key,
      icon: 'error',
      tone: 'bad',
      title: 'Turn failed',
      subtitle: msg ? firstLine(msg) : undefined,
      detailsTitle: 'Error',
      detailsBody: msg,
      raw: evt,
    }
  }
  if (t === 'error') {
    const msg = typeof evt.message === 'string' ? evt.message : ''
    return {
      key,
      icon: 'error',
      tone: 'bad',
      title: 'Stream error',
      subtitle: msg ? firstLine(msg) : undefined,
      detailsTitle: 'Error',
      detailsBody: msg,
      raw: evt,
    }
  }

  // Item events
  if ((t === 'item.started' || t === 'item.updated' || t === 'item.completed') && evt?.item) {
    const phase = t === 'item.started' ? 'started' : t === 'item.updated' ? 'updated' : 'completed'
    const item = evt.item
    const itemType = typeof item?.type === 'string' ? item.type : 'item'

    if (itemType === 'todo_list') {
      const items = Array.isArray(item.items) ? item.items : []
      const done = items.filter((i: any) => i?.completed).length
      const total = items.length
      const body =
        total === 0
          ? ''
          : items
              .map((i: any) => `${i?.completed ? '[x]' : '[ ]'} ${String(i?.text ?? '').trim()}`)
              .join('\n')
      return {
        key,
        icon: 'checklist',
        tone: 'neutral',
        title: `Todo list ${phase}`,
        subtitle: total ? `${done}/${total} complete` : undefined,
        detailsTitle: 'Todo list',
        detailsBody: body,
        raw: evt,
      }
    }

    if (itemType === 'command_execution') {
      const status = typeof item.status === 'string' ? item.status : ''
      const cmd = typeof item.command === 'string' ? item.command : ''
      const out = typeof item.aggregated_output === 'string' ? item.aggregated_output : ''
      const exit = typeof item.exit_code === 'number' ? item.exit_code : null
      const subtitleParts = [status ? status : null, exit !== null ? `exit ${exit}` : null].filter(Boolean)
      const detailsBody = out ? tailLines(out, 28) : ''
      return {
        key,
        icon: 'terminal',
        tone: status === 'failed' ? 'bad' : status === 'completed' ? 'good' : 'neutral',
        title: cmd ? `Command ${phase}` : `Command ${phase}`,
        subtitle: cmd ? `${cmd}${subtitleParts.length ? ` • ${subtitleParts.join(' • ')}` : ''}` : subtitleParts.join(' • ') || undefined,
        detailsTitle: 'Output (tail)',
        detailsBody,
        raw: evt,
      }
    }

    if (itemType === 'file_change') {
      const status = typeof item.status === 'string' ? item.status : ''
      const changes = Array.isArray(item.changes) ? item.changes : []
      const body = changes.map((c: any) => `${String(c?.kind ?? 'update').padEnd(6)} ${String(c?.path ?? '')}`).join('\n')
      return {
        key,
        icon: 'difference',
        tone: toneFromStatus(status),
        title: `Files ${phase}`,
        subtitle: `${changes.length} file(s) • ${status || 'unknown'}`,
        detailsTitle: 'Changes',
        detailsBody: body,
        raw: evt,
      }
    }

    if (itemType === 'agent_message' || itemType === 'reasoning') {
      const text = typeof item.text === 'string' ? item.text : ''
      return {
        key,
        icon: itemType === 'agent_message' ? 'chat' : 'psychology',
        tone: 'neutral',
        title: `${itemType === 'agent_message' ? 'Agent message' : 'Reasoning'} ${phase}`,
        subtitle: text ? firstLine(text) : undefined,
        detailsTitle: itemType === 'agent_message' ? 'Message' : 'Reasoning',
        detailsBody: text,
        raw: evt,
      }
    }

    if (itemType === 'mcp_tool_call') {
      const status = typeof item.status === 'string' ? item.status : ''
      const server = typeof item.server === 'string' ? item.server : 'mcp'
      const tool = typeof item.tool === 'string' ? item.tool : 'tool'
      const err = typeof item?.error?.message === 'string' ? item.error.message : ''
      return {
        key,
        icon: 'extension',
        tone: status === 'failed' ? 'bad' : status === 'completed' ? 'good' : 'neutral',
        title: `Tool ${phase}: ${server}.${tool}`,
        subtitle: err ? firstLine(err) : status || undefined,
        detailsTitle: 'Details',
        detailsBody: err || '',
        raw: evt,
      }
    }

    if (itemType === 'web_search') {
      const q = typeof item.query === 'string' ? item.query : ''
      return {
        key,
        icon: 'search',
        tone: 'neutral',
        title: `Web search ${phase}`,
        subtitle: q ? firstLine(q) : undefined,
        raw: evt,
      }
    }

    if (itemType === 'error') {
      const msg = typeof item.message === 'string' ? item.message : ''
      return {
        key,
        icon: 'error',
        tone: 'bad',
        title: `Error item ${phase}`,
        subtitle: msg ? firstLine(msg) : undefined,
        detailsTitle: 'Error',
        detailsBody: msg,
        raw: evt,
      }
    }

    return {
      key,
      icon: 'notes',
      tone: 'neutral',
      title: `${itemType} ${phase}`,
      raw: evt,
    }
  }

  return { key, icon: 'notes', tone: 'neutral', title: t, raw: evt }
}

const parsed = computed(() => viewEvents.value.map((e, idx) => summarizeEvent(e as any, idx)))
const latest = computed(() => (parsed.value.length ? parsed.value[parsed.value.length - 1] : null))

type MetaChip = { key: string; icon: string; label: string }
const coreMetaChips = computed<MetaChip[]>(() => {
  const m = props.meta
  if (!m) return []
  const out: MetaChip[] = []
  if (m.profileId) {
    out.push({
      key: 'profile',
      icon: m.profileId === 'careful' ? 'verified' : 'bolt',
      label: m.profileId === 'careful' ? 'Careful' : m.profileId === 'yolo' ? 'YOLO' : String(m.profileId),
    })
  }
  out.push({
    key: 'model',
    icon: 'model_training',
    label: m.model ? `model:${m.model}` : 'model:default',
  })
  out.push({
    key: 'effort',
    icon: 'psychology',
    label: m.modelReasoningEffort ? `thinking:${m.modelReasoningEffort}` : 'thinking:default',
  })
  return out
})

const extraMetaChips = computed<MetaChip[]>(() => {
  const m = props.meta
  if (!m) return []
  const out: MetaChip[] = []
  if (m.sandboxMode) out.push({ key: 'sandbox', icon: 'shield', label: `sandbox:${m.sandboxMode}` })
  if (m.approvalPolicy) out.push({ key: 'approvals', icon: 'policy', label: `approvals:${m.approvalPolicy}` })
  if (typeof m.networkAccessEnabled === 'boolean') {
    out.push({
      key: 'net',
      icon: m.networkAccessEnabled ? 'wifi' : 'wifi_off',
      label: m.networkAccessEnabled ? 'net:on' : 'net:off',
    })
  }
  if (m.oneShotNetwork === true) out.push({ key: 'one-shot', icon: 'bolt', label: 'one-shot net' })
  return out
})

const scroller = ref<HTMLElement | null>(null)
const pinnedToBottom = ref(true)

function onScroll() {
  const el = scroller.value
  if (!el) return
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
  pinnedToBottom.value = nearBottom
}

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => parsed.value.length,
  async () => {
    if (props.status !== 'running') return
    if (!pinnedToBottom.value) return
    await scrollToBottom()
  }
)

onMounted(() => {
  void scrollToBottom()
})

const toneClasses: Record<Tone, string> = {
  neutral: 'text-gray-600 dark:text-gray-300',
  good: 'text-emerald-700 dark:text-emerald-200',
  warn: 'text-amber-700 dark:text-amber-200',
  bad: 'text-red-700 dark:text-red-200',
}

const badgeClasses: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200',
  good: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  bad: 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200',
}
</script>

<template>
  <div class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <div class="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <div class="flex items-center gap-2">
        <span
          class="material-symbols-rounded text-[18px] text-brand-500"
          :class="status === 'running' ? 'animate-spin' : ''"
          aria-hidden="true"
          >autorenew</span
        >
        <div class="text-sm font-black">Run activity</div>
        <div class="rounded-full px-2 py-0.5 text-[11px] font-black" :class="badgeClasses[status === 'running' ? 'warn' : status === 'failed' ? 'bad' : status === 'completed' ? 'good' : 'neutral']">
          {{ status }}
        </div>
        <div
          v-if="elapsedLabel"
          class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          {{ elapsedLabel }}
        </div>
        <div class="hidden flex-wrap items-center gap-1 md:flex">
          <div
            v-for="c in coreMetaChips"
            :key="c.key"
            class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <span class="material-symbols-rounded text-[14px]" aria-hidden="true">{{ c.icon }}</span>
            {{ c.label }}
          </div>
          <div
            v-for="c in collapsed ? [] : extraMetaChips"
            :key="c.key"
            class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <span class="material-symbols-rounded text-[14px]" aria-hidden="true">{{ c.icon }}</span>
            {{ c.label }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div v-if="!collapsed" class="text-xs text-gray-500 dark:text-gray-400">
          Showing last {{ maxEvents }}
        </div>
        <button
          v-if="!collapsed && !pinnedToBottom && status === 'running'"
          class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700"
          type="button"
          @click="pinnedToBottom = true; scrollToBottom()"
        >
          <span class="material-symbols-rounded text-[16px]">arrow_downward</span>
          Latest
        </button>
        <button
          class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          type="button"
          :aria-label="collapsed ? 'Expand run activity' : 'Collapse run activity'"
          @click="collapsed = !collapsed"
        >
          <span class="material-symbols-rounded text-[18px]" aria-hidden="true">
            {{ collapsed ? 'expand_more' : 'expand_less' }}
          </span>
        </button>
      </div>
    </div>

    <div v-if="collapsed" class="p-3">
      <div v-if="!latest" class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        No events yet…
      </div>
      <div
        v-else
        class="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span class="material-symbols-rounded mt-0.5 text-[18px] text-brand-500" aria-hidden="true">{{ latest.icon }}</span>
          <div class="min-w-0">
            <div class="break-all text-sm font-black">{{ latest.title }}</div>
            <div v-if="latest.subtitle" class="mt-0.5 break-all text-xs" :class="toneClasses[latest.tone]">
              {{ latest.subtitle }}
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-1 md:hidden">
          <div
            v-for="c in coreMetaChips"
            :key="c.key"
            class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <span class="material-symbols-rounded text-[13px]" aria-hidden="true">{{ c.icon }}</span>
            {{ c.label }}
          </div>
        </div>
      </div>
    </div>

    <div v-else ref="scroller" class="overflow-auto p-3" :class="heightClass" @scroll="onScroll">
      <div v-if="!parsed.length" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        No events yet…
      </div>

      <div v-else class="space-y-2">
        <details
          v-for="e in parsed"
          :key="e.key"
          class="group rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950"
        >
          <summary class="flex cursor-pointer list-none items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <span class="material-symbols-rounded mt-0.5 text-[18px] text-brand-500">{{ e.icon }}</span>
              <div class="min-w-0">
                <div class="break-all text-sm font-black">{{ e.title }}</div>
                <div v-if="e.subtitle" class="mt-0.5 break-all text-xs" :class="toneClasses[e.tone]">
                  {{ e.subtitle }}
                </div>
              </div>
            </div>

            <span
              class="material-symbols-rounded mt-0.5 text-[18px] text-gray-400 transition-transform group-open:rotate-180"
              >expand_more</span
            >
          </summary>

          <div class="mt-3 space-y-2">
            <div
              v-if="e.detailsTitle && e.detailsBody"
              class="rounded-xl border border-gray-200 bg-white p-3 font-mono text-[11px] text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            >
              <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ e.detailsTitle }}</div>
              <pre class="mt-2 whitespace-pre-wrap break-all">{{ e.detailsBody }}</pre>
            </div>

            <details
              class="group rounded-xl border border-gray-200 bg-white p-3 font-mono text-[11px] text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            >
              <summary class="flex cursor-pointer list-none items-center justify-between gap-2">
                <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Raw JSON</div>
                <span
                  class="material-symbols-rounded text-[18px] text-gray-400 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                  >expand_more</span
                >
              </summary>
              <pre class="mt-2 whitespace-pre-wrap break-all">{{ prettyJson(e.raw) }}</pre>
            </details>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
