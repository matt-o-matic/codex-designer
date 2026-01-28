<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  canOpenNav?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-nav'): void
}>()

const isDark = ref(document.documentElement.classList.contains('dark'))

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('codex-designer:theme', isDark.value ? 'dark' : 'light')
}
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/70"
  >
    <div class="flex items-center gap-3 px-4 py-3 sm:px-6">
      <button
        v-if="canOpenNav"
        class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 md:hidden"
        type="button"
        aria-label="Open navigation"
        @click="emit('toggle-nav')"
      >
        <span class="material-symbols-rounded text-[20px]">menu</span>
      </button>

      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="material-symbols-rounded text-brand-600 dark:text-brand-400"
            >auto_awesome</span
          >
          <h1 class="truncate text-sm font-black tracking-tight">codex-designer</h1>
        </div>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Plan → Implement → Test, with less friction.
        </p>
      </div>

      <div class="flex-1"></div>

      <button
        class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        type="button"
        @click="toggleTheme"
      >
        <span class="material-symbols-rounded text-[18px]">{{
          isDark ? 'dark_mode' : 'light_mode'
        }}</span>
        Theme
      </button>
    </div>
  </header>
</template>
