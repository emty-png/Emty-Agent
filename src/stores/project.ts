import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useProjectStore = defineStore(
  'project',
  () => {
    const projectPath = ref<string | null>(null)

    // derive the folder name from the full path — works on both / and \ separators
    const projectName = computed(() => {
      if (!projectPath.value)
        return null
      return projectPath.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
    })

    function setProject(path: string) {
      const trimmed = path.trim()
      if (trimmed.length === 0) {
        clearProject()
        return
      }
      projectPath.value = trimmed
    }

    function clearProject() {
      projectPath.value = null
    }

    return { projectPath, projectName, setProject, clearProject }
  },
  { persist: true },
)
