<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  minRows?: number
  maxRows?: number
  class?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'blur', evt: FocusEvent): void
  (e: 'paste', evt: ClipboardEvent): void
}>()

const el = ref<HTMLTextAreaElement | null>(null)

const minRows = computed(() => Math.max(1, Math.floor(props.minRows ?? 1)))
const maxRows = computed(() => (props.maxRows ? Math.max(minRows.value, Math.floor(props.maxRows)) : null))

function syncHeight() {
  const t = el.value
  if (!t) return
  t.style.height = 'auto'

  const lineHeight = Number.parseFloat(getComputedStyle(t).lineHeight || '0') || 20
  const paddingTop = Number.parseFloat(getComputedStyle(t).paddingTop || '0') || 0
  const paddingBottom = Number.parseFloat(getComputedStyle(t).paddingBottom || '0') || 0

  const minH = minRows.value * lineHeight + paddingTop + paddingBottom
  const maxByRows = maxRows.value ? maxRows.value * lineHeight + paddingTop + paddingBottom : Infinity
  const maxByViewport = typeof window !== 'undefined' ? window.innerHeight * 0.5 : Infinity
  const maxH = Math.min(maxByRows, maxByViewport)
  const next = Math.min(Math.max(t.scrollHeight, minH), maxH)
  t.style.height = `${Math.ceil(next)}px`
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  syncHeight()
}

watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    syncHeight()
  }
)

onMounted(() => {
  syncHeight()
  window.addEventListener('resize', syncHeight)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncHeight)
})
</script>

<template>
  <textarea
    ref="el"
    :value="modelValue"
    :rows="minRows"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full resize-none"
    :class="props.class"
    @input="onInput"
    @blur="emit('blur', $event)"
    @paste="emit('paste', $event)"
  ></textarea>
</template>
