<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { ArrowDown, Square } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BrowserPane from '@/components/browser/BrowserPane.vue'
import AttachmentPreview from '@/components/chat/chat-input/AttachmentPreview.vue'
import ChatInput from '@/components/chat/chat-input/ChatInput.vue'
import SubAgentBanner from '@/components/chat/layout/SubAgentBanner.vue'
import { useIllustrationComponent } from '@/components/chat/layout/useIllustration'
import MessageThread from '@/components/chat/messages/MessageThread.vue'
import TabBar from '@/components/chat/tabs/TabBar.vue'
import GitPane from '@/components/sidepane/GitPane.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agentStatus'
import { resolveTabWorkspacePath } from '@/stores/chat/workspace'
import { useGitPaneStore } from '@/stores/gitPane'
import { useProjectStore } from '@/stores/project'
import { useTerminalStore } from '@/stores/terminal'
import { useThemeStore } from '@/stores/themes'
import DesignView from '@/views/DesignView.vue'

const SPLIT_MIN = 35
const SPLIT_MAX = 70
const SPLIT_DEFAULT = 35
const TERMINAL_SPLIT_MIN = 18
const TERMINAL_SPLIT_MAX = 50

const chat = useChatStore()
const browser = useBrowserStore()
const gitPane = useGitPaneStore()
const project = useProjectStore()
const terminal = useTerminalStore()
const { illustrationComponent } = useIllustrationComponent()
const theme = useThemeStore()
const { activeId, activeTab } = storeToRefs(chat)

const containerRef = ref<HTMLElement | null>(null)
const mainPanelRef = ref<HTMLElement | null>(null)
const horizontalDragging = ref(false)
const terminalDragging = ref(false)

const activeBrowserOwner = computed(() => browser.getOwner(activeId.value))
const activeGitOwner = computed(() => gitPane.getOwner(activeId.value))
const activeTerminalOwner = computed(() => terminal.getOwner(activeId.value))
const terminalInRightPane = computed(() =>
  activeTerminalOwner.value.isPanelOpen && activeTerminalOwner.value.position === 'right' && activeTerminalOwner.value.sessions.length > 0,
)
const hasRightPane = computed(() =>
  activeBrowserOwner.value.isPanelOpen || activeGitOwner.value.isPanelOpen || terminalInRightPane.value,
)
const hasTerminalPane = computed(() =>
  activeTerminalOwner.value.isPanelOpen && activeTerminalOwner.value.position === 'bottom' && activeTerminalOwner.value.sessions.length > 0,
)

const containerWidth = ref(0)
let containerResizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    containerResizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        containerWidth.value = entries[0].contentRect.width
      }
    })
    containerResizeObserver.observe(containerRef.value)
  }
})

const MIN_MAIN_WIDTH = 400
const MIN_SIDE_WIDTH = 320

const dynamicSplitMin = computed(() => {
  if (!containerWidth.value)
    return SPLIT_MIN
  const minPercent = (MIN_MAIN_WIDTH / containerWidth.value) * 100
  return Math.max(SPLIT_MIN, minPercent)
})

const dynamicSplitMax = computed(() => {
  if (!containerWidth.value)
    return SPLIT_MAX
  const maxPercent = ((containerWidth.value - MIN_SIDE_WIDTH) / containerWidth.value) * 100
  return Math.max(dynamicSplitMin.value, Math.min(SPLIT_MAX, maxPercent))
})

const resolvedWorkspacePath = computed(() => resolveTabWorkspacePath(activeTab.value, project.projectPath))

const splitPercent = computed(() => {
  if (activeGitOwner.value.isPanelOpen) {
    const stored = activeGitOwner.value.splitPercent || SPLIT_DEFAULT
    return Math.min(dynamicSplitMax.value, Math.max(dynamicSplitMin.value, stored))
  }
  if (activeBrowserOwner.value.isPanelOpen) {
    const stored = activeBrowserOwner.value.splitPercent || SPLIT_DEFAULT
    return Math.min(dynamicSplitMax.value, Math.max(dynamicSplitMin.value, stored))
  }
  const stored = activeTerminalOwner.value.splitPercent || SPLIT_DEFAULT
  return Math.min(dynamicSplitMax.value, Math.max(dynamicSplitMin.value, stored))
})
const mainPaneStyle = computed(() => {
  if (!hasRightPane.value)
    return undefined

  return {
    flex: `0 0 ${splitPercent.value}%`,
    maxWidth: `${splitPercent.value}%`,
  }
})
const terminalHeightPercent = computed(() =>
  Math.min(
    TERMINAL_SPLIT_MAX,
    Math.max(TERMINAL_SPLIT_MIN, activeTerminalOwner.value.heightPercent || TERMINAL_SPLIT_MIN),
  ),
)
const mainContentStyle = computed(() => {
  if (!hasTerminalPane.value)
    return undefined

  return {
    height: `${100 - terminalHeightPercent.value}%`,
  }
})
const terminalPanelStyle = computed(() => {
  if (!hasTerminalPane.value)
    return undefined

  return {
    height: `${terminalHeightPercent.value}%`,
  }
})

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

    if (horizontalDragging.value && containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      const raw = ((evt.clientX - rect.left) / rect.width) * 100
      const next = Math.min(dynamicSplitMax.value, Math.max(dynamicSplitMin.value, raw))
      if (activeGitOwner.value.isPanelOpen)
        gitPane.setSplitPercent(activeId.value, next)
      else if (activeBrowserOwner.value.isPanelOpen)
        browser.setSplitPercent(activeId.value, next)
      else
        terminal.setSplitPercent(activeId.value, next)
      rafId = null
      return
    }

    if (terminalDragging.value && mainPanelRef.value) {
      const rect = mainPanelRef.value.getBoundingClientRect()
      const raw = ((rect.bottom - (evt as MouseEvent).clientY) / rect.height) * 100
      terminal.setHeightPercent(
        activeId.value,
        Math.min(TERMINAL_SPLIT_MAX, Math.max(TERMINAL_SPLIT_MIN, raw)),
      )
    }

    rafId = null
  })
}

function addMoveListeners() {
  if (typeof window === 'undefined')
    return

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
  if (typeof window === 'undefined')
    return

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
  if (!hasRightPane.value)
    return

  event.preventDefault()
  horizontalDragging.value = true
  addMoveListeners()
}

function onTerminalDragStart(event: MouseEvent | PointerEvent) {
  if (!hasTerminalPane.value)
    return

  event.preventDefault()
  terminalDragging.value = true
  addMoveListeners()
}

function onPointerUp() {
  horizontalDragging.value = false
  terminalDragging.value = false
  lastMoveEvent = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  removeMoveListeners()
}

onUnmounted(() => {
  // Ensure any listeners/frames are cleaned up if component is destroyed while dragging
  lastMoveEvent = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  removeMoveListeners()

  if (containerResizeObserver) {
    containerResizeObserver.disconnect()
    containerResizeObserver = null
  }
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

let scrollRafId: number | null = null

watch(
  () => [
    activeTab.value.messages.length,
    activeTab.value.messages.at(-1)?.content?.length,
    activeTab.value.messages.at(-1)?.toolEvents?.length,
  ],
  () => {
    if (scrollRafId !== null)
      cancelAnimationFrame(scrollRafId)

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      if (threadRef.value && !showScrollButton.value)
        threadRef.value.scrollTop = threadRef.value.scrollHeight
    })
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

// Mutual exclusivity: when Git/Browser opens, move terminal back to bottom.
watch([() => activeBrowserOwner.value.isPanelOpen, () => activeGitOwner.value.isPanelOpen], ([browserOpen, gitOpen]) => {
  if ((browserOpen || gitOpen) && activeTerminalOwner.value.position === 'right') {
    terminal.setTerminalPosition(activeId.value, 'bottom')
  }
})
</script>

<template>
  <div class="chat-root">
    <TabBar />

    <div
      ref="containerRef"
      class="chat-body"
      :class="{ 'chat-body--dragging': horizontalDragging }"
    >
      <div
        ref="mainPanelRef"
        class="chat-main-panel"
        :class="{ 'chat-main-panel--dragging': terminalDragging }"
        :style="mainPaneStyle"
      >
        <div class="chat-main-content" :style="mainContentStyle">
          <!-- Design mode layout -->
          <DesignView
            v-if="activeTab && activeTab.isDesignTab"
            :key="`design-${activeTab.id}`"
            :tab="activeTab"
          />
          <!-- Normal chat layout -->
          <Transition v-else-if="activeTab" name="fade" mode="out-in">
            <div
              v-if="activeTab.messages.length === 0 && !isSubAgentTab"
              :key="`landing-${activeTab.id}`"
              class="landing"
            >
              <component :is="illustrationComponent" v-if="theme.showLandingArt" />
              <div class="center-col">
                <ChatInput
                  :agent-status="activeTab.agentStatus"
                  :show-project-picker="true"
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
              <div class="thread-container">
                <div class="scroll-blur-top" />

                <div ref="threadRef" class="thread" @scroll="onScroll">
                  <SubAgentBanner :sub-agent="activeTab.subAgent!" />
                  <div class="thread-inner">
                    <MessageThread
                      :messages="activeTab.messages"
                      :agent-status="activeTab.agentStatus"
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
                    v-if="isStreamingStatus(activeTab.agentStatus)"
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
                      :agent-status="activeTab.agentStatus"
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
                    :agent-status="activeTab.agentStatus"
                    :show-project-picker="false"
                    :show-estimator="true"
                    @send="send"
                    @stop="stop"
                  />
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <div
          v-if="hasTerminalPane"
          class="chat-terminal-split-handle"
          :class="{ 'chat-terminal-split-handle--active': terminalDragging }"
          @mousedown="onTerminalDragStart"
        />

        <div v-if="hasTerminalPane" class="chat-terminal-panel" :style="terminalPanelStyle">
          <TerminalPane
            :owner-id="activeId"
            :cwd="resolvedWorkspacePath"
            @close="terminal.closePanel(activeId)"
          />
        </div>
      </div>

      <div
        v-if="hasRightPane"
        class="chat-split-handle"
        :class="{ 'chat-split-handle--active': horizontalDragging }"
        @mousedown="onDragStart"
      />

      <div v-if="activeBrowserOwner.isPanelOpen" class="chat-browser-panel">
        <BrowserPane :owner-id="activeTab.id" />
      </div>

      <div v-else-if="activeGitOwner.isPanelOpen && resolvedWorkspacePath" class="chat-git-panel">
        <GitPane :cwd="resolvedWorkspacePath" :messages="activeTab.messages" :tab-id="activeTab.id" @close="gitPane.closePanel(activeId)" />
      </div>

      <div v-else-if="terminalInRightPane" class="chat-terminal-right-panel">
        <TerminalPane
          :owner-id="activeId"
          :cwd="resolvedWorkspacePath"
          @close="terminal.closePanel(activeId)"
        />
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
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  z-index: 30;
}

.chat-main-panel--dragging {
  cursor: row-resize;
  user-select: none;
  -webkit-user-select: none;
}

.chat-main-content {
  position: relative;
  flex: 1;
  min-height: 0;
}

.chat-browser-panel {
  flex: 1;
  min-width: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
}

.chat-git-panel {
  flex: 1;
  min-width: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
  position: relative;
}

.chat-split-handle {
  position: relative;
  width: 2px;
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

.chat-terminal-split-handle {
  position: relative;
  height: 1px;
  background: var(--color-border-subtle);
  cursor: row-resize;
  flex-shrink: 0;
  z-index: 20;
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.chat-terminal-split-handle::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -4px;
  bottom: -4px;
}

.chat-terminal-split-handle:hover,
.chat-terminal-split-handle--active {
  background: var(--color-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.chat-terminal-panel {
  min-height: 140px;
  overflow: hidden;
  background: var(--color-bg-base);
}

.chat-terminal-right-panel {
  flex: 1;
  min-width: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
}

.center-col {
  width: 100%;
  max-width: min(720px, 90%);
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
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-lg);
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
