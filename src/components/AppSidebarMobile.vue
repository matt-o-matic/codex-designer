<script setup lang="ts">
defineProps<{
  active: string
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'navigate', path: string): void
}>()

function nav(path: string) {
  emit('navigate', path)
  emit('close')
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
  <div v-if="open" class="fixed inset-0 z-40 md:hidden">
    <button
      class="absolute inset-0 bg-black/40"
      type="button"
      aria-label="Close navigation"
      @click="emit('close')"
    ></button>

    <aside
      class="absolute left-0 top-0 h-full w-[280px] border-r border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="material-symbols-rounded text-brand-600 dark:text-brand-400"
            >auto_awesome</span
          >
          <div class="text-sm font-black tracking-tight">codex-designer</div>
        </div>
        <button
          class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          type="button"
          aria-label="Close navigation"
          @click="emit('close')"
        >
          <span class="material-symbols-rounded text-[20px]">close</span>
        </button>
      </div>

      <div class="mt-4 space-y-2">
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
    </aside>
  </div>
</template>
