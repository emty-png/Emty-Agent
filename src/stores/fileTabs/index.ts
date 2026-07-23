import type { FileNode } from '@/stores/fileTree'
import type { FileDisplayType } from '@/utils/fileClassify'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { classifyFile, loadFileContent } from '@/utils/fileClassify'

// ── types ─────────────────────────────────────────────────────────────────────

export interface FileTab {
  id: string
  path: string
  name: string
  content: string | null
  displayType: FileDisplayType | null
  imageDataUrl: string | null
  loading: boolean
  error: string | null
}

let tabIdCounter = 0
function nextTabId(): string {
  return `file-tab-${++tabIdCounter}`
}

// ── store ─────────────────────────────────────────────────────────────────────

export const useFileTabsStore = defineStore('fileTabs', () => {
  const project = useProjectStore()
  const { projectPath } = storeToRefs(project)

  const tabs = ref<FileTab[]>([])
  const activeId = ref<string | null>(null)

  const activeTab = computed<FileTab | undefined>(
    () => tabs.value.find(t => t.id === activeId.value),
  )

  // ── open file ───────────────────────────────────────────────────────────────

  async function openFile(node: FileNode) {
    if (node.isDir)
      return

    // If already open, just focus it
    const existing = tabs.value.find(t => t.path === node.path)
    if (existing) {
      activeId.value = existing.id
      return
    }

    const tab: FileTab = {
      id: nextTabId(),
      path: node.path,
      name: node.name,
      content: null,
      displayType: classifyFile(node.path),
      imageDataUrl: null,
      loading: true,
      error: null,
    }

    tabs.value.push(tab)
    activeId.value = tab.id

    const live = tabs.value.find(t => t.id === tab.id)!
    try {
      const result = await loadFileContent(node.path)
      live.content = result.content
      live.imageDataUrl = result.imageDataUrl
    }
    catch (e) {
      live.error = String(e)
    }
    finally {
      live.loading = false
    }
  }

  // ── open file by path (for fuzzy finder) ────────────────────────────────────

  async function openFileByPath(filePath: string) {
    const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath

    // If already open, just focus it
    const existing = tabs.value.find(t => t.path === filePath)
    if (existing) {
      activeId.value = existing.id
      return
    }

    const tab: FileTab = {
      id: nextTabId(),
      path: filePath,
      name,
      content: null,
      displayType: classifyFile(filePath),
      imageDataUrl: null,
      loading: true,
      error: null,
    }

    tabs.value.push(tab)
    activeId.value = tab.id

    const live = tabs.value.find(t => t.id === tab.id)!
    try {
      const result = await loadFileContent(filePath)
      live.content = result.content
      live.imageDataUrl = result.imageDataUrl
    }
    catch (e) {
      live.error = String(e)
    }
    finally {
      live.loading = false
    }
  }

  // ── close tab ───────────────────────────────────────────────────────────────

  function closeTab(id: string) {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx === -1)
      return

    tabs.value.splice(idx, 1)

    if (activeId.value === id) {
      // Focus nearest neighbor
      if (tabs.value.length === 0) {
        activeId.value = null
      }
      else {
        const nextIdx = Math.min(idx, tabs.value.length - 1)
        activeId.value = tabs.value[nextIdx]!.id
      }
    }
  }

  function closeAllTabs() {
    tabs.value = []
    activeId.value = null
  }

  function closeOtherTabs(id: string) {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab)
      return
    tabs.value = [tab]
    activeId.value = tab.id
  }

  // ── set active ──────────────────────────────────────────────────────────────

  function setActive(id: string) {
    activeId.value = id
  }

  // ── refresh tab content ─────────────────────────────────────────────────────

  async function refreshTab(id: string) {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab)
      return

    tab.loading = true
    tab.error = null

    try {
      const result = await loadFileContent(tab.path)
      tab.content = result.content
      tab.imageDataUrl = result.imageDataUrl
      tab.displayType = classifyFile(tab.path)
    }
    catch (e) {
      tab.error = String(e)
    }
    finally {
      tab.loading = false
    }
  }

  // ── clear tabs when project changes ─────────────────────────────────────────

  watch(projectPath, () => {
    tabs.value = []
    activeId.value = null
  })

  return {
    tabs,
    activeId,
    activeTab,
    openFile,
    openFileByPath,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    setActive,
    refreshTab,
  }
})
