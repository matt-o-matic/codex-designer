<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad'

const props = withDefaults(
  defineProps<{
    icon?: string
    title?: string
    subtitle?: string
    tone?: Tone
    padded?: boolean
  }>(),
  {
    tone: 'neutral',
    padded: true,
  }
)

const toneRing = computed(() => {
  if (props.tone === 'brand') return 'ring-1 ring-brand-500/25'
  if (props.tone === 'good') return 'ring-1 ring-emerald-500/20'
  if (props.tone === 'warn') return 'ring-1 ring-amber-500/20'
  if (props.tone === 'bad') return 'ring-1 ring-red-500/20'
  return ''
})
</script>

<template>
  <section
    class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    :class="toneRing"
  >
    <header v-if="icon || title || subtitle || $slots.actions" class="flex items-start justify-between gap-3 px-4 py-3">
      <div class="min-w-0">
        <div v-if="icon || title" class="flex items-start gap-2">
          <span v-if="icon" class="material-symbols-rounded mt-0.5 text-[20px] text-brand-500">
            {{ icon }}
          </span>
          <div class="min-w-0">
            <div v-if="title" class="truncate text-sm font-black">{{ title }}</div>
            <div v-if="subtitle" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ subtitle }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="$slots.actions" class="flex flex-none items-center gap-2">
        <slot name="actions" />
      </div>
    </header>

    <div :class="padded ? 'px-4 pb-4' : ''">
      <slot />
    </div>
  </section>
</template>

