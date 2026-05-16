<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { ArrowDown, Square } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BrowserPane from '@/components/browser/BrowserPane.vue'
import AttachmentPreview from '@/components/chat/AttachmentPreview.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import WeatherBackground from '@/components/chat/Illu_1.vue'
import MessageThread from '@/components/chat/MessageThread.vue'
import SubAgentBanner from '@/components/chat/SubAgentBanner.vue'
import TabBar from '@/components/chat/TabBar.vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'

const SPLIT_MIN = 28
const SPLIT_MAX = 72
const SPLIT_DEFAULT = 50

const chat = useChatStore()
const browser = useBrowserStore()
const { activeId, activeTab } = storeToRefs(chat)

const containerRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

const activeBrowserOwner = computed(() => browser.getOwner(activeId.value))
const splitPercent = computed(() => {
  const stored = activeBrowserOwner.value.splitPercent || SPLIT_DEFAULT
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, stored))
})
const mainPaneStyle = computed(() => {
  if (!activeBrowserOwner.value.isPanelOpen)
    return undefined

  // Use flex shorthand so this inline style wins over the CSS `flex: 1`.
  // Setting only `width` doesn't work because flexbox uses flex-basis for
  // sizing, not width — `flex: 0 0 X%` sets flex-basis directly.
  return {
    flex: `0 0 ${splitPercent.value}%`,
    maxWidth: `${splitPercent.value}%`,
  }
})

function onDragStart(event: MouseEvent) {
  if (!activeBrowserOwner.value.isPanelOpen)
    return

  event.preventDefault()
  dragging.value = true
}

function onMouseMove(event: MouseEvent) {
  if (!dragging.value || !containerRef.value)
    return

  const rect = containerRef.value.getBoundingClientRect()
  const raw = ((event.clientX - rect.left) / rect.width) * 100
  const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, raw))
  browser.setSplitPercent(activeId.value, next)
}

function onMouseUp() {
  dragging.value = false
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

const threadRef = ref<HTMLElement | null>(null)
const showScrollButton = ref(false)

function onScroll(event: Event) {
  const target = event.target as HTMLElement
  const distance = target.scrollHeight - target.scrollTop - target.clientHeight
  showScrollButton.value = distance > 100
}

function scrollToBottom() {
  if (!threadRef.value)
    return

  threadRef.value.scrollTo({
    top: threadRef.value.scrollHeight,
    behavior: 'smooth',
  })
  showScrollButton.value = false
}

watch(activeId, async () => {
  await nextTick()

  if (threadRef.value) {
    const distance = threadRef.value.scrollHeight - threadRef.value.scrollTop - threadRef.value.clientHeight
    showScrollButton.value = distance > 100
  }
})

watch(
  () => [
    activeTab.value.messages.length,
    activeTab.value.messages.at(-1)?.content?.length,
    activeTab.value.messages.at(-1)?.toolEvents?.length,
  ],
  async () => {
    await nextTick()

    if (threadRef.value && !showScrollButton.value)
      threadRef.value.scrollTop = threadRef.value.scrollHeight
  },
)

function send(text: string, attachments: Attachment[] = []) {
  chat.sendMessage(text, 'build', attachments.length > 0 ? attachments : undefined)
}

function stop() {
  chat.stopGeneration()
}

const previewAttachment = ref<Attachment | null>(null)

const isSubAgentTab = computed(() => !!activeTab.value.subAgent)

function goToParent() {
  const parentId = activeTab.value.subAgent?.parentTabId
  if (!parentId)
    return

  const parentTab = chat.tabs.find(tab => tab.id === parentId)
  if (parentTab)
    chat.activeId = parentId
}

const parentTabExists = computed(() => {
  const parentId = activeTab.value.subAgent?.parentTabId
  return !!parentId && chat.tabs.some(tab => tab.id === parentId)
})
</script>

<template>
  <div class="chat-root">
    <TabBar />

    <div
      ref="containerRef"
      class="chat-body"
      :class="{ 'chat-body--dragging': dragging }"
    >
      <div class="chat-main-panel" :style="mainPaneStyle">
        <Transition name="fade" mode="out-in">
          <div
            v-if="activeTab.messages.length === 0 && !isSubAgentTab"
            :key="`landing-${activeTab.id}`"
            class="landing"
          >
            <WeatherBackground />
            <div class="center-col">
              <ChatInput
                :is-streaming="activeTab.isStreaming"
                @send="send"
                @stop="stop"
              />
            </div>
          </div>

          <div
            v-else-if="isSubAgentTab"
            :key="`subagent-${activeTab.id}`"
            class="conversation"
          >
            <SubAgentBanner :sub-agent="activeTab.subAgent!" />

            <div class="thread-container">
              <div class="scroll-blur-top" />

              <div ref="threadRef" class="thread" @scroll="onScroll">
                <div class="thread-inner">
                  <MessageThread
                    :messages="activeTab.messages"
                    :is-streaming="activeTab.isStreaming"
                    :is-sub-agent="true"
                    @preview-attachment="previewAttachment = $event"
                  />
                </div>
              </div>

              <div class="scroll-blur-bottom" />

              <Transition name="btn-pop">
                <button
                  v-if="showScrollButton"
                  class="scroll-down-btn sa-scroll-down-btn"
                  aria-label="Scroll to bottom"
                  @click="scrollToBottom"
                >
                  <ArrowDown :size="16" :stroke-width="2.5" />
                </button>
              </Transition>
            </div>

            <div class="sa-footer">
              <div class="sa-footer-inner">
                <button
                  v-if="parentTabExists"
                  class="sa-footer-parent-btn"
                  title="Go to the tab that spawned this agent"
                  @click="goToParent"
                >
                  Back to parent
                </button>
                <span v-else class="sa-footer-orphan">Spawned by a closed tab</span>

                <div class="sa-footer-spacer" />

                <button
                  v-if="activeTab.isStreaming"
                  class="sa-footer-stop"
                  aria-label="Stop sub-agent"
                  @click="chat.stopGeneration(activeTab.id)"
                >
                  <Square :size="12" :stroke-width="0" style="fill: currentColor; margin-right: 6px;" />
                  Stop
                </button>

                <span
                  v-else
                  class="sa-footer-done"
                  :class="`sa-footer-done--${activeTab.subAgent!.status}`"
                >
                  {{ activeTab.subAgent!.status === 'done' ? 'Completed' : 'Stopped' }}
                </span>
              </div>
            </div>
          </div>

          <div
            v-else
            :key="`conversation-${activeTab.id}`"
            class="conversation"
          >
            <div class="thread-container">
              <div class="scroll-blur-top" />

              <div ref="threadRef" class="thread" @scroll="onScroll">
                <div class="thread-inner">
                  <MessageThread
                    :messages="activeTab.messages"
                    :is-streaming="activeTab.isStreaming"
                    :is-sub-agent="false"
                    @preview-attachment="previewAttachment = $event"
                  />
                </div>
              </div>

              <div class="scroll-blur-bottom" />
            </div>

            <div class="convo-input-wrap">
              <Transition name="btn-pop">
                <button
                  v-if="showScrollButton"
                  class="scroll-down-btn"
                  aria-label="Scroll to bottom"
                  @click="scrollToBottom"
                >
                  <ArrowDown :size="16" :stroke-width="2.5" />
                </button>
              </Transition>

              <div class="center-col">
                <ChatInput
                  :is-streaming="activeTab.isStreaming"
                  @send="send"
                  @stop="stop"
                />
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <div
        v-if="activeBrowserOwner.isPanelOpen"
        class="chat-split-handle"
        :class="{ 'chat-split-handle--active': dragging }"
        @mousedown="onDragStart"
      />

      <div v-if="activeBrowserOwner.isPanelOpen" class="chat-browser-panel">
        <BrowserPane :owner-id="activeTab.id" />
      </div>
    </div>

    <AttachmentPreview
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="previewAttachment = null"
    />
  </div>
</template>

<style scoped>
.chat-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

.chat-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-body--dragging {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}

.chat-main-panel {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.chat-browser-panel {
  flex: 1;
  min-width: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
}

.chat-split-handle {
  position: relative;
  width: 1px;
  background: var(--color-border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 20;
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.chat-split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}

.chat-split-handle:hover,
.chat-split-handle--active {
  background: var(--color-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.center-col {
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
  padding-inline: 20px;
}

.landing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  overflow: hidden;
}

.landing .weather-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.landing .center-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: relative;
  z-index: 1;
}

.conversation {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.thread-container {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.thread {
  flex: 1;
  overflow-y: auto;
  padding-top: 32px;
  padding-bottom: 48px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}

.thread-inner {
  width: 100%;
  max-width: 670px;
  margin-inline: auto;
  padding-inline: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.scroll-blur-top,
.scroll-blur-bottom {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 5;
}

.scroll-blur-top {
  top: 0;
  height: 32px;
  background: linear-gradient(to bottom, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
}

.scroll-blur-bottom {
  bottom: 0;
  height: 48px;
  background: linear-gradient(to top, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to top, black 0%, transparent 100%);
  mask-image: linear-gradient(to top, black 0%, transparent 100%);
}

.convo-input-wrap {
  position: relative;
  flex-shrink: 0;
  padding-block: 10px 20px;
  z-index: 10;
}

.scroll-down-btn {
  position: absolute;
  top: -46px;
  left: 50%;
  transform: translate(-50%, 0) scale(1);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-mid);
  color: var(--color-text-tertiary);
  cursor: pointer;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.04),
    0 0 0 1px color-mix(in srgb, var(--color-accent-bright) 10%, transparent);
  z-index: 10;
  will-change: transform, opacity;
  transition:
    background 150ms ease,
    color 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.scroll-down-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.sa-scroll-down-btn {
  top: auto;
  bottom: 10px;
}

.sa-footer {
  display: flex;
  justify-content: center;
  padding: 12px 0 24px;
  flex-shrink: 0;
  background: var(--color-bg-base);
  position: relative;
  z-index: 10;
}

.sa-footer-inner {
  width: 100%;
  max-width: 720px;
  padding: 0 20px;
  display: flex;
  align-items: center;
}

.sa-footer-parent-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.sa-footer-parent-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  border-color: var(--color-border-mid);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.sa-footer-orphan {
  font-size: 13px;
  color: var(--color-text-dim);
  font-style: italic;
  padding-left: 4px;
}

.sa-footer-spacer {
  flex: 1;
}

.sa-footer-stop {
  display: flex;
  align-items: center;
  height: 34px;
  padding-inline: 16px;
  border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger-text);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 110ms ease,
    border-color 110ms ease;
}

.sa-footer-stop:hover {
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
}

.sa-footer-done {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sa-footer-done--done {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success-text);
  border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
}

.sa-footer-done--error {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger-text);
  border: 1px solid color-mix(in srgb, var(--color-danger) 20%, transparent);
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.btn-pop-enter-active {
  transition:
    opacity 250ms ease-out,
    transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.btn-pop-leave-active {
  transition:
    opacity 200ms ease-in,
    transform 200ms ease-in;
}

.btn-pop-enter-from,
.btn-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px) scale(0.85);
}
</style>
