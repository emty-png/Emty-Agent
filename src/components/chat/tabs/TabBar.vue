<script setup lang="ts">
import { ChevronLeft, ChevronRight, Globe, PanelRightClose, PanelRightOpen, Plus, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { useGitPaneStore } from '@/stores/gitPane'

const chat = useChatStore()
const browser = useBrowserStore()
const gitPane = useGitPaneStore()
const { tabs, activeId } = storeToRefs(chat)

const activeBrowserOwner = computed(() => browser.getOwner(activeId.value))
const activeGitOwner = computed(() => gitPane.getOwner(activeId.value))

function toggleBrowser() {
  if (activeBrowserOwner.value.isPanelOpen) {
    browser.closePanel(activeId.value)
  }
  else {
    // Close git pane first (mutual exclusivity)
    gitPane.closePanel(activeId.value)
    browser.openPanel(activeId.value)
  }
}

function toggleGitPane() {
  gitPane.togglePanel(activeId.value)
}

const tabListRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const TOLERANCE = 2

let scrollRaf = 0

function updateScrollState() {
  const el = tabListRef.value
  if (!el)
    return
  canScrollLeft.value = el.scrollLeft > TOLERANCE
  canScrollRight.value = el.scrollWidth - el.scrollLeft - el.clientWidth > TOLERANCE
}

function onScroll() {
  cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(updateScrollState)
}

function scrollTabsLeft() {
  tabListRef.value?.scrollBy({ left: -200, behavior: 'smooth' })
}

function scrollTabsRight() {
  tabListRef.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

// flush:'post' runs after Vue has committed DOM changes — scrollWidth is accurate immediately,
// no nextTick dance needed.
watch(tabs, updateScrollState, { flush: 'post' })

onMounted(() => {
  const el = tabListRef.value
  if (el) {
    // ResizeObserver handles container width changes (window resize, panel open/close, etc.)
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(updateScrollState)
    })
    resizeObserver.observe(el)

    // MutationObserver fires synchronously when child elements are added/removed.
    // ResizeObserver won't catch overflow because the tab-list's clientWidth stays
    // fixed (flex:1) — only scrollWidth grows. This covers that gap instantly.
    mutationObserver = new MutationObserver(updateScrollState)
    mutationObserver.observe(el, { childList: true })

    updateScrollState()
  }
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
})
</script>

<template>
  <div class="tab-bar">
    <!-- Scrollable tab strip: left arrow · tabs · right arrow -->
    <!-- Arrows are inside the strip so the fade overlays clip correctly -->
    <div class="tab-strip">
      <button
        v-show="canScrollLeft"
        class="tab-scroll-btn tab-scroll-btn--left"
        aria-label="Scroll tabs left"
        @click="scrollTabsLeft"
      >
        <ChevronLeft :size="14" :stroke-width="2" />
      </button>

      <div ref="tabListRef" class="tab-list" @scroll="onScroll">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{
            'tab--active': tab.id === activeId,
            'tab--subagent': !!tab.subAgent,
          }"
          @click="activeId = tab.id"
        >
          <span v-if="tab.isStreaming" class="tab-streaming-dot" />
          <span class="tab-title">{{ tab.title }}</span>
          <span
            class="tab-close"
            role="button"
            aria-label="Close tab"
            @click.stop="chat.closeTab(tab.id)"
          >
            <X :size="11" :stroke-width="2" />
          </span>
        </button>
      </div>

      <button
        v-show="canScrollRight"
        class="tab-scroll-btn tab-scroll-btn--right"
        aria-label="Scroll tabs right"
        @click="scrollTabsRight"
      >
        <ChevronRight :size="14" :stroke-width="2" />
      </button>
    </div>

    <!-- Action buttons: always anchored to the right, outside the scrollable strip -->
    <div class="tab-actions">
      <button
        class="tab-action-btn"
        aria-label="New chat"
        @click="chat.addTab"
      >
        <Plus :size="14" :stroke-width="1.8" />
      </button>

      <div class="tab-actions-divider" />

      <button
        class="tab-action-btn"
        :class="{ 'tab-action-btn--active': activeBrowserOwner.isPanelOpen }"
        aria-label="Toggle embedded browser"
        title="Toggle embedded browser"
        @click="toggleBrowser"
      >
        <Globe :size="14" :stroke-width="1.8" />
      </button>

      <button
        class="tab-action-btn"
        :class="{ 'tab-action-btn--active': activeGitOwner.isPanelOpen }"
        aria-label="Git Menu"
        title="Git Menu"
        @click="toggleGitPane"
      >
        <span class="icon-swap">
          <PanelRightClose
            :size="14"
            :stroke-width="1.8"
            class="icon-swap__icon"
            :class="[{ 'icon-swap__icon--hidden': activeGitOwner.isPanelOpen }]"
          />
          <PanelRightOpen
            :size="14"
            :stroke-width="1.8"
            class="icon-swap__icon icon-swap__icon--back"
            :class="[{ 'icon-swap__icon--hidden': !activeGitOwner.isPanelOpen }]"
          />
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  padding-inline: 8px 4px;
  background: var(--color-bg-surface);
  box-shadow: inset 0 -1px 0 var(--color-border-subtle);
}

/* ── Tab strip (left arrow · scrollable tabs · right arrow) ──────────── */

.tab-strip {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
  /* No overflow:hidden here — scroll-btn fade pseudo-elements must bleed in */
}

.tab-list {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tab-list::-webkit-scrollbar {
  display: none;
}

/* ── Individual tab ──────────────────────────────────────────────────── */

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
  border-radius: var(--radius-sm);
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

/* ── Streaming dot ───────────────────────────────────────────────────── */

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

/* ── Scroll arrows ───────────────────────────────────────────────────── */

.tab-scroll-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 26px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  z-index: 2;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.tab-scroll-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

/* Left arrow: tight, strong fade — extended to cover full tab height */
.tab-scroll-btn--left::after {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -4px;
  right: -12px;
  width: 12px;
  background: linear-gradient(to right, var(--color-bg-surface) 30%, transparent 100%);
  pointer-events: none;
}

/* Right arrow: tight, strong fade — extended to cover full tab height */
.tab-scroll-btn--right::before {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -4px;
  left: -12px;
  width: 12px;
  background: linear-gradient(to left, var(--color-bg-surface) 30%, transparent 100%);
  pointer-events: none;
}

/* ── Action buttons (+ · divider · Globe · Git) ──────────────────────── */

.tab-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  padding-bottom: 4px;
  padding-left: 2px;
}

.tab-actions-divider {
  width: 1px;
  height: 14px;
  background: var(--color-border-subtle);
  margin-inline: 3px;
  flex-shrink: 0;
}

.tab-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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
.tab-action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab-action-btn--active {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent-text);
}

.icon-swap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.icon-swap__icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 200ms ease;
}

.icon-swap__icon--hidden {
  opacity: 0;
  pointer-events: none;
}
</style>
