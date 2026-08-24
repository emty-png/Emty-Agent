<script setup lang="ts">
import type { DesignVersionRef } from '@/stores/chat/core/types'
import { GitCompareArrows, RotateCcw, X } from 'lucide-vue-next'

defineProps<{
  version: DesignVersionRef
}>()

const emit = defineEmits<{
  back: []
  restore: []
  compare: []
  close: []
}>()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-border-subtle bg-bg-base px-2.5 py-1.5 shrink-0">
    <span class="mr-1 text-[12px] font-semibold text-text-primary">Viewing {{ version.label }}</span>
    <span class="flex-1" />
    <button
      class="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-sm border-none bg-transparent px-2 text-[11px] font-medium text-text-tertiary transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary active:bg-accent-muted active:text-accent-text"
      @click="emit('compare')"
    >
      <GitCompareArrows :size="13" :stroke-width="1.8" /> Compare
    </button>
    <button
      class="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-sm border-none bg-transparent px-2 text-[11px] font-medium text-text-tertiary transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary active:bg-accent-muted active:text-accent-text"
      @click="emit('restore')"
    >
      <RotateCcw :size="13" :stroke-width="1.8" /> Restore
    </button>
    <button
      class="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-text-tertiary transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary active:bg-accent-muted active:text-accent-text"
      title="Exit version preview"
      @click="emit('back')"
    >
      <X :size="14" :stroke-width="2" />
    </button>
  </div>
</template>
