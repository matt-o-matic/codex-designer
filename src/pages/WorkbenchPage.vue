<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useAppState } from '../lib/appState'
import { useWorkbenchUi } from '../lib/workbenchUi'
import SessionWorkbench from '../components/SessionWorkbench.vue'
import WorkspaceSheet from '../components/WorkspaceSheet.vue'

const { appState, activeWorkspace, loading, error, refreshAppState, openWorkspace } = useAppState()
const { selectedSessionSlug } = useWorkbenchUi()

const recent = computed(() => appState.value?.recentWorkspacePaths ?? [])

async function chooseWorkspace() {
  const picked = await window.codexDesigner?.pickWorkspace?.()
  if (!picked) return
  await openWorkspace(picked)
}

onMounted(() => {
  void refreshAppState()
})

watch(
  () => appState.value?.activeWorkspacePath ?? null,
  (p) => {
    if (!p) return
    if (activeWorkspace.value?.path === p) return
    void openWorkspace(p)
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-full w-full flex-col space-y-4">
    <div
      v-if="error"
      class="shrink-0 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
    >
      {{ error }}
    </div>

    <div
      v-if="!activeWorkspace"
      class="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-rounded text-[22px] text-brand-500">folder_open</span>
        <div class="min-w-0">
          <h2 class="text-lg font-black tracking-tight">Pick a workspace</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Select a repo folder to load feature sessions from `docs/*.plan.md`.
          </p>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button
          class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
          type="button"
          :disabled="loading"
          @click="chooseWorkspace"
        >
          <span class="material-symbols-rounded text-[18px]">drive_folder_upload</span>
          Pick workspace
        </button>
      </div>

      <div class="mt-6">
        <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">Recent workspaces</div>

        <div v-if="!recent.length" class="mt-3 rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
          No recent workspaces yet.
        </div>

        <div v-else class="mt-3 grid gap-2">
          <button
            v-for="p in recent"
            :key="p"
            class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
            type="button"
            :disabled="loading"
            @click="openWorkspace(p)"
          >
            <span class="truncate font-mono text-xs">{{ p }}</span>
            <span class="material-symbols-rounded text-[18px] text-gray-400">chevron_right</span>
          </button>
        </div>
      </div>
    </div>

    <div
      v-else-if="!selectedSessionSlug"
      class="my-auto flex w-full flex-col items-center justify-center p-12 text-center"
      style="background: linear-gradient(90deg, #0000 00%, #000 40%, #000 60%, #0000); max-height: 420px;"
    >
      <div class="space-y-2">
        <h2 class="text-2xl font-black tracking-tight text-white shadow-black drop-shadow-md">Select a session</h2>
        <p class="text-lg text-gray-200 shadow-black drop-shadow-sm">
          Choose a feature or start something new.
        </p>
      </div>

      <div class="mt-12 flex flex-col items-center">
        <img src="/icon.png" alt="Codex Designer" class="h-48 w-48 drop-shadow-2xl transition-all duration-700 hover:scale-105" />
        <div class="mt-4 font-mono text-xs font-bold tracking-[0.2em] text-gray-400">CODEX DESIGNER</div>
      </div>
    </div>

    <!-- Ensure full height / proper layout for SessionWorkbench -->
    <div
      v-else
      class="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <SessionWorkbench
        :workspace-path="activeWorkspace.path"
        :feature-slug="selectedSessionSlug"
      />
    </div>
  </div>

  <!-- WorkspaceSheet handles its own visibility/modal -->
  <WorkspaceSheet />
</template>
