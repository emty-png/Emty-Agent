<script setup lang="ts">
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import { FileText, X } from 'lucide-vue-next'
import { formatFileSize } from '@/stores/chat/core/attachmentTypes'

defineProps<{
  attachments: Attachment[]
}>()

const emit = defineEmits<{
  preview: [Attachment]
  remove: [string]
}>()

const stripClasses = 'flex flex-wrap gap-1.5 px-2.5 pt-1 pb-1.5'
const chipClasses = 'flex items-center gap-2 p-[5px_8px_5px_5px] bg-(--color-state-hover) border border-(--color-border-bright) rounded-(--radius-md) cursor-pointer max-w-[220px] transition-[background,border-color] duration-[110ms] ease hover:bg-(--color-bg-elevated) hover:border-(--color-border-bright)'
const thumbClasses = 'w-9 h-9 object-cover rounded-(--radius-sm) shrink-0'
const fileIconClasses = 'flex items-center justify-center w-9 h-9 rounded-(--radius-sm) bg-(--color-bg-card) text-(--color-text-tertiary) shrink-0'
const infoClasses = 'flex flex-col gap-px min-w-0 flex-1'
const nameClasses = 'text-[11.5px] font-semibold text-(--color-text-secondary) whitespace-nowrap overflow-hidden text-ellipsis'
const sizeClasses = 'text-[10px] text-(--color-text-tertiary)'
const removeClasses = 'flex items-center justify-center w-[18px] h-[18px] border-none rounded-(--radius-xs) bg-transparent text-(--color-text-tertiary) cursor-pointer shrink-0 transition-[background,color] duration-100 ease hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] hover:text-(--color-danger-text)'
</script>

<template>
  <div v-if="attachments.length > 0" :class="stripClasses">
    <div
      v-for="att in attachments"
      :key="att.id"
      :class="chipClasses"
      @click="emit('preview', att)"
    >
      <img
        v-if="att.type === 'image'"
        :src="att.dataUrl"
        :alt="att.name"
        :class="thumbClasses"
      >
      <div v-else :class="fileIconClasses">
        <FileText :size="16" :stroke-width="1.6" />
      </div>
      <div :class="infoClasses">
        <span :class="nameClasses">{{ att.name }}</span>
        <span :class="sizeClasses">{{ formatFileSize(att.size) }}</span>
      </div>
      <button
        :class="removeClasses"
        aria-label="Remove attachment"
        @click.stop="emit('remove', att.id)"
      >
        <X :size="12" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>
