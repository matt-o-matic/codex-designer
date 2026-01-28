<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import AppSidebarMobile from './components/AppSidebarMobile.vue'

const route = useRoute()
const router = useRouter()

const active = computed(() => route.path)
const mobileNavOpen = ref(false)

function go(path: string) {
  router.push(path)
}
</script>

<template>
  <div
    class="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-950"
  >
    <div class="mx-auto flex min-h-screen max-w-[1400px]">
      <AppSidebar :active="active" @navigate="go" />
      <AppSidebarMobile
        :active="active"
        :open="mobileNavOpen"
        @close="mobileNavOpen = false"
        @navigate="go"
      />

      <div class="min-w-0 flex-1">
        <AppTopbar can-open-nav @toggle-nav="mobileNavOpen = true" />
        <main class="p-4 sm:p-6">
          <router-view />
        </main>
      </div>
    </div>
  </div>
</template>
