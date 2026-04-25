<script setup lang="ts">
/**
 * AtMentionDropdown.vue
 *
 * The file-picker panel that appears above the chat input when the user types "@".
 * Uses the same visual fusion trick as QuestionOverlay — no bottom border + -1px
 * margin so it merges with the input shell into one continuous panel.
 *
 * Props:  entries, selectedIdx, loading, query
 * Emits:  select(entry), hover(idx), close()
 */

import type { FsEntry } from '@/composables/useAtMention'
import { File, Folder, X } from 'lucide-vue-next'
import { ref, watchEffect } from 'vue'

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
    <!-- ── Header ──────────────────────────────────────────────────── -->
    <div class="at-header">
      <span class="at-header-title">Link file or folder</span>
      <span v-if="query" class="at-query-chip">@{{ query }}</span>
      <button
        class="at-close-btn"
        aria-label="Close file picker"
        @click="emit('close')"
      >
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <!-- ── Loading ─────────────────────────────────────────────────── -->
    <div v-if="loading" class="at-state">
      <span class="at-state-text">Loading project files…</span>
    </div>

    <!-- ── No project open ─────────────────────────────────────────── -->
    <div v-else-if="entries.length === 0 && !query" class="at-state">
      <span class="at-state-text">Open a project to link files</span>
    </div>

    <!-- ── No matches ──────────────────────────────────────────────── -->
    <div v-else-if="entries.length === 0" class="at-state">
      <span class="at-state-text">No matches for "<strong>{{ query }}</strong>"</span>
    </div>

    <!-- ── Entry list ──────────────────────────────────────────────── -->
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
        <!-- Icon -->
        <Folder
          v-if="entry.isDir"
          :size="13"
          :stroke-width="1.6"
          class="at-icon at-icon--dir"
          aria-hidden="true"
        />
        <File
          v-else
          :size="13"
          :stroke-width="1.6"
          class="at-icon at-icon--file"
          aria-hidden="true"
        />

        <!-- Path with match highlighting -->
        <span class="at-path">
          <template
            v-for="part in highlightParts(entry.path, query)"
            :key="part.text + String(part.match)"
          >
            <span v-if="part.match" class="at-path-match">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>

        <!-- Dir badge -->
        <span v-if="entry.isDir" class="at-dir-badge">dir</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── outer shell — fuses with input-shell below ──────────────────────────── */

.at-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-bottom: none; /* fuse with input-shell top border */
  border-radius: 12px 12px 0 0; /* round only the top corners */
  margin-bottom: -1px; /* overlap input-shell's top border by 1px */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Limit height so it doesn't push the input off-screen */
  max-height: 320px;
}

/* ── header ─────────────────────────────────────────────────────────────── */

.at-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.at-header-title {
  font-size: 11.5px;
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
  border-radius: 4px;
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
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 100ms ease,
    color 100ms ease;
}
.at-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

/* ── state (loading / empty) ─────────────────────────────────────────────── */

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

/* ── entry list ──────────────────────────────────────────────────────────── */

.at-list {
  flex: 1;
  overflow-y: auto;
  padding: 3px 0;
  min-height: 0;
}

.at-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding-inline: 12px;
  border: none;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 70ms ease;
}
.at-entry:hover,
.at-entry--sel {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-subtle);
}

/* icons */
.at-icon {
  flex-shrink: 0;
}
.at-icon--dir {
  color: var(--color-warning-text);
}
.at-icon--file {
  color: var(--color-text-tertiary);
}

/* path text */
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

/* matched portion highlight */
.at-path-match {
  color: var(--color-accent-text);
  font-weight: 600;
}

/* dir badge */
.at-dir-badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-warning-text);
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
}
</style>
