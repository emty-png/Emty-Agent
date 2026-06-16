<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { FileText, X } from 'lucide-vue-next'
import { formatFileSize } from '@/stores/chat/attachment-types'

defineProps<{
  attachments: Attachment[]
}>()

const emit = defineEmits<{
  preview: [Attachment]
  remove: [string]
}>()
</script>

<template>
  <div v-if="attachments.length > 0" class="attachment-strip">
    <div
      v-for="att in attachments"
      :key="att.id"
      class="attachment-chip"
      @click="emit('preview', att)"
    >
      <img
        v-if="att.type === 'image'"
        :src="att.dataUrl"
        :alt="att.name"
        class="attachment-thumb"
      >
      <div v-else class="attachment-file-icon">
        <FileText :size="16" :stroke-width="1.6" />
      </div>
      <div class="attachment-info">
        <span class="attachment-name">{{ att.name }}</span>
        <span class="attachment-size">{{ formatFileSize(att.size) }}</span>
      </div>
      <button
        class="attachment-remove"
        aria-label="Remove attachment"
        @click.stop="emit('remove', att.id)"
      >
        <X :size="12" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── attachment preview strip ─────────────────────────────────────────────── */
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 10px 6px;
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 5px;
  background: var(--color-state-hover);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-md);
  cursor: pointer;
  max-width: 220px;
  transition:
    background 110ms ease,
    border-color 110ms ease;
}

.attachment-chip:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-bright);
}

.attachment-thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.attachment-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-card);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.attachment-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-size {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.attachment-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.attachment-remove:hover {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger-text);
}
</style>
