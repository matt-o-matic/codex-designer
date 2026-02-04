<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import AppSidebarMobile from './components/AppSidebarMobile.vue'
import NewFeatureModal from './components/NewFeatureModal.vue'
import { useAppState } from './lib/appState'
import { useWorkbenchUi } from './lib/workbenchUi'

const { activeWorkspace } = useAppState()
const { selectedSessionSlug } = useWorkbenchUi()

const mobileNavOpen = ref(false)
const isDesktop = ref(false)

const DESKTOP_NAV_KEY = 'codex-designer:desktop-nav-open'
const desktopNavOpen = ref(true)

const DESKTOP_NAV_WIDTH_KEY = 'codex-designer:desktop-nav-width'
const desktopNavWidth = ref(256)
const navResizing = ref(false)

try {
  const raw = localStorage.getItem(DESKTOP_NAV_KEY)
  desktopNavOpen.value = raw !== '0'
} catch {
  desktopNavOpen.value = true
}

function clampNavWidth(px: number): number {
  const min = 240
  const max = 520
  if (!Number.isFinite(px)) return 256
  return Math.max(min, Math.min(max, Math.round(px)))
}

try {
  const raw = localStorage.getItem(DESKTOP_NAV_WIDTH_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed)) desktopNavWidth.value = clampNavWidth(parsed)
} catch {
  // ignore
}

watch(desktopNavOpen, (open) => {
  try {
    localStorage.setItem(DESKTOP_NAV_KEY, open ? '1' : '0')
  } catch {
    // ignore
  }
})

watch(desktopNavWidth, (px) => {
  const next = clampNavWidth(px)
  if (desktopNavWidth.value !== next) {
    desktopNavWidth.value = next
    return
  }
  try {
    localStorage.setItem(DESKTOP_NAV_WIDTH_KEY, String(desktopNavWidth.value))
  } catch {
    // ignore
  }
})

let mq: MediaQueryList | null = null
function handleMqChange(e: MediaQueryListEvent) {
  isDesktop.value = e.matches
  if (e.matches) mobileNavOpen.value = false
}

onMounted(() => {
  mq = window.matchMedia('(min-width: 768px)')
  isDesktop.value = mq.matches
  mq.addEventListener('change', handleMqChange)
})

onUnmounted(() => {
  mq?.removeEventListener('change', handleMqChange)
  mq = null
})

function toggleNav() {
  if (isDesktop.value) {
    desktopNavOpen.value = !desktopNavOpen.value
    return
  }
  mobileNavOpen.value = true
}

function startNavResize(e: MouseEvent) {
  if (!isDesktop.value) return
  if (!desktopNavOpen.value) return

  navResizing.value = true
  const startX = e.clientX
  const startW = desktopNavWidth.value

  const onMove = (ev: MouseEvent) => {
    desktopNavWidth.value = clampNavWidth(startW + (ev.clientX - startX))
  }
  const onUp = () => {
    navResizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  e.preventDefault()
}

function shortWorkspaceLabel(p: string): string {
  const normalized = (p ?? '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized || p
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

const workspaceLabel = computed(() => (activeWorkspace.value?.path ? shortWorkspaceLabel(activeWorkspace.value.path) : null))
const windowTitle = computed(() => {
  const parts = ['codex-designer']
  if (workspaceLabel.value) parts.push(workspaceLabel.value)
  if (selectedSessionSlug.value) parts.push(selectedSessionSlug.value)
  return parts.join(' — ')
})

watch(
  () => windowTitle.value,
  (t) => {
    void window.codexDesigner?.setWindowTitle?.(t)
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="h-screen overflow-hidden bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-950"
  >
    <div class="flex h-full w-full overflow-hidden">
      <AppSidebar :open="desktopNavOpen" :width-px="desktopNavWidth" :resizing="navResizing" />
      <div
        v-if="isDesktop && desktopNavOpen"
        class="group relative hidden w-1 flex-none cursor-col-resize md:block"
        aria-hidden="true"
        @mousedown="startNavResize"
      >
        <div class="absolute inset-0 bg-transparent transition-colors group-hover:bg-brand-500/20"></div>
      </div>
      <AppSidebarMobile
        :open="mobileNavOpen"
        @close="mobileNavOpen = false"
      />

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopbar
          can-open-nav
          :nav-open="isDesktop ? desktopNavOpen : false"
          @toggle-nav="toggleNav"
        />
        <main class="flex-1 overflow-y-auto p-3 sm:p-4">
          <router-view />
        </main>
      </div>
    </div>

    <NewFeatureModal />
  </div>
</template>
