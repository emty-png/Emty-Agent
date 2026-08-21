<script setup lang="ts">
import type { ToolEvent } from '@/stores/chat'
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useGitPaneStore } from '@/stores/gitPane'

const props = defineProps<{
  events: ToolEvent[]
}>()

interface FileChip {
  filePath: string
  fileName: string
  dirPrefix: string
  added: number
  removed: number
  diff: string
}

const COLLAPSED_LIMIT = 6
const showAll = ref(false)
const chatStore = useChatStore()
const gitPaneStore = useGitPaneStore()

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}

function dirPart(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length <= 1)
    return ''
  return `${parts.slice(0, -1).join('/')}/`
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function numVal(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function strVal(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const fileChips = computed<FileChip[]>(() => {
  const chipMap = new Map<string, FileChip>()

  function accumulate(filePath: string, added: number, removed: number, diff: string) {
    const existing = chipMap.get(filePath)
    if (existing) {
      existing.added += added
      existing.removed += removed
      if (diff)
        existing.diff = existing.diff ? `${existing.diff}\n${diff}` : diff
    }
    else {
      chipMap.set(filePath, {
        filePath,
        fileName: basename(filePath),
        dirPrefix: dirPart(filePath),
        added,
        removed,
        diff,
      })
    }
  }

  for (const event of props.events) {
    if (event.toolName !== 'edit_files' && event.toolName !== 'write_file')
      continue
    if (event.status !== 'done')
      continue

    const result = objectValue(event.result)
    if (!result)
      continue

    if (event.toolName === 'write_file') {
      const filePath = strVal(result.file)
      if (!filePath)
        continue
      accumulate(filePath, numVal(result.added), numVal(result.removed), strVal(result.diff))
    }
    else if (event.toolName === 'edit_files') {
      const files = Array.isArray(result.files) ? result.files : []
      for (const f of files) {
        const record = objectValue(f)
        if (!record)
          continue
        const filePath = strVal(record.file)
        if (!filePath || record.status !== 'success')
          continue
        accumulate(filePath, numVal(record.added), numVal(record.removed), strVal(record.diff))
      }
    }
  }

  return Array.from(chipMap.values())
})

const visibleChips = computed(() => {
  if (showAll.value || fileChips.value.length <= COLLAPSED_LIMIT)
    return fileChips.value
  return fileChips.value.slice(0, COLLAPSED_LIMIT)
})

const hasMore = computed(() => !showAll.value && fileChips.value.length > COLLAPSED_LIMIT)

function openDiff(chip: FileChip) {
  const tabId = chatStore.activeId
  gitPaneStore.openDiffViewer(tabId, {
    filePath: chip.filePath,
    diff: chip.diff,
    added: chip.added,
    removed: chip.removed,
  })
  window.dispatchEvent(new CustomEvent('emty:open-diff-viewer', {
    detail: {
      tabId,
      filePath: chip.filePath,
      diff: chip.diff,
      added: chip.added,
      removed: chip.removed,
    },
  }))
}
</script>

<template>
  <div v-if="fileChips.length > 0" class="flex flex-wrap items-center gap-1.5">
    <button
      v-for="chip in visibleChips"
      :key="chip.filePath"
      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[11px] font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace] cursor-pointer transition-all duration-100 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-state-hover)] max-w-[240px]"
      :title="chip.filePath"
      @click="openDiff(chip)"
    >
      <span class="text-[var(--color-text-secondary)] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{{ chip.fileName }}</span>
      <span v-if="chip.dirPrefix" class="text-[var(--color-text-dim)] text-[10px] overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0">{{ chip.dirPrefix }}</span>
      <span v-if="chip.added > 0" class="text-[var(--color-success)] shrink-0 text-[10px] font-semibold">+{{ chip.added }}</span>
      <span v-if="chip.removed > 0" class="text-[var(--color-danger)] shrink-0 text-[10px] font-semibold">-{{ chip.removed }}</span>
    </button>
    <button
      v-if="hasMore"
      class="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-transparent text-[11px] text-[var(--color-text-dim)] cursor-pointer transition-all duration-100 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)]"
      @click="showAll = true"
    >
      +{{ fileChips.length - COLLAPSED_LIMIT }} more
    </button>
  </div>
</template>
