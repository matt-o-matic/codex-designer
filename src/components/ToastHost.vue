<script setup lang="ts">
export type ToastItem = { id: string; message: string }

const props = defineProps<{
  toasts: ToastItem[]
}>()
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in props.toasts"
        :key="t.id"
        class="pointer-events-none w-[min(360px,92vw)] rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 text-sm font-bold text-gray-800 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-950/90 dark:text-gray-100"
      >
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 160ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
