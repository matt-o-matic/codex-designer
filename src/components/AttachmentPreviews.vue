<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'

const props = defineProps<{
  workspacePath: string
  attachments: string[]
  max?: number
  sizeClass?: string
}>()

const max = computed(() => (props.max && props.max > 0 ? Math.floor(props.max) : 6))
const sizeClass = computed(() => props.sizeClass ?? 'h-20 w-20')
const items = computed(() => (props.attachments ?? []).slice(-max.value))

const urls = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})

watchEffect(() => {
  const ws = props.workspacePath
  if (!ws) return

  for (const rel of items.value) {
    if (!rel || urls.value[rel] || errors.value[rel]) continue
    void (async () => {
      try {
        const url = await window.codexDesigner?.readAttachmentDataUrl?.(ws, rel)
        if (!url) throw new Error('Failed to load image preview.')
        urls.value = { ...urls.value, [rel]: url }
      } catch (e) {
        errors.value = { ...errors.value, [rel]: e instanceof Error ? e.message : String(e) }
      }
    })()
  }
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
      class="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm dark:border-gray-800 dark:bg-gray-950"
      :class="sizeClass"
      :title="rel"
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

      <div class="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-[10px] font-bold text-white">
        <div class="truncate">{{ shortName(rel) }}</div>
      </div>
    </div>
  </div>
</template>

