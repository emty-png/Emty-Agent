import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useProjectStore = defineStore(
  'project',
  () => {
    const projectPath = ref<string | null>(null)
    const openProjects = ref<string[]>([])
    /** Paths that were opened via the design canvas "show code" action (read-only intent). */
    const designProjects = ref<string[]>([])
    const splitPercent = ref(30)

    // derive the folder name from the full path — works on both / and \ separators
    const projectName = computed(() => {
      if (!projectPath.value)
        return null
      return (
        projectPath.value
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .pop() ?? null
      )
    })

    const isDesignProject = computed(() => {
      if (!projectPath.value)
        return false
      return designProjects.value.includes(projectPath.value)
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

    function addProject(path: string, isDesign = false) {
      const trimmed = path.trim()
      if (!trimmed)
        return
      // normalize: remove trailing separators
      const normalized = trimmed.replace(/[/\\]+$/, '')
      if (!openProjects.value.includes(normalized))
        openProjects.value.push(normalized)
      if (isDesign && !designProjects.value.includes(normalized))
        designProjects.value.push(normalized)
      setProject(normalized)
    }

    function removeProject(path: string) {
      const normalized = path.trim().replace(/[/\\]+$/, '')
      openProjects.value = openProjects.value.filter(p => p !== normalized)
      designProjects.value = designProjects.value.filter(p => p !== normalized)
      if (projectPath.value === normalized)
        projectPath.value = openProjects.value[openProjects.value.length - 1] ?? null
    }

    return { projectPath, openProjects, designProjects, projectName, isDesignProject, splitPercent, setProject, clearProject, addProject, removeProject }
  },
  { persist: true },
)
