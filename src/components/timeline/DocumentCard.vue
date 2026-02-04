<script setup lang="ts">
import MarkdownViewer from '../MarkdownViewer.vue'

withDefaults(
  defineProps<{
    icon: string
    title: string
    subtitle?: string
    markdown: string
    defaultOpen?: boolean
  }>(),
  { defaultOpen: false }
)
</script>

<template>
  <details
    class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    :open="defaultOpen"
  >
    <summary
      class="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3"
    >
      <div class="min-w-0">
        <div class="flex items-start gap-2">
          <span class="material-symbols-rounded mt-0.5 text-[20px] text-brand-500">{{ icon }}</span>
          <div class="min-w-0">
            <div class="truncate text-sm font-black">{{ title }}</div>
            <div v-if="subtitle" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ subtitle }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="$slots.actions" class="flex flex-none items-center gap-2">
        <slot name="actions" />
      </div>
    </summary>

    <div class="px-4 pb-4">
      <MarkdownViewer :markdown="markdown" />
    </div>
  </details>
</template>
