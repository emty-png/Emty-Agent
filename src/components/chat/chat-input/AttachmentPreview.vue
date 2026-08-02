<script setup lang="ts">
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import { X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted } from 'vue'
import { formatFileSize, isBrowserElementAttachment, isImageMime, parseBrowserElementAttachment } from '@/stores/chat/core/attachmentTypes'

const props = defineProps<{
  attachment: Attachment
}>()

const emit = defineEmits<{
  close: []
}>()

const isImage = computed(() => isImageMime(props.attachment.mimeType))
const isBrowserElement = computed(() => isBrowserElementAttachment(props.attachment))
const browserData = computed(() => parseBrowserElementAttachment(props.attachment))

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const backdropClasses = 'fixed inset-0 z-[99999] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] p-8'
const panelClasses = 'flex flex-col max-w-[90vw] max-h-[85vh] min-w-[320px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] overflow-hidden'
const headerClasses = 'flex items-center justify-between gap-3 py-3 px-[14px] border-b border-(--color-border-mid) shrink-0'
const infoClasses = 'flex flex-col gap-0.5 min-w-0'
const filenameClasses = 'text-[13px] font-semibold text-(--color-text-primary) whitespace-nowrap overflow-hidden text-ellipsis'
const metaClasses = 'text-[11px] text-(--color-text-tertiary)'
const closeClasses = 'flex items-center justify-center w-7 h-7 border border-(--color-border-mid) rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) cursor-pointer shrink-0 transition-[background,color,border-color] duration-[110ms] ease hover:bg-(--color-state-hover) hover:text-(--color-text-primary) hover:border-(--color-border-bright)'
const bodyClasses = 'flex-1 overflow-auto p-4 flex items-center justify-center'
const imageClasses = 'max-w-full max-h-[calc(85vh-80px)] object-contain rounded-(--radius-md) shadow-[0_4px_24px_rgba(0,0,0,0.3)]'
const textClasses = 'w-full max-h-[calc(85vh-80px)] overflow-auto m-0 p-4 bg-(--color-bg-card) border border-(--color-border-mid) rounded-(--radius-md) text-(--color-text-primary) font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap break-words [tab-size:2]'
const codeClasses = 'text-[inherit] bg-transparent p-0 font-[inherit]'
const browserPreviewClasses = 'w-full max-w-[760px] max-h-[calc(85vh-80px)] overflow-auto flex flex-col gap-3 text-(--color-text-primary)'
const browserCommentClasses = 'rounded-(--radius-md) border border-[color-mix(in_srgb,var(--color-accent)_28%,var(--color-border-mid))] bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-bg-card))] p-3 text-[13px] leading-[1.55]'
const browserMetaClasses = 'grid gap-1.5 rounded-(--radius-md) border border-(--color-border-mid) bg-(--color-bg-card) p-3 text-[12px] leading-[1.45]'
const browserMetaRowClasses = 'grid grid-cols-[88px_minmax(0,1fr)] gap-2'
const browserMetaLabelClasses = 'text-(--color-text-tertiary)'
const browserMetaValueClasses = 'min-w-0 break-words text-(--color-text-secondary)'

const panelTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-200 ease-out',
  enterFromClass: 'opacity-0 translate-y-3 scale-[0.98]',
  enterToClass: 'opacity-100 translate-y-0 scale-100',
}
</script>

<template>
  <Teleport to="body">
    <div :class="backdropClasses" @click.self="$emit('close')">
      <Transition appear v-bind="panelTransitions">
        <div :class="panelClasses">
          <div :class="headerClasses">
            <div :class="infoClasses">
              <span :class="filenameClasses">{{ attachment.name }}</span>
              <span :class="metaClasses">{{ isBrowserElement ? 'Browser element comment' : `${formatFileSize(attachment.size)} - ${attachment.mimeType}` }}</span>
            </div>
            <button :class="closeClasses" aria-label="Close preview" @click="$emit('close')">
              <X :size="16" :stroke-width="2" />
            </button>
          </div>

          <div :class="bodyClasses">
            <div v-if="browserData" :class="browserPreviewClasses">
              <div :class="browserCommentClasses">
                {{ browserData.comment }}
              </div>
              <div :class="browserMetaClasses">
                <div :class="browserMetaRowClasses">
                  <span :class="browserMetaLabelClasses">Page</span>
                  <span :class="browserMetaValueClasses">{{ browserData.title || browserData.url }}</span>
                </div>
                <div :class="browserMetaRowClasses">
                  <span :class="browserMetaLabelClasses">URL</span>
                  <span :class="browserMetaValueClasses">{{ browserData.url }}</span>
                </div>
                <div :class="browserMetaRowClasses">
                  <span :class="browserMetaLabelClasses">Selector</span>
                  <code :class="browserMetaValueClasses">{{ browserData.element.selector }}</code>
                </div>
                <div v-if="browserData.element.text" :class="browserMetaRowClasses">
                  <span :class="browserMetaLabelClasses">Text</span>
                  <span :class="browserMetaValueClasses">{{ browserData.element.text }}</span>
                </div>
              </div>
              <pre :class="textClasses"><code :class="codeClasses">{{ browserData.element.outerHTML }}</code></pre>
            </div>

            <img
              v-else-if="isImage"
              :src="attachment.dataUrl"
              :alt="attachment.name"
              :class="imageClasses"
            >

            <pre v-else :class="textClasses"><code :class="codeClasses">{{ attachment.dataUrl }}</code></pre>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
