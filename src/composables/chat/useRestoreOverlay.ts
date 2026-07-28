import type { Checkpoint } from '@/stores/checkpoints'
import { diffLines } from 'diff'
import { ref } from 'vue'
import { dbLoadCheckpointFiles } from '@/db/database'
import { useChatStore } from '@/stores/chat'
import { useCheckpointStore } from '@/stores/checkpoints'
import { readTextFile } from '@/utils/tauriFs'

export type RestoreMode = 'full' | 'conversation' | 'files'

export interface FileDiff {
  relativePath: string
  absolutePath: string
  existed: number
  addedCount: number
  removedCount: number
  lines: { type: 'added' | 'removed' | 'normal'; content: string }[]
}

export function useRestoreOverlay() {
  const isOpen = ref(false)
  const checkpoints = ref<Checkpoint[]>([])
  const loading = ref(false)
  const expandedId = ref<string | null>(null)
  const fileDiffs = ref<FileDiff[]>([])
  const loadingDiffs = ref(false)
  const selectedMode = ref<RestoreMode>('full')

  const chat = useChatStore()

  async function open() {
    isOpen.value = true
    expandedId.value = null
    fileDiffs.value = []
    selectedMode.value = 'full'
    loading.value = true

    try {
      const cpStore = useCheckpointStore()
      checkpoints.value = cpStore.getCheckpoints(chat.activeId)
    }
    catch {
      checkpoints.value = []
    }
    finally {
      loading.value = false
    }
  }

  function close() {
    isOpen.value = false
    expandedId.value = null
    fileDiffs.value = []
  }

  async function toggleCheckpoint(id: string) {
    if (expandedId.value === id) {
      expandedId.value = null
      fileDiffs.value = []
      return
    }

    expandedId.value = id
    loadingDiffs.value = true
    fileDiffs.value = []

    try {
      const rows = await dbLoadCheckpointFiles(id)
      const results: FileDiff[] = []

      for (const row of rows) {
        const snapshotContent = row.content ?? ''
        let currentContent = ''

        try {
          currentContent = await readTextFile(row.absolute_path)
        }
        catch {
          currentContent = ''
        }

        const changes = diffLines(snapshotContent, currentContent)
        let addedCount = 0
        let removedCount = 0
        const lines: FileDiff['lines'] = []

        for (const part of changes) {
          const partLines = part.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '')
          for (const line of partLines) {
            if (part.added) {
              addedCount++
              lines.push({ type: 'added', content: line })
            }
            else if (part.removed) {
              removedCount++
              lines.push({ type: 'removed', content: line })
            }
            else {
              lines.push({ type: 'normal', content: line })
            }
          }
        }

        results.push({
          relativePath: row.relative_path,
          absolutePath: row.absolute_path,
          existed: row.existed,
          addedCount,
          removedCount,
          lines,
        })
      }

      fileDiffs.value = results
    }
    catch (e) {
      console.warn('[restore-overlay] Failed to load diffs:', e)
    }
    finally {
      loadingDiffs.value = false
    }
  }

  async function restore(id: string) {
    await chat.restoreToCheckpoint(chat.activeId, id, selectedMode.value)
    close()
  }

  function setMode(mode: RestoreMode) {
    selectedMode.value = mode
  }

  return {
    isOpen,
    checkpoints,
    loading,
    expandedId,
    fileDiffs,
    loadingDiffs,
    selectedMode,
    open,
    close,
    toggleCheckpoint,
    restore,
    setMode,
  }
}
