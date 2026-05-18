<script setup lang="ts">
import type { CommandEntry } from '@/composables/useSlashCommand'
import { FileCode, FilePlus, WandSparkles, X } from 'lucide-vue-next'
import { ref, watchEffect } from 'vue'

const props = defineProps<{
  entries: CommandEntry[]
  selectedIdx: number
  loading: boolean
  query: string
}>()

const emit = defineEmits<{
  select: [entry: CommandEntry]
  hover: [idx: number]
  close: []
}>()

// ── highlight helper ──────────────────────────────────────────────────────────

interface Part { text: string; match: boolean }

function highlightParts(text: string, query: string): Part[] {
  if (!query)
    return [{ text, match: false }]
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1)
    return [{ text, match: false }]
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + query.length), match: true },
    { text: text.slice(idx + query.length), match: false },
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
  <div class="cmd-overlay" role="listbox" aria-label="Available commands">
    <div class="cmd-header">
      <span class="cmd-header-title">Commands</span>
      <span v-if="query" class="cmd-query-chip">/{{ query }}</span>
      <button class="cmd-close-btn" aria-label="Close commands" @click="emit('close')">
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <div v-if="loading" class="cmd-state">
      <span class="cmd-state-text">Loading commands…</span>
    </div>
    <div v-else-if="entries.length === 0" class="cmd-state">
      <span class="cmd-state-text">No commands for "<strong>{{ query }}</strong>"</span>
    </div>

    <div v-else ref="listRef" class="cmd-list" role="presentation">
      <button
        v-for="(entry, idx) in entries"
        :key="entry.id"
        class="cmd-entry"
        :class="{ 'cmd-entry--sel': idx === selectedIdx }"
        role="option"
        :aria-selected="idx === selectedIdx"
        @click="emit('select', entry)"
        @mouseenter="emit('hover', idx)"
      >
        <FilePlus v-if="entry.id === 'new'" class="cmd-icon" :size="13" :stroke-width="1.6" color="#a0b8d8" aria-hidden="true" />
        <FileCode v-else-if="entry.id === 'init'" class="cmd-icon" :size="13" :stroke-width="1.6" color="#a8d8b8" aria-hidden="true" />
        <WandSparkles v-else class="cmd-icon" :size="13" :stroke-width="1.6" color="#d4aa68" aria-hidden="true" />

        <span class="cmd-label">
          <template v-for="(part, pi) in highlightParts(entry.label, query)" :key="pi">
            <span v-if="part.match" class="cmd-label-match">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>

        <span class="cmd-desc">{{ entry.description }}</span>

        <span class="cmd-key-hint" aria-hidden="true">↵</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── outer shell — detached from input-shell below ──────────────────────────── */

.cmd-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  max-height: 320px;
}

.cmd-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.cmd-header-title {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  flex: 1;
}

.cmd-query-chip {
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

.cmd-close-btn {
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
.cmd-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.cmd-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding-inline: 16px;
}
.cmd-state-text {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}
.cmd-state-text strong {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.cmd-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cmd-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding-inline: 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 70ms ease;
}

.cmd-entry:hover,
.cmd-entry--sel {
  background: var(--color-bg-elevated);
}

.cmd-icon {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.cmd-label {
  font-size: 12.5px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--color-text-secondary);
  white-space: nowrap;
  transition: color 70ms ease;
  flex-shrink: 0;
}
.cmd-entry--sel .cmd-label {
  color: var(--color-text-primary);
}

.cmd-label-match {
  color: var(--color-accent-text);
  font-weight: 600;
}

.cmd-desc {
  font-size: 11.5px;
  color: var(--color-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.cmd-key-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-dim);
  opacity: 0;
  transform: translateX(4px);
  transition:
    opacity 150ms ease,
    transform 150ms ease,
    color 150ms ease;
}
.cmd-entry--sel .cmd-key-hint {
  opacity: 1;
  transform: translateX(0);
  color: var(--color-accent-dim);
}
</style>
