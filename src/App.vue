<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import AppSidebarMobile from './components/AppSidebarMobile.vue'
import { useAppState } from './lib/appState'

const route = useRoute()
const router = useRouter()
const { activeWorkspace } = useAppState()

const active = computed(() => route.path)
const mobileNavOpen = ref(false)
const isDesktop = ref(false)

const DESKTOP_NAV_KEY = 'codex-designer:desktop-nav-open'
const desktopNavOpen = ref(true)

try {
  const raw = localStorage.getItem(DESKTOP_NAV_KEY)
  desktopNavOpen.value = raw !== '0'
} catch {
  desktopNavOpen.value = true
}

watch(desktopNavOpen, (open) => {
  try {
    localStorage.setItem(DESKTOP_NAV_KEY, open ? '1' : '0')
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

function go(path: string) {
  router.push(path)
}

function shortWorkspaceLabel(p: string): string {
  const normalized = (p ?? '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized || p
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

const sessionSlug = computed(() => (route.params.slug ? String(route.params.slug) : null))
const workspaceLabel = computed(() => (activeWorkspace.value?.path ? shortWorkspaceLabel(activeWorkspace.value.path) : null))
const windowTitle = computed(() => {
  const parts = ['codex-designer']
  if (workspaceLabel.value) parts.push(workspaceLabel.value)
  if (sessionSlug.value) parts.push(sessionSlug.value)
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
    class="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-950"
  >
    <div class="flex min-h-screen w-full">
      <AppSidebar :active="active" :open="desktopNavOpen" @navigate="go" />
      <AppSidebarMobile
        :active="active"
        :open="mobileNavOpen"
        @close="mobileNavOpen = false"
        @navigate="go"
      />

      <div class="min-w-0 flex-1">
        <AppTopbar
          can-open-nav
          :nav-open="isDesktop ? desktopNavOpen : false"
          @toggle-nav="toggleNav"
        />
        <main class="p-3 sm:p-4">
          <router-view />
        </main>
      </div>
    </div>
  </div>
</template>
