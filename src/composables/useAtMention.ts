/**
 * src/composables/useAtMention.ts
 *
 * Composable that drives the @ file-mention system in the chat input.
 *
 * Responsibilities:
 *   • Detect when the user types "@" in the textarea and extract the current
 *     query (text typed after "@" up to the cursor position).
 *   • Lazily load the project file tree once per project path (cached).
 *   • Filter entries against the current query.
 *   • Handle keyboard navigation (↑↓ Enter Tab Esc) — returns true when the
 *     event was consumed so the caller can skip default handling (e.g. submit).
 *   • Insert the selected path into the textarea, replacing the "@<query>"
 *     token, and restore the cursor.
 *
 * Security: the file tree is loaded read-only via Tauri's readDir. No paths
 * are allowed outside the project directory (the same sandbox as filesystem.ts).
 */

import type { Ref } from 'vue'
import { readDir } from '@tauri-apps/plugin-fs'
import { computed, nextTick, ref, watch } from 'vue'
import { CHIP_PADDING, packMention } from '@/utils/mentionFormat'

// ── constants ─────────────────────────────────────────────────────────────────

/** Same skip set as filesystem.ts — kept in sync manually. */
const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'target',
  '.cargo',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  'tmp',
  '.tmp',
  'temp',
  '.turbo',
  '.vercel',
])

/** How deep to recurse when building the file tree. */
const MAX_DEPTH = 5

/** Hard cap on total entries to avoid memory / UI pressure. */
const MAX_ENTRIES = 500

/** How many filtered results to expose to the dropdown. */
const MAX_VISIBLE = 60

/**
 * Matches "@" or "@[" followed by zero or more path-legal chars at the END of a string.
 * Path chars: word chars (a-z A-Z 0-9 _), dot, forward slash, hyphen.
 * The capture group is the query text after "@" or "@[".
 */
const AT_PATTERN = /@([\w./\-]*)$/

// ── types ─────────────────────────────────────────────────────────────────────

export interface FsEntry {
  /** Relative path from project root. Directories end with "/". */
  path: string
  /** Just the filename or dirname (no trailing slash). */
  name: string
  isDir: boolean
  /** Distance from root — used for sort ordering. */
  depth: number
}

// ── composable ────────────────────────────────────────────────────────────────

export function useAtMention(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  text: Ref<string>,
  projectPath: Ref<string | null>,
) {
  // ── reactive state ──────────────────────────────────────────────────────────

  const isOpen = ref(false)

  /** Character index of the "@" symbol in text.value. */
  const atStart = ref(-1)

  /** Text typed after "@" or "@[", up to the cursor. */
  const atQuery = ref('')

  /** Keyboard-nav cursor within filteredEntries. */
  const selectedIdx = ref(0)

  const allEntries = ref<FsEntry[]>([])
  const loading = ref(false)

  /** The projectPath for which allEntries was last loaded. */
  const loadedForPath = ref<string | null>(null)

  // ── cache invalidation ──────────────────────────────────────────────────────

  watch(projectPath, newPath => {
    if (newPath !== loadedForPath.value) {
      allEntries.value = []
      loadedForPath.value = null
    }
    close()
  })

  // ── file tree loading ───────────────────────────────────────────────────────

  async function traverseDir(
    absPath: string,
    relPath: string,
    depth: number,
    out: FsEntry[],
  ): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES)
      return
    let items: Awaited<ReturnType<typeof readDir>>
    try {
      items = await readDir(absPath)
    }
    catch {
      return
    }
    for (const item of items) {
      if (!item.name)
        continue
      if (ALWAYS_SKIP.has(item.name))
        continue
      if (item.name.startsWith('.'))
        continue
      if (out.length >= MAX_ENTRIES)
        break
      const isDir = item.isDirectory ?? false
      const relItemPath = relPath ? `${relPath}/${item.name}` : item.name
      out.push({
        path: isDir ? `${relItemPath}/` : relItemPath,
        name: item.name,
        isDir,
        depth,
      })
      if (isDir && depth < MAX_DEPTH) {
        await traverseDir(`${absPath}/${item.name}`, relItemPath, depth + 1, out)
      }
    }
  }

  async function loadEntries(): Promise<void> {
    const path = projectPath.value
    if (!path || loadedForPath.value === path)
      return
    loading.value = true
    try {
      const entries: FsEntry[] = []
      await traverseDir(path, '', 0, entries)
      // Primary sort: depth ascending so shallow entries appear first.
      // Secondary: directories before files.
      // Tertiary: alphabetical by name.
      entries.sort((a, b) => {
        if (a.depth !== b.depth)
          return a.depth - b.depth
        if (a.isDir !== b.isDir)
          return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      allEntries.value = entries
      loadedForPath.value = path
    }
    catch { /* ignore — empty list is safe */ }
    finally {
      loading.value = false
    }
  }

  // ── filtered list ───────────────────────────────────────────────────────────

  const filteredEntries = computed<FsEntry[]>(() => {
    const q = atQuery.value.toLowerCase()
    if (!q) {
      // No query: show root-level entries only (depth === 0)
      return allEntries.value.filter(e => e.depth === 0).slice(0, MAX_VISIBLE)
    }
    return allEntries.value
      .filter(e => e.path.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE)
  })

  // ── @ detection ─────────────────────────────────────────────────────────────

  function detectAt(el: HTMLTextAreaElement): void {
    if (!projectPath.value) {
      close()
      return
    }
    const cursor = el.selectionStart ?? 0
    const before = text.value.slice(0, cursor)
    const match = AT_PATTERN.exec(before)
    if (match) {
      atStart.value = cursor - match[0].length
      atQuery.value = match[1] ?? ''
      selectedIdx.value = 0
      if (!isOpen.value) {
        isOpen.value = true
        loadEntries()
      }
    }
    else {
      close()
    }
  }

  // ── event handlers ──────────────────────────────────────────────────────────

  /** Call this from the textarea's @input handler. */
  function handleInput(e: Event): void {
    detectAt(e.target as HTMLTextAreaElement)
  }

  /**
   * Call this from the textarea's @keydown handler BEFORE the default handler.
   * Returns true if the event was fully consumed — caller should skip its own logic.
   */
  function handleKeydown(e: KeyboardEvent): boolean {
    if (!isOpen.value)
      return false
    const total = filteredEntries.value.length

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        selectedIdx.value = total > 0
          ? (selectedIdx.value - 1 + total) % total
          : 0
        return true

      case 'ArrowDown':
        e.preventDefault()
        selectedIdx.value = total > 0
          ? (selectedIdx.value + 1) % total
          : 0
        return true

      case 'Enter':
      case 'Tab': {
        e.preventDefault()
        const entry = filteredEntries.value[selectedIdx.value]
        if (entry)
          selectEntry(entry)
        return true
      }

      case 'Escape':
        e.preventDefault()
        close()
        return true
    }
    return false
  }

  /** Set the keyboard cursor index (called on mouse-enter in the dropdown). */
  function setSelectedIdx(idx: number): void {
    selectedIdx.value = idx
  }

  // ── selection ───────────────────────────────────────────────────────────────

  /** Replace the @<query> token in the textarea with the chosen path. */
  function selectEntry(entry: FsEntry): void {
    // ZWSP-wrapped so the underlying text has zero extra rendered width.
    // The backdrop chip displays the same inner text — no ghost spacing.
    const mention = packMention(entry.path)

    // Text before "@", text after the query (right of cursor)
    const before = text.value.slice(0, atStart.value)
    const queryEnd = atStart.value + 1 + atQuery.value.length // +1 for '@'
    const after = text.value.slice(queryEnd)

    // Add physical spaces of padding around the chip
    // The chatInputTokens.ts parser explicitly absorbs this padding into the token bounds
    // so they are deleted atomically alongside the chip.
    text.value = `${before}${CHIP_PADDING}${mention}${CHIP_PADDING}${after}`

    close()

    // Restore cursor to just after the inserted mention + space.
    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      const pos = before.length + CHIP_PADDING.length + mention.length + CHIP_PADDING.length
      el.setSelectionRange(pos, pos)
      el.focus()
      // Recalculate height in case text grew or shrunk.
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    })
  }

  // ── close ───────────────────────────────────────────────────────────────────

  function close(): void {
    isOpen.value = false
    atStart.value = -1
    atQuery.value = ''
  }

  // ── public API ──────────────────────────────────────────────────────────────

  return {
    isOpen,
    atQuery,
    filteredEntries,
    selectedIdx,
    loading,
    handleInput,
    handleKeydown,
    setSelectedIdx,
    selectEntry,
    close,
  }
}
