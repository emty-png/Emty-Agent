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
import { ref, watchEffect } from 'vue'
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

// ── highlight helper ──────────────────────────────────────────────────────────

interface Part { text: string; match: boolean }

function highlightParts(path: string, query: string): Part[] {
  if (!query)
    return [{ text: path, match: false }]
  const lower = path.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1)
    return [{ text: path, match: false }]
  return [
    { text: path.slice(0, idx), match: false },
    { text: path.slice(idx, idx + query.length), match: true },
    { text: path.slice(idx + query.length), match: false },
  ].filter(p => p.text.length > 0)
}

// ── auto-scroll selected item into view ───────────────────────────────────────

const listRef = ref<HTMLElement | null>(null)

watchEffect(() => {
  const idx = props.selectedIdx
  const child = listRef.value?.children[idx] as HTMLElement | undefined
  child?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
})
</script>

<template>
  <div class="at-overlay" role="listbox" aria-label="Link a file or folder">
    <div class="at-header">
      <span class="at-header-title">Link file or folder</span>
      <span v-if="query" class="at-query-chip">@{{ query }}</span>
      <button class="at-close-btn" aria-label="Close file picker" @click="emit('close')">
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <div v-if="loading" class="at-state">
      <span class="at-state-text">Loading project files…</span>
    </div>
    <div v-else-if="entries.length === 0 && !query" class="at-state">
      <span class="at-state-text">Open a project to link files</span>
    </div>
    <div v-else-if="entries.length === 0" class="at-state">
      <span class="at-state-text">No matches for "<strong>{{ query }}</strong>"</span>
    </div>

    <div v-else ref="listRef" class="at-list" role="presentation">
      <button
        v-for="(entry, idx) in entries"
        :key="entry.path"
        class="at-entry"
        :class="{ 'at-entry--sel': idx === selectedIdx }"
        role="option"
        :aria-selected="idx === selectedIdx"
        @click="emit('select', entry)"
        @mouseenter="emit('hover', idx)"
      >
        <!-- Dynamic Icon Rendering -->
        <template v-if="entry.isDir">
          <component
            :is="folderStyle(getFilename(entry.path), false).icon"
            :size="13"
            :stroke-width="1.6"
            class="at-icon"
            :style="{ color: folderStyle(getFilename(entry.path), false).color }"
            aria-hidden="true"
          />
        </template>
        <template v-else>
          <i
            v-if="getDeviconForFile(getFilename(entry.path))"
            class="at-icon" :class="[getDeviconForFile(getFilename(entry.path))]"
            :style="{ fontSize: '13px', color: fileStyle(getFilename(entry.path)).color }"
            aria-hidden="true"
          />
          <component
            :is="fileStyle(getFilename(entry.path)).icon"
            v-else
            :size="13"
            :stroke-width="1.6"
            class="at-icon"
            :style="{ color: fileStyle(getFilename(entry.path)).color }"
            aria-hidden="true"
          />
        </template>

        <!-- Path with match highlighting -->
        <span class="at-path">
          <template v-for="part in highlightParts(entry.path, query)" :key="part.text + String(part.match)">
            <span v-if="part.match" class="at-path-match">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>

        <span v-if="entry.isDir" class="at-dir-badge">dir</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── outer shell — detached from input-shell below ──────────────────────────── */

.at-overlay {
  width: 100%;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 320px;
}

.at-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.at-header-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  flex: 1;
}

.at-query-chip {
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--color-accent-text);
  background: var(--color-accent-muted-plus);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-xs);
  padding: 1px 6px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.at-close-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 100ms ease,
    color 100ms ease;
}
.at-close-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}

.at-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding-inline: 16px;
}
.at-state-text {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}
.at-state-text strong {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.at-list {
  overflow-y: auto;
  padding: 6px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.at-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  min-height: 34px;
  padding-inline: 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 70ms ease;
}

.at-entry:hover,
.at-entry--sel {
  background: var(--color-state-hover);
}

.at-icon {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.at-path {
  flex: 1;
  font-size: 12.5px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 70ms ease;
}
.at-entry--sel .at-path {
  color: var(--color-text-primary);
}

.at-path-match {
  color: var(--color-accent-text);
  font-weight: 600;
}

.at-dir-badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-warning-text);
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: var(--radius-xs);
  padding: 1px 4px;
  flex-shrink: 0;
}
</style>
