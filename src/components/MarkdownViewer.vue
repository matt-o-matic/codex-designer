<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed } from 'vue'

const props = defineProps<{
  markdown: string
}>()

const html = computed(() => {
  const raw = marked.parse(props.markdown ?? '', { breaks: true }) as string
  return DOMPurify.sanitize(raw)
})
</script>

<template>
  <div
    class="markdown max-w-none text-sm leading-relaxed text-gray-800 dark:text-gray-100"
    v-html="html"
  ></div>
</template>

<style scoped>
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  font-weight: 800;
  letter-spacing: -0.01em;
}
.markdown :deep(h1) {
  font-size: 1.25rem;
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
}
.markdown :deep(h2) {
  font-size: 1.05rem;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
.markdown :deep(h3) {
  font-size: 0.95rem;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
}
.markdown :deep(p) {
  margin: 0.5rem 0;
}
.markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.85em;
  padding: 0.15rem 0.35rem;
  border-radius: 0.5rem;
  background: rgba(148, 163, 184, 0.2);
}
.markdown :deep(pre) {
  margin: 0.75rem 0;
  padding: 0.75rem;
  border-radius: 1rem;
  overflow: auto;
  background: rgba(2, 6, 23, 0.6);
  color: #e5e7eb;
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
.markdown :deep(a) {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown :deep(ul) {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
}
.markdown :deep(li) {
  margin: 0.25rem 0;
}
</style>

