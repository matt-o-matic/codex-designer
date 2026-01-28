<script setup lang="ts">
defineProps<{
  active: string
}>()

const emit = defineEmits<{
  (e: 'navigate', path: string): void
}>()

function nav(path: string) {
  emit('navigate', path)
}

function itemClass(path: string, active: string) {
  const isActive = active === path || active.startsWith(`${path}/`)
  return [
    'group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20'
      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900',
  ].join(' ')
}
</script>

<template>
  <aside class="hidden w-64 flex-none border-r border-gray-200 p-4 dark:border-gray-800 md:block">
    <div class="space-y-2">
      <button :class="itemClass('/workspace', active)" type="button" @click="nav('/workspace')">
        <span class="material-symbols-rounded text-[18px]">folder_open</span>
        Workspace
      </button>
      <button :class="itemClass('/session', active)" type="button" @click="nav('/session')">
        <span class="material-symbols-rounded text-[18px]">chat</span>
        Sessions
      </button>
      <button :class="itemClass('/settings', active)" type="button" @click="nav('/settings')">
        <span class="material-symbols-rounded text-[18px]">tune</span>
        Settings
      </button>
    </div>

    <div class="mt-6 rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
      <div class="flex items-center gap-2 font-black text-gray-900 dark:text-gray-100">
        <span class="material-symbols-rounded text-[18px] text-brand-500">tips_and_updates</span>
        House Style
      </div>
      <p class="mt-2 leading-relaxed">
        Dark-mode-first, material-inspired surfaces, soft borders, and crisp focus states.
      </p>
    </div>
  </aside>
</template>
