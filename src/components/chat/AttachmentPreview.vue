<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted } from 'vue'
import { formatFileSize, isImageMime } from '@/stores/chat/attachment-types'

const props = defineProps<{
  attachment: Attachment
}>()

const emit = defineEmits<{
  close: []
}>()

const isImage = computed(() => isImageMime(props.attachment.mimeType))

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="preview-fade">
      <div v-if="attachment" class="preview-backdrop" @click.self="$emit('close')">
        <div class="preview-panel">
          <div class="preview-header">
            <div class="preview-file-info">
              <span class="preview-filename">{{ attachment.name }}</span>
              <span class="preview-meta">{{ formatFileSize(attachment.size) }} · {{ attachment.mimeType }}</span>
            </div>
            <button class="preview-close" aria-label="Close preview" @click="$emit('close')">
              <X :size="16" :stroke-width="2" />
            </button>
          </div>

          <div class="preview-body">
            <!-- Image preview -->
            <img
              v-if="isImage"
              :src="attachment.dataUrl"
              :alt="attachment.name"
              class="preview-image"
            >

            <!-- Text/code file preview -->
            <pre v-else class="preview-text"><code>{{ attachment.dataUrl }}</code></pre>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-bg-base) 88%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 32px;
}

.preview-panel {
  display: flex;
  flex-direction: column;
  max-width: 90vw;
  max-height: 85vh;
  min-width: 320px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 24px 56px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  animation: preview-slide-up 200ms ease;
}

@keyframes preview-slide-up {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.preview-file-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preview-filename {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 110ms ease,
    color 110ms ease,
    border-color 110ms ease;
}

.preview-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}

.preview-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image {
  max-width: 100%;
  max-height: calc(85vh - 80px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.preview-text {
  width: 100%;
  max-height: calc(85vh - 80px);
  overflow: auto;
  margin: 0;
  padding: 16px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
}

.preview-text code {
  color: inherit;
  background: none;
  padding: 0;
  font-size: inherit;
  font-family: inherit;
}

/* Transition */
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 180ms ease;
}
.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
</style>
