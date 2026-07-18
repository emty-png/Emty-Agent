<script setup lang="ts">
import type { Attachment, ChatTab } from '@/stores/chat/types'
import { ArrowDown } from 'lucide-vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'

import AttachmentPreview from '@/components/chat/chat-input/AttachmentPreview.vue'
import ChatInput from '@/components/chat/chat-input/ChatInput.vue'
import WeatherBackground from '@/components/chat/layout/IllustrationBackground.vue'
import MessageThread from '@/components/chat/messages/MessageThread.vue'
import DesignCanvas from '@/components/design/DesignCanvas.vue'

import { useChatStore } from '@/stores/chat'
import { useThemeStore } from '@/stores/themes'

const props = defineProps<{
  tab: ChatTab
}>()

const chat = useChatStore()
const theme = useThemeStore()
const previewAttachment = ref<Attachment | null>(null)

// ── Resizable split ───────────────────────────────────────────────────────────

const SPLIT_MIN = 30
const SPLIT_MAX = 70
const SPLIT_DEFAULT = 45

const splitPercent = ref(SPLIT_DEFAULT)
const horizontalDragging = ref(false)

const dynamicSplitMin = computed(() => SPLIT_MIN)
const dynamicSplitMax = computed(() => SPLIT_MAX)

const leftPaneStyle = computed(() => ({
  flex: `0 0 ${splitPercent.value}%`,
  maxWidth: `${splitPercent.value}%`,
}))

let rafId: number | null = null
let lastMoveEvent: MouseEvent | PointerEvent | null = null
const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window

function handleMoveEvent(event: MouseEvent | PointerEvent) {
  lastMoveEvent = event
  if (rafId !== null)
    return

  rafId = requestAnimationFrame(() => {
    if (!lastMoveEvent) {
      rafId = null
      return
    }

    const evt = lastMoveEvent as MouseEvent | PointerEvent
    if (horizontalDragging.value) {
      const raw = (evt.clientX / window.innerWidth) * 100
      splitPercent.value = Math.min(dynamicSplitMax.value, Math.max(dynamicSplitMin.value, raw))
    }
    rafId = null
  })
}

function addMoveListeners() {
  if (supportsPointer) {
    window.addEventListener('pointermove', handleMoveEvent)
    window.addEventListener('pointerup', onPointerUp)
  }
  else {
    window.addEventListener('mousemove', handleMoveEvent as EventListener)
    window.addEventListener('mouseup', onPointerUp as EventListener)
  }
}

function removeMoveListeners() {
  if (supportsPointer) {
    window.removeEventListener('pointermove', handleMoveEvent)
    window.removeEventListener('pointerup', onPointerUp)
  }
  else {
    window.removeEventListener('mousemove', handleMoveEvent as EventListener)
    window.removeEventListener('mouseup', onPointerUp as EventListener)
  }
}

function onDragStart(event: MouseEvent | PointerEvent) {
  event.preventDefault()
  horizontalDragging.value = true
  addMoveListeners()
}

function onPointerUp() {
  horizontalDragging.value = false
  lastMoveEvent = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  removeMoveListeners()
}

onUnmounted(() => {
  lastMoveEvent = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  removeMoveListeners()
})

// ── Thread scrolling ──────────────────────────────────────────────────────────

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

let scrollRafId: number | null = null

watch(
  () => [
    props.tab.messages.length,
    props.tab.messages.at(-1)?.content?.length,
    props.tab.messages.at(-1)?.toolEvents?.length,
  ],
  () => {
    if (scrollRafId !== null)
      cancelAnimationFrame(scrollRafId)
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      if (threadRef.value && !showScrollButton.value) {
        threadRef.value.scrollTop = threadRef.value.scrollHeight
      }
    })
  },
)

// ── Actions ───────────────────────────────────────────────────────────────────

function send(text: string, attachments: Attachment[] = []) {
  chat.sendMessage(text, props.tab.mode, attachments.length > 0 ? attachments : undefined)
}

function stop() {
  chat.stopGeneration(props.tab.id)
}

function updateActiveDesign(id: string) {
  const tab = chat.tabs.find(t => t.id === props.tab.id)
  if (tab)
    tab.activeDesignId = id
}
</script>

<template>
  <div class="design-view-root" :class="{ 'design-view-root--dragging': horizontalDragging }">
    <!-- Landing State -->
    <Transition name="fade" mode="out-in">
      <div v-if="tab.messages.length === 0" key="landing" class="landing">
        <WeatherBackground v-if="theme.showLandingArt" />
        <div class="center-col">
          <ChatInput
            :agent-status="tab.agentStatus"
            :show-project-picker="false"
            @send="send"
            @stop="stop"
          />
        </div>
      </div>

      <!-- Active State (Split View) -->
      <div v-else key="active" class="active-split">
        <!-- Left Pane: Thread -->
        <div class="left-pane" :style="leftPaneStyle">
          <div class="thread-container">
            <div class="scroll-blur-top" />

            <div ref="threadRef" class="thread" @scroll="onScroll">
              <div class="thread-inner">
                <MessageThread
                  :messages="tab.messages"
                  :agent-status="tab.agentStatus"
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
                :agent-status="tab.agentStatus"
                :show-project-picker="false"
                :show-estimator="true"
                @send="send"
                @stop="stop"
              />
            </div>
          </div>
        </div>

        <!-- Split Handle -->
        <div
          class="split-handle"
          :class="{ 'split-handle--active': horizontalDragging }"
          @mousedown="onDragStart"
        />

        <!-- Right Pane: Canvas -->
        <div class="right-pane">
          <DesignCanvas
            :designs="tab.designs ?? []"
            :active-design-id="tab.activeDesignId ?? null"
            @update:active-design-id="updateActiveDesign"
          />
        </div>
      </div>
    </Transition>

    <AttachmentPreview
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="previewAttachment = null"
    />
  </div>
</template>

<style scoped>
.design-view-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
  position: relative;
}

.design-view-root--dragging {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}

/* ── Landing ───────────────────────────────────────────────────────────────── */
.landing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  overflow: hidden;
}

.landing .center-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: relative;
  z-index: 1;
}

/* ── Active Split ──────────────────────────────────────────────────────────── */
.active-split {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
}

.left-pane {
  display: flex;
  flex-direction: column;
  min-width: 320px;
  z-index: 10;
}

.split-handle {
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

.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}

.split-handle:hover,
.split-handle--active {
  background: var(--color-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.right-pane {
  flex: 1;
  min-width: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Thread & Input ────────────────────────────────────────────────────────── */
.center-col {
  width: 100%;
  max-width: min(720px, 90%);
  margin-inline: auto;
  padding-inline: 20px;
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
  max-width: min(670px, 90%);
  margin-inline: auto;
  padding-inline: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  border-radius: var(--radius-lg);
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

/* ── Transitions ───────────────────────────────────────────────────────────── */
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
