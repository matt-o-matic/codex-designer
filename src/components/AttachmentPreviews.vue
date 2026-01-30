<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'

const props = withDefaults(
  defineProps<{
  workspacePath: string
  attachments: string[]
  max?: number
  sizeClass?: string
  allowRemove?: boolean
  allowExpand?: boolean
  }>(),
  {
    allowRemove: false,
    allowExpand: true,
  }
)

const emit = defineEmits<{
  (e: 'remove', relPath: string): void
}>()

const max = computed(() => (props.max && props.max > 0 ? Math.floor(props.max) : 6))
const sizeClass = computed(() => props.sizeClass ?? 'h-20 w-20')
const items = computed(() => (props.attachments ?? []).slice(-max.value))
const allowRemove = computed(() => props.allowRemove)
const allowExpand = computed(() => props.allowExpand)

const urls = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})

async function ensureUrl(rel: string): Promise<void> {
  const ws = props.workspacePath
  if (!ws || !rel) return
  if (urls.value[rel] || errors.value[rel]) return

  try {
    const url = await window.codexDesigner?.readAttachmentDataUrl?.(ws, rel)
    if (!url) throw new Error('Failed to load image preview.')
    urls.value = { ...urls.value, [rel]: url }
  } catch (e) {
    errors.value = { ...errors.value, [rel]: e instanceof Error ? e.message : String(e) }
  }
}

watchEffect(() => {
  for (const rel of items.value) {
    if (!rel) continue
    void ensureUrl(rel)
  }
})

const expandedRel = ref<string | null>(null)
const expandedUrl = computed(() => (expandedRel.value ? urls.value[expandedRel.value] ?? '' : ''))
const expandedError = computed(() => (expandedRel.value ? errors.value[expandedRel.value] ?? '' : ''))

function open(rel: string) {
  if (!allowExpand.value) return
  expandedRel.value = rel
  void ensureUrl(rel)
}

function close() {
  expandedRel.value = null
}

watchEffect((onCleanup) => {
  if (!expandedRel.value) return
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))
})

function shortName(rel: string): string {
  const normalized = String(rel ?? '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <div
      v-for="rel in items"
      :key="rel"
      class="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left shadow-sm transition-transform hover:scale-[1.01] dark:border-gray-800 dark:bg-gray-950"
      :class="[sizeClass, allowExpand ? 'cursor-zoom-in' : 'cursor-default']"
      :title="rel"
      :role="allowExpand ? 'button' : undefined"
      :tabindex="allowExpand ? 0 : undefined"
      @click="allowExpand ? open(rel) : undefined"
      @keydown.enter.prevent="allowExpand ? open(rel) : undefined"
      @keydown.space.prevent="allowExpand ? open(rel) : undefined"
    >
      <img
        v-if="urls[rel]"
        :src="urls[rel]"
        :alt="shortName(rel)"
        class="h-full w-full object-cover"
        loading="lazy"
      />
      <div v-else class="flex h-full w-full items-center justify-center text-gray-400">
        <span class="material-symbols-rounded text-[22px]" aria-hidden="true">image</span>
      </div>

      <button
        v-if="allowRemove"
        class="absolute right-1 top-1 inline-flex items-center justify-center rounded-lg bg-black/60 p-1 text-white opacity-0 shadow-sm transition-opacity hover:bg-black/70 group-hover:opacity-100"
        type="button"
        aria-label="Remove image"
        @click.stop="emit('remove', rel)"
      >
        <span class="material-symbols-rounded text-[16px]">close</span>
      </button>

      <div class="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-[10px] font-bold text-white">
        <div class="truncate">{{ shortName(rel) }}</div>
      </div>
    </div>
  </div>

  <div
    v-if="expandedRel"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    @click.self="close"
  >
    <div class="w-[min(1100px,95vw)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
      <div class="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono text-xs text-gray-700 dark:text-gray-200">{{ expandedRel }}</div>
        </div>
        <button
          v-if="allowRemove && expandedRel"
          class="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 shadow-sm transition-colors hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
          type="button"
          @click="emit('remove', expandedRel); close()"
        >
          <span class="material-symbols-rounded text-[18px]">delete</span>
          Remove
        </button>
        <button
          class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          type="button"
          aria-label="Close"
          @click="close"
        >
          <span class="material-symbols-rounded text-[20px]">close</span>
        </button>
      </div>

      <div class="flex max-h-[80vh] items-center justify-center bg-black/[0.02] p-3 dark:bg-white/[0.02]">
        <img
          v-if="expandedUrl"
          :src="expandedUrl"
          :alt="shortName(expandedRel)"
          class="max-h-[76vh] w-auto max-w-full rounded-xl object-contain shadow-sm"
        />
        <div
          v-else-if="expandedError"
          class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
        >
          {{ expandedError }}
        </div>
        <div v-else class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span class="material-symbols-rounded text-[20px]">progress_activity</span>
          Loading…
        </div>
      </div>
    </div>
  </div>
</template>
