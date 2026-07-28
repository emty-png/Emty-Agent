import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useFileTabsStore } from '@/stores/fileTabs'
import { useFileTreeStore } from '@/stores/fileTree'

export function useFileFuzzyFinder() {
  const isOpen = ref(false)
  const query = ref('')
  const selectedIdx = ref(0)
  const allFiles = ref<string[]>([])
  const loading = ref(false)

  const fileTabs = useFileTabsStore()
  const ft = useFileTreeStore()

  // ── filtered results ────────────────────────────────────────────────────────
  const filteredFiles = ref<string[]>([])

  watch(query, q => {
    if (!q) {
      filteredFiles.value = allFiles.value.slice(0, 50)
      return
    }
    const lower = q.toLowerCase()
    filteredFiles.value = allFiles.value
      .filter(p => p.toLowerCase().includes(lower))
      .slice(0, 50)
  })

  // ── collect all file paths from tree ────────────────────────────────────────
  function collectFiles() {
    allFiles.value = ft.getAllFilePaths()
    filteredFiles.value = allFiles.value.slice(0, 50)
  }

  // ── open ────────────────────────────────────────────────────────────────────
  function open() {
    collectFiles()
    query.value = ''
    selectedIdx.value = 0
    isOpen.value = true
  }

  // ── close ───────────────────────────────────────────────────────────────────
  function close() {
    isOpen.value = false
    query.value = ''
    selectedIdx.value = 0
  }

  // ── select file ─────────────────────────────────────────────────────────────
  async function selectFile(filePath: string) {
    close()
    // Expand tree to make the file visible
    await ft.expandToPath(filePath)
    // Open in tab
    await fileTabs.openFileByPath(filePath)
  }

  // ── keyboard handling ───────────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen.value)
      return

    const total = filteredFiles.value.length

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        selectedIdx.value = total > 0 ? (selectedIdx.value - 1 + total) % total : 0
        break
      case 'ArrowDown':
        e.preventDefault()
        selectedIdx.value = total > 0 ? (selectedIdx.value + 1) % total : 0
        break
      case 'Enter':
        e.preventDefault()
        if (total > 0 && filteredFiles.value[selectedIdx.value])
          selectFile(filteredFiles.value[selectedIdx.value]!)
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
    }
  }

  // ── global Ctrl+P shortcut ──────────────────────────────────────────────────
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault()
      if (isOpen.value)
        close()
      else
        open()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeydown)
  })

  return {
    isOpen,
    query,
    selectedIdx,
    filteredFiles,
    loading,
    handleKeydown,
    close,
    selectFile,
  }
}
