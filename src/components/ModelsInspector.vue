<script setup lang="ts">
import type { CodexModelInfo } from '../lib/models'

const props = defineProps<{
  models: CodexModelInfo[]
  loading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  (e: 'refresh', force: boolean): void
}>()
</script>

<template>
  <div class="mt-2 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div class="text-xs text-gray-500 dark:text-gray-400">
        <span v-if="props.loading">Loading models…</span>
        <span v-else-if="props.models.length">{{ props.models.length }} model(s) available</span>
        <span v-else>No models returned (check Codex auth/config)</span>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
        type="button"
        :disabled="props.loading"
        @click="emit('refresh', true)"
      >
        <span class="material-symbols-rounded text-[16px]">refresh</span>
        Reload
      </button>

      <details class="group">
        <summary class="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-black text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900">
          <span class="material-symbols-rounded text-[16px] text-brand-500">view_list</span>
          View models
          <span class="material-symbols-rounded text-[18px] text-gray-400 transition-transform group-open:rotate-180"
            >expand_more</span
          >
        </summary>

        <div class="mt-2 space-y-2">
          <div
            v-for="m in props.models"
            :key="m.model"
            class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="font-black">
                {{ m.displayName }}
                <span
                  v-if="m.isDefault"
                  class="ml-2 rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-black text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                >
                  default
                </span>
              </div>
              <div class="font-mono text-[11px] text-gray-500 dark:text-gray-400">{{ m.model }}</div>
            </div>
            <div v-if="m.description" class="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
              {{ m.description }}
            </div>
          </div>
        </div>
      </details>
    </div>

    <div
      v-if="props.error"
      class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
    >
      {{ props.error }}
    </div>
  </div>
</template>
