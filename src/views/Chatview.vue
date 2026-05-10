<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import type { ChatMode } from '@/utils/ai'
import { ArrowDown, Square } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import AttachmentPreview from '@/components/chat/AttachmentPreview.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import WeatherBackground from '@/components/chat/Illu_1.vue'
import MessageThread from '@/components/chat/MessageThread.vue'
import SubAgentBanner from '@/components/chat/SubAgentBanner.vue'
import TabBar from '@/components/chat/TabBar.vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const { activeId, activeTab } = storeToRefs(chat)

// ── auto-scroll & scroll button ───────────────────────────────────────────────
const threadRef = ref<HTMLElement | null>(null)
const showScrollButton = ref(false)

function onScroll(e: Event) {
  const target = e.target as HTMLElement
  // Show button if scrolled up more than 100px from the bottom
  const distance = target.scrollHeight - target.scrollTop - target.clientHeight
  showScrollButton.value = distance > 100
}

function scrollToBottom() {
  if (threadRef.value) {
    // Smooth scroll down to the bottom
    threadRef.value.scrollTo({
      top: threadRef.value.scrollHeight,
      behavior: 'smooth',
    })
    showScrollButton.value = false
  }
}

// Evaluate scroll state when switching tabs
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
    // Auto-scroll instantly during streams if the user hasn't scrolled up
    if (threadRef.value && !showScrollButton.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  },
)

// ── send / stop ───────────────────────────────────────────────────────────────
function send(text: string, mode: ChatMode, attachments: Attachment[]) {
  chat.sendMessage(text, mode, attachments.length > 0 ? attachments : undefined)
}

function stop() {
  chat.stopGeneration()
}

// ── attachment preview ────────────────────────────────────────────────────────
const previewAttachment = ref<Attachment | null>(null)

// ── sub-agent tab helpers ─────────────────────────────────────────────────────

const isSubAgentTab = computed(() => !!activeTab.value.subAgent)

/** Navigate to the parent tab that spawned this sub-agent (if still open). */
function goToParent() {
  const parentId = activeTab.value.subAgent?.parentTabId
  if (!parentId)
    return
  const parentTab = chat.tabs.find(t => t.id === parentId)
  if (parentTab)
    chat.activeId = parentId
}

const parentTabExists = computed(() => {
  const parentId = activeTab.value.subAgent?.parentTabId
  return !!parentId && chat.tabs.some(t => t.id === parentId)
})
</script>

<template>
  <div class="chat-root">
    <TabBar />

    <div class="chat-body">
      <Transition name="fade" mode="out-in">
        <!-- Landing (empty normal tab) -->
        <div v-if="activeTab.messages.length === 0 && !isSubAgentTab" key="landing" class="landing">
          <WeatherBackground />
          <div class="center-col">
            <ChatInput
              :is-streaming="activeTab.isStreaming"
              @send="send"
              @stop="stop"
            />
          </div>
        </div>

        <!-- Sub-agent conversation -->
        <div v-else-if="isSubAgentTab" key="subagent" class="conversation">
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

          <!-- Sub-agent footer (read-only — no ChatInput) -->
          <div class="sa-footer">
            <div class="sa-footer-inner">
              <button
                v-if="parentTabExists"
                class="sa-footer-parent-btn"
                title="Go to the tab that spawned this agent"
                @click="goToParent"
              >
                ← Back to parent
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

        <!-- Normal conversation -->
        <div v-else key="conversation" class="conversation">
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
          <!-- Attachment preview modal (thread-level) -->
          <AttachmentPreview
            v-if="previewAttachment"
            :attachment="previewAttachment"
            @close="previewAttachment = null"
          />
        </div>
      </Transition>
    </div>
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

.center-col {
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
  padding-inline: 20px;
}

/* ── tab bar ──────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  padding-inline: 8px 4px;
  background: var(--color-bg-surface);
  box-shadow: inset 0 -1px 0 var(--color-border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-list {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 140px;
  min-width: 140px;
  height: 30px;
  padding-inline: 10px 8px;
  border-top: 1px solid transparent;
  border-left: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 450;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}
.tab:not(.tab--active):hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab--active {
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  border-top-color: var(--color-border-subtle);
  border-left-color: var(--color-border-subtle);
  border-right-color: var(--color-border-subtle);
  border-bottom-color: var(--color-bg-base);
  cursor: default;
}
.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-close {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}
.tab:not(.tab--active):hover .tab-close,
.tab--active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tab-streaming-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-bright);
  flex-shrink: 0;
  animation: tab-pulse 1.4s ease-in-out infinite;
}
@keyframes tab-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.65);
  }
}

.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.tab-new:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab-new--hidden {
  opacity: 0;
  pointer-events: none;
}

/* ── body ─────────────────────────────────────────────────────────────────── */
.chat-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* ── landing ──────────────────────────────────────────────────────────────── */
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

/* ── conversation ─────────────────────────────────────────────────────────── */
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
  padding-bottom: 48px; /* Extra space to ensure bottom messages clear the blur */
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

/* ── Blurs ────────────────────────────────────────────────────────────────── */
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

/* ── input bar & scroll button ────────────────────────────────────────────── */
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
  transform: translate(-50%, 0) scale(1); /* Explicit resting state */
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
  will-change: transform, opacity; /* Fixes layout jank on pop-in */
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
  bottom: 10px;
  top: auto;
}

/* ── sub-agent footer ────────────────────────────────────────────────────── */
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

/* ── transitions ──────────────────────────────────────────────────────────── */
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

.msg-enter-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* Scroll Button extremely smooth spring transition */
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
