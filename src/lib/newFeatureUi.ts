import { ref } from 'vue'

const newFeatureOpen = ref(false)
const newFeatureWorkspacePath = ref<string | null>(null)

export function useNewFeatureUi() {
  function openNewFeature(workspacePath: string) {
    const p = String(workspacePath ?? '').trim()
    if (!p) return
    newFeatureWorkspacePath.value = p
    newFeatureOpen.value = true
  }

  function closeNewFeature() {
    newFeatureOpen.value = false
    newFeatureWorkspacePath.value = null
  }

  return {
    newFeatureOpen,
    newFeatureWorkspacePath,
    openNewFeature,
    closeNewFeature,
  }
}

