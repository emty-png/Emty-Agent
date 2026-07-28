<script setup lang="ts">
import type { FileDiff, RestoreMode } from '@/composables/chat/useRestoreOverlay'
import type { Checkpoint } from '@/stores/checkpoints'
import { ChevronDown, FileCode, History, Loader2, X } from 'lucide-vue-next'

const props = defineProps<{
  checkpoints: Checkpoint[]
  expandedId: string | null
  fileDiffs: FileDiff[]
  loadingDiffs: boolean
  selectedMode: RestoreMode
  loading: boolean
}>()

const emit = defineEmits<{
  close: []
  toggle: [id: string]
  restore: [id: string]
  'update:mode': [mode: RestoreMode]
}>()

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60)
    return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const modes: { value: RestoreMode; label: string; desc: string }[] = [
  { value: 'full', label: 'Full', desc: 'Revert files & remove messages' },
  { value: 'conversation', label: 'Conversation', desc: 'Remove messages only' },
  { value: 'files', label: 'Files', desc: 'Revert files only' },
]

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const overlayClasses = 'w-full max-h-80 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) mb-2 flex flex-col overflow-hidden'

const headerClasses = 'flex items-center gap-2.5 pl-[14px] pr-3 py-2.5 border-b border-(--color-border-mid) shrink-0'
const headerTitleClasses = 'flex items-center gap-2 text-[11px] font-semibold tracking-[0.04em] uppercase text-(--color-text-tertiary)'
const countClasses = 'inline-flex items-center justify-center h-5 px-2 rounded-(--radius-lg) text-[11px] font-semibold bg-(--color-state-hover) text-(--color-text-secondary) [font-variant-numeric:tabular-nums]'
const closeBtnClasses = 'grid place-items-center w-[22px] h-[22px] border-none rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) cursor-pointer shrink-0 transition-[background,color] duration-100 ease hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)'

const stateClasses = 'flex items-center justify-center h-[52px] px-4'
const stateTextClasses = 'text-[12.5px] text-(--color-text-tertiary)'

const listClasses = 'flex flex-col gap-0.5 overflow-y-auto p-1.5 min-h-0 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:my-1 [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-sm)'

function getCheckpointClasses(_id: string, isExpanded: boolean) {
  const base = 'w-full border rounded-(--radius-md) transition-[background,border-color] duration-[100ms] text-left'
  if (isExpanded)
    return `${base} bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-card))] border-(--color-accent-dim)`
  return `${base} bg-transparent border-transparent hover:bg-(--color-state-hover) hover:border-(--color-border-subtle)`
}

const cpHeaderClasses = 'flex items-center gap-2 w-full px-2.5 py-2 cursor-pointer'

function cpChevronClasses(isExpanded: boolean) {
  return `shrink-0 text-(--color-text-tertiary) transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`
}

const cpLabelClasses = 'flex-1 min-w-0 text-[12.5px] font-medium text-(--color-text-primary) truncate'

const cpTimeClasses = 'shrink-0 text-[11px] text-(--color-text-dim)'

const cpRestoreBtnClasses = 'flex items-center gap-1 h-[22px] px-2 border border-transparent rounded-(--radius-sm) bg-transparent text-(--color-accent-text) text-[11px] font-semibold font-[inherit] cursor-pointer transition-[color,background,border-color] duration-150 ease enabled:hover:bg-(--color-accent-muted) enabled:hover:border-(--color-accent-dim) disabled:cursor-not-allowed disabled:opacity-40'

const expandBodyClasses = 'border-t border-(--color-border-mid) px-2.5 py-2'

const fileCardClasses = 'rounded-(--radius-sm) border border-(--color-border-subtle) overflow-hidden'

const fileHeaderClasses = 'flex items-center gap-2 px-2.5 py-1.5 bg-(--color-state-hover)'

const fileNameClasses = 'flex-1 min-w-0 text-[11.5px] font-medium text-(--color-text-secondary) truncate font-mono'

const fileCountClasses = 'shrink-0 text-[10px] font-semibold text-(--color-text-dim) [font-variant-numeric:tabular-nums]'

const addedCountClasses = 'text-(--color-success-text)'

const removedCountClasses = 'text-(--color-danger-text)'

const diffContainerClasses = 'max-h-[140px] overflow-y-auto bg-[color-mix(in_srgb,var(--color-bg-base)_50%,var(--color-bg-card))] [scrollbar-width:thin]'

function getDiffLineClasses(type: 'added' | 'removed' | 'normal') {
  const base = 'px-2.5 py-[1px] text-[11px] font-mono leading-[1.6] whitespace-pre overflow-x-auto [scrollbar-width:none]'
  if (type === 'added')
    return `${base} bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-(--color-success-text)`
  if (type === 'removed')
    return `${base} bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-(--color-danger-text)`
  return `${base} text-(--color-text-dim)`
}

function getDiffPrefix(type: 'added' | 'removed' | 'normal') {
  if (type === 'added')
    return '+'
  if (type === 'removed')
    return '-'
  return ' '
}

const noFilesClasses = 'text-[11.5px] text-(--color-text-dim) italic py-3 text-center'

const footerClasses = 'flex items-center gap-2 px-3 py-2 border-t border-(--color-border-mid) shrink-0'

const modeLabelClasses = 'text-[11px] font-medium text-(--color-text-tertiary) shrink-0'

const modeSelectorClasses = 'flex items-center gap-0.5 p-0.5 rounded-(--radius-md) bg-(--color-state-hover)'

function getModeBtnClasses(mode: RestoreMode) {
  const base = 'h-[22px] px-2.5 border-none rounded-(--radius-sm) text-[11px] font-medium font-[inherit] cursor-pointer transition-[background,color] duration-100'
  if (props.selectedMode === mode)
    return `${base} bg-(--color-bg-card) text-(--color-text-primary) shadow-[0_1px_3px_rgba(0,0,0,0.12)]`
  return `${base} bg-transparent text-(--color-text-tertiary) hover:text-(--color-text-secondary)`
}

function getModeTooltip(mode: { desc: string }) {
  return mode.desc
}

const confirmBtnClasses = 'ml-auto h-[26px] px-3 border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] rounded-(--radius-sm) bg-(--color-accent-muted) text-(--color-accent-text) text-[11.5px] font-semibold font-[inherit] cursor-pointer transition-[background,border-color] duration-[120ms] ease enabled:hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] enabled:hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed'
</script>

<template>
  <div :class="overlayClasses" role="region" aria-label="Restore points">
    <!-- ── Header ────────────────────────────────────────────────────── -->
    <div :class="headerClasses">
      <span :class="headerTitleClasses">
        <History :size="12" :stroke-width="2" />
        Restore Points
      </span>
      <span v-if="!loading && checkpoints.length > 0" :class="countClasses">{{ checkpoints.length }}</span>
      <div class="flex-1" />
      <button :class="closeBtnClasses" aria-label="Close restore overlay" @click="emit('close')">
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <!-- ── Loading ───────────────────────────────────────────────────── -->
    <div v-if="loading" :class="stateClasses">
      <Loader2 :size="14" :stroke-width="2" class="shrink-0 text-(--color-text-tertiary) animate-spin mr-2" />
      <span :class="stateTextClasses">Loading checkpoints…</span>
    </div>

    <!-- ── Empty state ───────────────────────────────────────────────── -->
    <div v-else-if="checkpoints.length === 0" :class="stateClasses">
      <span :class="stateTextClasses">No checkpoints yet. They're created before each message.</span>
    </div>

    <!-- ── Checkpoint list ───────────────────────────────────────────── -->
    <div v-else :class="listClasses" role="list">
      <div
        v-for="cp in checkpoints"
        :key="cp.id"
        :class="getCheckpointClasses(cp.id, expandedId === cp.id)"
        role="listitem"
      >
        <!-- Card header -->
        <div :class="cpHeaderClasses" @click="emit('toggle', cp.id)">
          <ChevronDown
            :size="12"
            :stroke-width="2.5"
            :class="cpChevronClasses(expandedId === cp.id)"
          />
          <span :class="cpLabelClasses">{{ cp.label }}</span>
          <span :class="cpTimeClasses">{{ formatRelativeTime(cp.timestamp) }}</span>
        </div>

        <!-- Expanded body -->
        <Transition
          enter-active-class="transition-[opacity,transform] duration-150 ease-out"
          leave-active-class="transition-[opacity,transform] duration-100 ease-in"
          enter-from-class="opacity-0 -translate-y-1"
          enter-to-class="opacity-100 translate-y-0"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-1"
        >
          <div v-if="expandedId === cp.id" :class="expandBodyClasses">
            <!-- Diff loading -->
            <div v-if="loadingDiffs" class="flex items-center justify-center py-3 gap-2">
              <Loader2 :size="12" :stroke-width="2" class="text-(--color-text-tertiary) animate-spin" />
              <span :class="stateTextClasses">Loading file changes…</span>
            </div>

            <!-- File diffs -->
            <div v-else-if="fileDiffs.length > 0" class="flex flex-col gap-1.5">
              <div v-for="fd in fileDiffs" :key="fd.absolutePath" :class="fileCardClasses">
                <div :class="fileHeaderClasses">
                  <FileCode :size="11" :stroke-width="2" class="shrink-0 text-(--color-text-tertiary)" />
                  <span :class="fileNameClasses">{{ fd.relativePath }}</span>
                  <span :class="fileCountClasses">
                    <span :class="addedCountClasses">+{{ fd.addedCount }}</span>
                    <span class="mx-0.5 opacity-40">/</span>
                    <span :class="removedCountClasses">-{{ fd.removedCount }}</span>
                  </span>
                </div>
                <div :class="diffContainerClasses">
                  <div
                    v-for="(line, li) in fd.lines.slice(0, 200)"
                    :key="li"
                    :class="getDiffLineClasses(line.type)"
                  >
                    {{ getDiffPrefix(line.type) }}{{ line.content }}
                  </div>
                  <div v-if="fd.lines.length > 200" class="px-2.5 py-1.5 text-[10px] text-(--color-text-dim) italic text-center">
                    Truncated — {{ fd.lines.length - 200 }} more lines
                  </div>
                </div>
              </div>
            </div>

            <!-- No files changed -->
            <div v-else :class="noFilesClasses">
              No file changes in this checkpoint
            </div>

            <!-- Actions row for this checkpoint -->
            <div class="flex items-center gap-2 mt-2">
              <button :class="cpRestoreBtnClasses" @click="emit('restore', cp.id)">
                Restore this point
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- ── Footer: mode selector + cancel ────────────────────────────── -->
    <div v-if="checkpoints.length > 0" :class="footerClasses">
      <span :class="modeLabelClasses">Mode:</span>
      <div :class="modeSelectorClasses">
        <button
          v-for="m in modes"
          :key="m.value"
          :class="getModeBtnClasses(m.value)"
          :title="getModeTooltip(m)"
          @click="emit('update:mode', m.value)"
        >
          {{ m.label }}
        </button>
      </div>
      <div class="flex-1" />
      <button
        :class="confirmBtnClasses"
        :disabled="!expandedId"
        @click="expandedId && emit('restore', expandedId)"
      >
        Restore
      </button>
    </div>
  </div>
</template>
