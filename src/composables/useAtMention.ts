import type { Ref } from 'vue'
import type { ChatTab } from '@/stores/chat/types'
import { readDir } from '@tauri-apps/plugin-fs'
import { computed, nextTick, ref, watch } from 'vue'
import { CHIP_PADDING, packMention } from '@/utils/mentionFormat'

// ── constants ─────────────────────────────────────────────────────────────────

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

const MAX_DEPTH = 5
const MAX_ENTRIES = 500
const MAX_VISIBLE = 60
const AT_PATTERN = /@([\w./\-]*)$/

// ── types ─────────────────────────────────────────────────────────────────────

export interface FsEntry {
  path: string
  name: string
  isDir: boolean
  depth: number
  kind?: string
}

export type MentionProvider = (tab: ChatTab, projectPath: string | null) => Promise<FsEntry[]> | FsEntry[]

// ── Mention Providers ─────────────────────────────────────────────────────────

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
      kind: 'file',
    })
    if (isDir && depth < MAX_DEPTH) {
      await traverseDir(`${absPath}/${item.name}`, relItemPath, depth + 1, out)
    }
  }
}

let fsCache: { path: string; entries: FsEntry[] } | null = null

export const fileSystemMentionProvider: MentionProvider = async (tab, projectPath) => {
  if (tab.mode === 'design')
    return []
  if (!projectPath)
    return []

  if (fsCache?.path === projectPath) {
    return fsCache.entries
  }

  const entries: FsEntry[] = []
  await traverseDir(projectPath, '', 0, entries)
  entries.sort((a, b) => {
    if (a.depth !== b.depth)
      return a.depth - b.depth
    if (a.isDir !== b.isDir)
      return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  fsCache = { path: projectPath, entries }
  return entries
}

export const designMentionProvider: MentionProvider = tab => {
  if (tab.mode !== 'design')
    return []
  const designs = tab.designs ?? []
  return designs.map(d => ({
    path: d.id,
    name: d.name,
    isDir: false,
    depth: 0,
    kind: 'design',
  }))
}

export const imageMentionProvider: MentionProvider = async (tab, projectPath) => {
  // Always provide images, they are useful in many modes (UI design, etc).
  // We can just filter the filesystem cache for images.
  if (!projectPath)
    return []

  let allFiles: FsEntry[] = []
  if (fsCache?.path === projectPath) {
    allFiles = fsCache.entries
  }
  else {
    // Ideally we don't want to traverse again if not cached, but we can call the file provider
    allFiles = await fileSystemMentionProvider(tab, projectPath)
  }

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'])
  return allFiles.filter(e => {
    if (e.isDir)
      return false
    const extMatch = e.name.match(/\.[a-z0-9]+$/i)
    if (!extMatch)
      return false
    return imageExts.has(extMatch[0].toLowerCase())
  }).map(e => ({ ...e, kind: 'image' }))
}

const defaultMentionProviders = [fileSystemMentionProvider, designMentionProvider, imageMentionProvider]

// ── composable ────────────────────────────────────────────────────────────────

export function useAtMention(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  text: Ref<string>,
  projectPath: Ref<string | null>,
  tab: Ref<ChatTab>,
  providers: MentionProvider[] = defaultMentionProviders,
) {
  const isOpen = ref(false)
  const atStart = ref(-1)
  const atQuery = ref('')
  const selectedIdx = ref(0)
  const allEntries = ref<FsEntry[]>([])
  const loading = ref(false)

  // ── cache invalidation ──────────────────────────────────────────────────────

  watch(projectPath, () => {
    // Let providers handle caching, but reset local state
    allEntries.value = []
    close()
  })

  // ── file tree loading ───────────────────────────────────────────────────────

  async function loadEntries(): Promise<void> {
    loading.value = true
    try {
      const results = await Promise.all(providers.map(p => p(tab.value, projectPath.value)))

      // Deduplicate by path (image provider returns some of the same files as file provider)
      // We prioritize the ones that are specifically categorized if needed, but here simple map dedup works
      const dedupMap = new Map<string, FsEntry>()

      // We put the results in order, so if image provider is last, it might override the kind to 'image'.
      // That's actually desirable if we want to show a badge for it.
      for (const entries of results) {
        for (const entry of entries) {
          dedupMap.set(entry.path, entry)
        }
      }

      const combined = Array.from(dedupMap.values())

      // Re-sort the combined list
      combined.sort((a, b) => {
        if (a.depth !== b.depth)
          return a.depth - b.depth
        if (a.isDir !== b.isDir)
          return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      allEntries.value = combined
    }
    catch { /* ignore */ }
    finally {
      loading.value = false
    }
  }

  // ── filtered list ───────────────────────────────────────────────────────────

  const filteredEntries = computed<FsEntry[]>(() => {
    const q = atQuery.value.toLowerCase()
    if (!q) {
      return allEntries.value.filter(e => e.depth === 0).slice(0, MAX_VISIBLE)
    }
    return allEntries.value
      .filter(e => e.path.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE)
  })

  // ── @ detection ─────────────────────────────────────────────────────────────

  function detectAt(el: HTMLTextAreaElement): void {
    if (tab.value.mode === 'design') {
      close()
      return
    }
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

  function handleInput(e: Event): void {
    detectAt(e.target as HTMLTextAreaElement)
  }

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

  function setSelectedIdx(idx: number): void {
    selectedIdx.value = idx
  }

  // ── selection ───────────────────────────────────────────────────────────────

  function selectEntry(entry: FsEntry): void {
    const mention = packMention(entry.path)
    const before = text.value.slice(0, atStart.value)
    const queryEnd = atStart.value + 1 + atQuery.value.length
    const after = text.value.slice(queryEnd)

    text.value = `${before}${CHIP_PADDING}${mention}${CHIP_PADDING}${after}`
    close()

    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      const pos = before.length + CHIP_PADDING.length + mention.length + CHIP_PADDING.length
      el.setSelectionRange(pos, pos)
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    })
  }

  function removeQuery(): void {
    const before = text.value.slice(0, atStart.value)
    const queryEnd = atStart.value + 1 + atQuery.value.length
    const after = text.value.slice(queryEnd)

    text.value = `${before}${after}`
    close()

    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      el.setSelectionRange(before.length, before.length)
      el.focus()
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
    removeQuery,
    close,
  }
}
