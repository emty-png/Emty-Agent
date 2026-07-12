<script setup lang="ts">
/**
 * AtMentionDropdown.vue
 *
 * The file-picker panel that appears above the chat input when the user types "@".
 * Appears as a detached, floating panel above the chat input shell.
 */

import type { Component } from 'vue'
import type { FsEntry } from '@/composables/useAtMention'
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  FolderArchive,
  FolderCode,
  FolderGit2,
  FolderOpen,
  FolderSearch,
  Settings,
  X,
} from 'lucide-vue-next'
import { computed, ref, watchEffect } from 'vue'
import { highlightParts } from '@/utils/highlightParts'
import { getDeviconForFile } from '@/utils/icons'

const props = defineProps<{
  entries: FsEntry[]
  selectedIdx: number
  loading: boolean
  query: string
}>()

const emit = defineEmits<{
  select: [entry: FsEntry]
  hover: [idx: number]
  close: []
}>()

// ── icon logic migrated from FileTree ─────────────────────────────────────────

interface FileStyle { icon: Component; color: string }

const EXT_STYLE: Record<string, FileStyle> = {
  ts: { icon: FileCode, color: 'var(--color-info-text)' },
  tsx: { icon: FileCode, color: 'var(--color-info-text)' },
  js: { icon: FileCode, color: 'var(--color-warning-text)' },
  jsx: { icon: FileCode, color: 'var(--color-warning-text)' },
  vue: { icon: FileCode, color: 'var(--color-success-text)' },
  css: { icon: FileCode, color: 'var(--color-info)' },
  scss: { icon: FileCode, color: 'var(--color-info)' },
  json: { icon: FileJson, color: 'var(--color-warning-text)' },
  jsonc: { icon: FileJson, color: 'var(--color-warning-text)' },
  yaml: { icon: FileJson, color: 'var(--color-accent-bright)' },
  yml: { icon: FileJson, color: 'var(--color-accent-bright)' },
  toml: { icon: FileJson, color: 'var(--color-accent-bright)' },
  html: { icon: FileCode, color: 'var(--color-accent-bright)' },
  md: { icon: FileText, color: 'var(--color-text-primary)' },
  mdx: { icon: FileText, color: 'var(--color-text-primary)' },
  rs: { icon: FileCode, color: 'var(--color-accent)' },
  py: { icon: FileCode, color: 'var(--color-success-text)' },
  env: { icon: Settings, color: 'var(--color-danger-text)' },
  lock: { icon: Settings, color: 'var(--color-text-dim)' },
  png: { icon: FileImage, color: 'var(--color-accent-text)' },
  jpg: { icon: FileImage, color: 'var(--color-accent-text)' },
  jpeg: { icon: FileImage, color: 'var(--color-accent-text)' },
  gif: { icon: FileImage, color: 'var(--color-accent-text)' },
  webp: { icon: FileImage, color: 'var(--color-accent-text)' },
  svg: { icon: FileImage, color: 'var(--color-warning)' },
  ico: { icon: FileImage, color: 'var(--color-warning)' },
  mp4: { icon: FileVideo, color: 'var(--color-info)' },
  mov: { icon: FileVideo, color: 'var(--color-info)' },
  mp3: { icon: FileVideo, color: 'var(--color-info)' },
  wav: { icon: FileVideo, color: 'var(--color-info)' },
  zip: { icon: FileArchive, color: 'var(--color-text-tertiary)' },
  gz: { icon: FileArchive, color: 'var(--color-text-tertiary)' },
  tar: { icon: FileArchive, color: 'var(--color-text-tertiary)' },
  rar: { icon: FileArchive, color: 'var(--color-text-tertiary)' },
  '7z': { icon: FileArchive, color: 'var(--color-text-tertiary)' },
}

function folderStyle(name: string, expanded: boolean): { icon: Component; color: string } {
  const n = name.toLowerCase()
  let icon = expanded ? FolderOpen : Folder
  let color = 'var(--color-warning-text)'
  if (['src', 'lib', 'source'].includes(n)) {
    icon = FolderCode; color = 'var(--color-success-text)'
  }
  else if (['public', 'static', 'assets', 'images', 'img'].includes(n)) {
    icon = FolderSearch; color = 'var(--color-info-text)'
  }
  else if (['node_modules', 'vendor', 'deps'].includes(n)) {
    icon = FolderArchive; color = 'var(--color-danger-text)'
  }
  else if (['dist', 'build', 'out', 'target', 'bin'].includes(n)) {
    icon = FolderArchive; color = 'var(--color-text-tertiary)'
  }
  else if (['.git', '.github', '.gitlab'].includes(n)) {
    icon = FolderGit2; color = 'var(--color-accent-bright)'
  }
  else if (['.vscode', '.idea', '.config', 'config'].includes(n)) {
    icon = Settings; color = 'var(--color-text-primary)'
  }
  else if (['tests', 'test', '__tests__', 'spec'].includes(n)) {
    icon = FolderSearch; color = 'var(--color-success-text)'
  }
  return { icon, color }
}

function fileStyle(name: string): FileStyle {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_STYLE[ext] ?? { icon: File, color: 'var(--color-text-tertiary)' }
}

function getFilename(path: string) {
  return path.split('/').pop() || path
}

interface EntryDisplay {
  entry: FsEntry
  name: string
  icon: Component
  color: string
  isDir: boolean
  devicon: string | null
}

function buildEntryDisplay(entry: FsEntry): EntryDisplay {
  const name = getFilename(entry.path)
  if (entry.isDir) {
    const style = folderStyle(name, false)
    return { entry, name, icon: style.icon, color: style.color, isDir: true, devicon: null }
  }
  const devicon = getDeviconForFile(name)
  const style = fileStyle(name)
  return { entry, name, icon: style.icon, color: style.color, isDir: false, devicon }
}

// ── pre-computed display list ───────────────────────────────────────────────
const displays = computed(() => props.entries.map(buildEntryDisplay))

// ── auto-scroll selected item into view ───────────────────────────────────────

const listRef = ref<HTMLElement | null>(null)

watchEffect(() => {
  const idx = props.selectedIdx
  const child = listRef.value?.children[idx] as HTMLElement | undefined
  child?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
})

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const rootClasses = 'w-full mb-2 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) flex flex-col overflow-hidden max-h-80'

const headerClasses = 'flex items-center gap-2 py-2.5 pr-3 pl-3.5 border-b border-(--color-border-mid) shrink-0'
const headerTitleClasses = 'text-[11px] font-semibold tracking-[0.04em] uppercase text-(--color-text-tertiary) flex-1'
const queryChipClasses = 'text-[11px] font-semibold font-[ui-monospace,SF_Mono,Menlo,monospace] text-(--color-accent-text) bg-(--color-accent-muted-plus) border border-(--color-accent-dim) rounded-(--radius-xs) py-px px-1.5 max-w-[200px] truncate'
const closeBtnClasses = 'grid place-items-center w-[22px] h-[22px] border-none rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) cursor-pointer shrink-0 transition-[background,color] duration-100 ease-[ease] hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)'

const stateClasses = 'flex items-center justify-center h-[52px] px-4'
const stateTextClasses = 'text-[12.5px] text-(--color-text-tertiary) [&_strong]:text-(--color-text-secondary) [&_strong]:font-semibold'

const listClasses = 'overflow-y-auto p-1.5 min-h-0 flex flex-col gap-0.5'

function getEntryClasses(selected: boolean): string {
  const base = 'flex items-center gap-2 w-full h-[34px] min-h-[34px] px-2.5 border-none rounded-(--radius-md) cursor-pointer text-left transition-colors duration-[70ms] ease'
  return selected
    ? `${base} bg-(--color-state-hover)`
    : `${base} bg-transparent hover:bg-(--color-state-hover)`
}

const iconClasses = 'shrink-0 flex justify-center items-center'

function getPathClasses(selected: boolean): string {
  const base = 'flex-1 text-[12.5px] font-[ui-monospace,SF_Mono,Menlo,monospace] truncate transition-colors duration-[70ms] ease-[ease]'
  const color = selected ? 'text-(--color-text-primary)' : 'text-(--color-text-secondary)'
  return `${base} ${color}`
}

const pathMatchClasses = 'text-(--color-accent-text) font-semibold'

const dirBadgeClasses = 'text-[9.5px] font-bold tracking-[0.05em] uppercase text-(--color-warning-text) bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] rounded-(--radius-xs) py-px px-1 shrink-0'
</script>

<template>
  <div :class="rootClasses" role="listbox" aria-label="Link a file or folder">
    <div :class="headerClasses">
      <span :class="headerTitleClasses">Link file or folder</span>
      <span v-if="query" :class="queryChipClasses">@{{ query }}</span>
      <button :class="closeBtnClasses" aria-label="Close file picker" @click="emit('close')">
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <div v-if="loading" :class="stateClasses">
      <span :class="stateTextClasses">Loading project files…</span>
    </div>
    <div v-else-if="entries.length === 0 && !query" :class="stateClasses">
      <span :class="stateTextClasses">Open a project to link files</span>
    </div>
    <div v-else-if="entries.length === 0" :class="stateClasses">
      <span :class="stateTextClasses">No matches for "<strong>{{ query }}</strong>"</span>
    </div>

    <div v-else ref="listRef" :class="listClasses" role="presentation">
      <button
        v-for="(display, idx) in displays"
        :key="display.entry.path"
        :class="getEntryClasses(idx === selectedIdx)"
        role="option"
        :aria-selected="idx === selectedIdx"
        @click="emit('select', display.entry)"
        @mouseenter="emit('hover', idx)"
      >
        <!-- Icon -->
        <i
          v-if="display.devicon"
          :class="[iconClasses, display.devicon]"
          :style="{ fontSize: '13px', color: display.color }"
          aria-hidden="true"
        />
        <component
          :is="display.icon"
          v-else
          :size="13"
          :stroke-width="1.6"
          :class="iconClasses"
          :style="{ color: display.color }"
          aria-hidden="true"
        />

        <!-- Path with match highlighting -->
        <span :class="getPathClasses(idx === selectedIdx)">
          <template v-for="part in highlightParts(display.entry.path, query)" :key="part.text + String(part.match)">
            <span v-if="part.match" :class="pathMatchClasses">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>

        <span v-if="display.isDir" :class="dirBadgeClasses">dir</span>
      </button>
    </div>
  </div>
</template>
