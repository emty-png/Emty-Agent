<script setup lang="ts">
import type { CommandEntry } from '@/composables/chat/useSlashCommand'
import { X } from 'lucide-vue-next'
import { ref, watchEffect } from 'vue'
import { highlightParts } from '@/utils/highlightParts'

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

const listRef = ref<HTMLElement | null>(null)

watchEffect(() => {
  const idx = props.selectedIdx
  const child = listRef.value?.children[idx] as HTMLElement | undefined
  child?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
})

const overlayClasses = 'w-full max-h-[320px] bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) mb-2 flex flex-col overflow-hidden'

const headerClasses = 'flex items-center gap-2 pl-[14px] pr-3 py-2.5 border-b border-(--color-border-mid) shrink-0'
const headerTitleClasses = 'flex-1 text-[11px] font-semibold tracking-[0.04em] uppercase text-(--color-text-tertiary)'
const queryChipClasses = 'text-[11px] font-semibold font-mono text-(--color-accent-text) bg-(--color-accent-muted-plus) border border-(--color-accent-dim) rounded-(--radius-xs) px-1.5 py-[1px] max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap'
const closeBtnClasses = 'grid place-items-center w-[22px] h-[22px] border-none rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) cursor-pointer shrink-0 transition-[background,color] duration-100 ease hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)'

const stateClasses = 'flex items-center justify-center h-[52px] px-4'
const stateTextClasses = 'text-[12.5px] text-(--color-text-tertiary)'
const stateStrongClasses = 'font-semibold text-(--color-text-secondary)'

const listClasses = 'flex flex-col gap-0.5 overflow-y-auto p-1.5 min-h-0'

function getEntryClasses(isSelected: boolean) {
  const base = 'flex items-center gap-2 w-full h-[34px] min-h-[34px] px-2.5 border-none rounded-(--radius-md) cursor-pointer text-left transition-colors duration-[70ms] ease'
  return isSelected
    ? `${base} bg-(--color-state-hover)`
    : `${base} bg-transparent hover:bg-(--color-state-hover)`
}

function getLabelClasses(isSelected: boolean) {
  const base = 'text-[12.5px] font-mono whitespace-nowrap shrink-0 transition-colors duration-[70ms] ease'
  return isSelected
    ? `${base} text-(--color-text-primary)`
    : `${base} text-(--color-text-secondary)`
}

const labelMatchClasses = 'text-(--color-accent-text) font-semibold'
const descClasses = 'flex flex-1 items-center gap-1.5 min-w-0 text-[11.5px] text-(--color-text-dim) whitespace-nowrap overflow-hidden text-ellipsis'
const whenClasses = 'text-[10.5px] text-(--color-text-tertiary) italic whitespace-nowrap overflow-hidden text-ellipsis'
</script>

<template>
  <div :class="overlayClasses" role="listbox" aria-label="Available commands">
    <div :class="headerClasses">
      <span :class="headerTitleClasses">Commands</span>
      <span v-if="query" :class="queryChipClasses">/{{ query }}</span>
      <button :class="closeBtnClasses" aria-label="Close commands" @click="emit('close')">
        <X :size="13" :stroke-width="2" />
      </button>
    </div>

    <div v-if="loading" :class="stateClasses">
      <span :class="stateTextClasses">Loading commands…</span>
    </div>
    <div v-else-if="entries.length === 0" :class="stateClasses">
      <span :class="stateTextClasses">No commands for "<strong :class="stateStrongClasses">{{ query }}</strong>"</span>
    </div>

    <div v-else ref="listRef" :class="listClasses" role="presentation">
      <button
        v-for="(entry, idx) in entries"
        :key="entry.id"
        :class="getEntryClasses(idx === selectedIdx)"
        role="option"
        :aria-selected="idx === selectedIdx"
        @click="emit('select', entry)"
        @mouseenter="emit('hover', idx)"
      >
        <span :class="getLabelClasses(idx === selectedIdx)">
          <template v-for="(part, pi) in highlightParts(entry.label, query)" :key="pi">
            <span v-if="part.match" :class="labelMatchClasses">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>

        <span :class="descClasses">
          {{ entry.description }}
          <span v-if="entry.whenToUse" :class="whenClasses">{{ entry.whenToUse }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
