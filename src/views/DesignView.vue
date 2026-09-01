<script setup lang="ts">
import type { Attachment, ChatTab, DesignVersionRef } from '@/stores/chat/core/types'
import { ArrowDown } from 'lucide-vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'

import AttachmentPreview from '@/components/chat/chat-input/AttachmentPreview.vue'
import ChatInput from '@/components/chat/chat-input/ChatInput.vue'
import MessageThread from '@/components/chat/messages/MessageThread.vue'
import DesignCanvas from '@/components/design/DesignCanvas.vue'
import DesignVersionBanner from '@/components/design/DesignVersionBanner.vue'
import DesignVersionCompareModal from '@/components/design/DesignVersionCompareModal.vue'
import DesignVersionModal from '@/components/design/DesignVersionModal.vue'
import { useIllustrationComponent } from '@/composables/ui/useIllustration'

import { useChatStore } from '@/stores/chat'
import { useDesignVersionStore } from '@/stores/designVersions'
import { useThemeStore } from '@/stores/themes'

const props = defineProps<{
  tab: ChatTab
}>()

const { illustrationComponent } = useIllustrationComponent()
const chat = useChatStore()
const theme = useThemeStore()
const dvStore = useDesignVersionStore()
const previewAttachment = ref<Attachment | null>(null)

// ── Hydrate manifest for new multi-screen designs ────────────────────────────

async function ensureManifest() {
  const tabAny = props.tab as unknown as { activeDesign?: { name: string; path: string }; designManifest?: unknown }
  const activeDesign = tabAny.activeDesign ?? (props.tab.activeDesignProject ? { name: props.tab.activeDesignProject.name, path: props.tab.activeDesignProject.path } : null)
  if (!activeDesign?.name || tabAny.designManifest)
    return
  try {
    const { readDesignManifest } = await import('@/utils/tools/designProject')
    const m = await readDesignManifest(activeDesign.name)
    if (m) {
      ;(props.tab as unknown as { designManifest?: import('@/stores/chat/core/types').DesignManifest }).designManifest = { design: m.design, screens: m.screens, connections: m.connections, updatedAt: m.updatedAt, ...(m.viewports ? { viewports: m.viewports } : {}) }
      ;(props.tab as unknown as { designScreens?: Array<{ name: string; path: string }> }).designScreens = m.screens.map(s => ({ name: s, path: `${activeDesign.path}/${s}` }))
    }
  }
  catch {}
}

watch(() => (props.tab as unknown as { activeDesign?: { name: string } }).activeDesign?.name ?? props.tab.activeDesignProject?.name ?? '', () => { void ensureManifest() }, { immediate: true })
watch(() => props.tab.projectVersion ?? 0, () => { void ensureManifest() })

// ── Design version preview ──────────────────────────────────────────────────

const previewVersionId = ref<string | null>(null)
const compareAId = ref<string | null>(null)
const compareBId = ref<string | null>(null)
const showVersionModal = ref(false)
const showCompareModal = ref(false)

const previewVersion = computed<DesignVersionRef | null>(() => {
  if (!previewVersionId.value)
    return null
  const list = (dvStore.versionsByConversation[props.tab.conversationId ?? ''] ?? props.tab.designVersions ?? []) as DesignVersionRef[]
  return list.find(v => v.id === previewVersionId.value) ?? (dvStore.getByMessageId(previewVersionId.value) as unknown as DesignVersionRef | null) ?? null
})

function onPreviewVersion(versionId: string) {
  // toggle: clicking same version exits preview
  if (previewVersionId.value === versionId) {
    previewVersionId.value = null
    dvStore.setPreview(props.tab.id, null)
    return
  }
  // If compare modal open, set as A
  if (showCompareModal.value) {
    compareAId.value = versionId
    return
  }
  previewVersionId.value = versionId
  dvStore.setPreview(props.tab.id, versionId)
}

function onCompareVersion(versionId: string) {
  compareAId.value = versionId
  compareBId.value = null
  showCompareModal.value = true
}

function exitPreview() {
  previewVersionId.value = null
  dvStore.setPreview(props.tab.id, null)
}

async function restorePreview() {
  if (!previewVersion.value)
    return
  const res = await dvStore.restoreVersion(props.tab, previewVersion.value.id)
  if (res.ok)
    exitPreview()
}

function onModalRestore(id: string) {
  void dvStore.restoreVersion(props.tab, id).then(res => {
    if (res.ok) {
      showVersionModal.value = false
      showCompareModal.value = false
      exitPreview()
    }
  })
}

watch(() => props.tab.id, () => {
  previewVersionId.value = dvStore.getPreviewId(props.tab.id)
})
watch(() => dvStore.getPreviewId(props.tab.id), v => { previewVersionId.value = v })

// ── Derived tab fields (avoid complex casts in template which vue-tsc cannot parse) ──
const tabActiveDesign = computed(() => (props.tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null)
const tabDesignManifest = computed(() => (props.tab as unknown as { designManifest?: import('@/stores/chat/core/types').DesignManifest }).designManifest ?? null)
const tabDesignScreens = computed(() => (props.tab as unknown as { designScreens?: Array<{ name: string; path: string }> }).designScreens ?? null)
const tabCompareProjectPath = computed(() => (props.tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign?.path ?? props.tab.activeDesignProject?.path ?? null)
const tabCompareViewports = computed<Record<string, { width: number; height: number; preset: string }> | null>(() => {
  const m = tabDesignManifest.value as unknown as { viewports?: Record<string, { width: number; height: number; preset: string }> } | null
  return m?.viewports ?? null
})

// ── Resizable split ───────────────────────────────────────────────────────────

const SPLIT_MIN = 30
const SPLIT_MAX = 70
const SPLIT_DEFAULT = 45

const splitPercent = ref(SPLIT_DEFAULT)
const horizontalDragging = ref(false)
const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

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

watch(isFullscreen, val => {
  if (val)
    horizontalDragging.value = false
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

const landingPrompts = [
  'Design a mobile onboarding flow for a fitness app',
  'Create login and signup screens with a shared style',
  'Design a settings screen with a dark mode toggle',
]

function send(text: string, attachments: Attachment[] = []) {
  chat.sendMessage(text, props.tab.mode, attachments.length > 0 ? attachments : undefined)
}

function stop() {
  chat.stopGeneration(props.tab.id)
}
</script>

<template>
  <div class="design-view-root" :class="{ 'design-view-root--dragging': horizontalDragging }">
    <!-- Landing State -->
    <Transition name="fade" mode="out-in">
      <div v-if="tab.messages.length === 0" key="landing" class="landing">
        <component :is="illustrationComponent" v-if="theme.showLandingArt" />
        <div class="center-col">
          <ChatInput
            :agent-status="tab.agentStatus"
            :show-project-picker="false"
            @send="send"
            @stop="stop"
          />
          <div class="landing-chips">
            <button v-for="p in landingPrompts" :key="p" class="landing-chip" @click="send(p)">
              {{ p }}
            </button>
          </div>
        </div>
      </div>

      <!-- Active State (Split View) -->
      <div v-else key="active" class="active-split" :class="{ 'active-split--fullscreen': isFullscreen }">
        <!-- Left Pane: Thread -->
        <div v-if="!isFullscreen" class="left-pane" :style="leftPaneStyle">
          <div class="thread-container">
            <div class="scroll-blur-top" />

            <div ref="threadRef" class="thread" @scroll="onScroll">
              <div class="thread-inner">
                <MessageThread
                  :messages="tab.messages"
                  :agent-status="tab.agentStatus"
                  :is-sub-agent="false"
                  @preview-attachment="previewAttachment = $event"
                  @preview-version="onPreviewVersion"
                  @compare-version="onCompareVersion"
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
          v-if="!isFullscreen"
          class="split-handle"
          :class="{ 'split-handle--active': horizontalDragging }"
          @mousedown="onDragStart"
        />

        <!-- Right Pane: Canvas -->
        <div class="right-pane">
          <DesignVersionBanner
            v-if="previewVersion"
            :version="previewVersion"
            @back="exitPreview"
            @close="exitPreview"
            @restore="restorePreview"
            @compare="onCompareVersion(previewVersion!.id)"
          />
          <DesignCanvas
            :project-version="tab.projectVersion ?? 0"
            :active-project="tab.activeDesignProject ?? null"
            :active-design="tabActiveDesign"
            :design-manifest="tabDesignManifest"
            :design-screens="tabDesignScreens"
            :tab-id="tab.id"
            :is-fullscreen="isFullscreen"
            :preview-version-id="previewVersion?.id ?? null"
            @toggle-fullscreen="toggleFullscreen"
          />
        </div>
      </div>
    </Transition>

    <AttachmentPreview
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="previewAttachment = null"
    />

    <DesignVersionModal
      :version="(showVersionModal ? previewVersion : null) as never"
      @close="showVersionModal = false"
      @restore="onModalRestore"
      @compare="onCompareVersion"
    />

    <DesignVersionCompareModal
      v-if="showCompareModal && compareAId"
      :a-id="compareAId"
      :b-id="compareBId"
      :project-path="tabCompareProjectPath"
      :viewports="tabCompareViewports"
      @close="showCompareModal = false"
      @restore="onModalRestore"
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

.landing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 2px;
}

.landing-chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border-mid);
  background: color-mix(in srgb, var(--color-bg-surface) 78%, transparent);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.landing-chip:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
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
  overflow-x: hidden;
  padding-top: 32px;
  padding-bottom: 48px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.thread::-webkit-scrollbar {
  display: none;
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
