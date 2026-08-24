<script setup lang="ts">
import type { DesignVersionRef } from '@/stores/chat/core/types'
import { Eye, GitCompareArrows } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  version: DesignVersionRef
  canCompare?: boolean
}>()

const emit = defineEmits<{
  preview: []
  compare: []
}>()

const showActions = computed(() => props.canCompare !== false)
</script>

<template>
  <div
    class="group/dv flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-card py-3 pr-2 pl-4 transition-colors duration-150 hover:border-accent/30"
    @click="emit('preview')"
  >
    <span class="min-w-0 truncate text-[13px] font-semibold leading-none text-text-primary">{{ version.label }}</span>

    <div class="flex shrink-0 items-center gap-1">
      <button
        class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border border-border-subtle bg-accent-muted-plus px-2.5 text-[11px] font-medium text-text-secondary transition-all duration-150 ease-out hover:border-accent-dim hover:text-accent-text active:scale-[0.96]"
        :class="{ invisible: !showActions }"
        title="Preview this version"
        @click.stop="emit('preview')"
      >
        <Eye :size="12" :stroke-width="1.8" />
        Preview
      </button>
      <button
        class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border border-border-subtle bg-accent-muted-plus text-text-tertiary transition-all duration-150 ease-out hover:border-accent-dim hover:text-accent-text active:scale-[0.96]"
        :class="{ invisible: !showActions }"
        title="Compare with current"
        @click.stop="emit('compare')"
      >
        <GitCompareArrows :size="13" :stroke-width="1.8" />
      </button>
    </div>
  </div>
</template>
