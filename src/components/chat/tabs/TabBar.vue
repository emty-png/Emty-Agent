<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Palette, Plus, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agentStatus'
import { resolveTabWorkspacePath } from '@/stores/chat/workspace'
import { useGitPaneStore } from '@/stores/gitPane'
import { useProjectStore } from '@/stores/project'
import { useTerminalStore } from '@/stores/terminal'

const chat = useChatStore()
const browser = useBrowserStore()
const gitPane = useGitPaneStore()
const project = useProjectStore()
const terminal = useTerminalStore()
const { tabs, activeId } = storeToRefs(chat)

const activeTab = computed(() => tabs.value.find(t => t.id === activeId.value))
const isDesignTab = computed(() => activeTab.value?.isDesignTab === true)
const activeBrowserOwner = computed(() => browser.getOwner(activeId.value))
const activeGitOwner = computed(() => gitPane.getOwner(activeId.value))
const activeTerminalOwner = computed(() => terminal.getOwner(activeId.value))

function toggleBrowser() {
  if (activeBrowserOwner.value.isPanelOpen) {
    browser.closePanel(activeId.value)
  }
  else {
    gitPane.closePanel(activeId.value)
    browser.openPanel(activeId.value)
  }
}

function toggleGitPane() {
  gitPane.togglePanel(activeId.value)
}

async function toggleTerminal() {
  if (activeTerminalOwner.value.isPanelOpen) {
    terminal.closePanel(activeId.value)
    return
  }
  const tab = chat.tabs.find(t => t.id === activeId.value)
  if (!tab)
    return
  const workspacePath = resolveTabWorkspacePath(tab, project.projectPath)
  await terminal.ensureVisibleSession(activeId.value, workspacePath)
}

const tabListRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const TOLERANCE = 2

const newTabMenuOpen = ref(false)
const newTabTriggerRef = ref<HTMLElement | null>(null)
const newTabMenuRef = ref<HTMLElement | null>(null)

function toggleNewTabMenu() {
  if (newTabMenuOpen.value) {
    closeNewTabMenu()
    return
  }
  newTabMenuOpen.value = true
}

function closeNewTabMenu() {
  newTabMenuOpen.value = false
}

function handleNewTab() {
  chat.addTab()
  closeNewTabMenu()
}

function handleNewDesign() {
  chat.addDesignTab()
  closeNewTabMenu()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!newTabMenuOpen.value)
    return
  const target = event.target as Node
  if (newTabTriggerRef.value?.contains(target))
    return
  if (newTabMenuRef.value?.contains(target))
    return
  closeNewTabMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && newTabMenuOpen.value)
    closeNewTabMenu()
}

function onWindowResize() {
  if (newTabMenuOpen.value)
    closeNewTabMenu()
}

function onWheel(_e: WheelEvent) {
  if (newTabMenuOpen.value)
    closeNewTabMenu()
}

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

watch(tabs, updateScrollState, { flush: 'post' })

onMounted(() => {
  const el = tabListRef.value
  if (el) {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(updateScrollState)
    })
    resizeObserver.observe(el)

    mutationObserver = new MutationObserver(updateScrollState)
    mutationObserver.observe(el, { childList: true })

    updateScrollState()
  }

  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('wheel', onWheel, { passive: true })
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <div class="flex h-[36px] min-h-[36px] items-end bg-[var(--color-bg-surface)] px-1 [box-shadow:inset_0_-1px_0_var(--color-border-subtle)]">
    <div class="flex min-w-0 flex-1 items-end overflow-hidden">
      <button
        v-show="canScrollLeft"
        class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] after:pointer-events-none after:absolute after:-bottom-[4px] after:-right-[12px] after:-top-[2px] after:w-[12px] after:bg-gradient-to-r after:from-[var(--color-bg-surface)] after:from-[30%] after:to-transparent after:content-['']"
        aria-label="Scroll tabs left"
        @click="scrollTabsLeft"
      >
        <ChevronLeft :size="14" :stroke-width="2" />
      </button>

      <div ref="tabListRef" class="tab-list-scroll flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden" @scroll="onScroll">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="group/tab flex h-[30px] w-[140px] min-w-[140px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-t-[var(--radius-sm)] border-b border-l border-r border-t pl-[10px] pr-[8px] text-[12px] font-[450] transition-[background,color,border-color] duration-[120ms] ease-[ease]"
          :class="tab.id === activeId ? 'cursor-default border-b-[var(--color-bg-base)] border-l-[var(--color-border-subtle)] border-r-[var(--color-border-subtle)] border-t-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]' : 'cursor-pointer border-b-[var(--color-border-subtle)] border-l-transparent border-r-transparent border-t-transparent bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]'"
          @click="activeId = tab.id"
        >
          <span v-if="isStreamingStatus(tab.agentStatus)" class="gs-wrap">
            <svg viewBox="0 0 28 28" width="14" height="14">
              <defs>
                <linearGradient :id="`gs-${tab.id}`" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.1" />
                  <stop offset="50%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.5" />
                  <stop offset="100%" style="stop-color: var(--color-accent-bright); stop-opacity: 1" />
                </linearGradient>
              </defs>
              <circle cx="14" cy="14" r="11" fill="none" stroke="var(--color-border-subtle)" stroke-width="2.5" />
              <circle cx="14" cy="14" r="11" fill="none" :stroke="`url(#gs-${tab.id})`" stroke-width="2.5" stroke-linecap="round" class="gs-spin" />
            </svg>
          </span>
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis">{{ tab.title }}</span>
          <span
            class="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-[opacity,background] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
            :class="tab.id === activeId ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'"
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
        class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] before:pointer-events-none before:absolute before:-bottom-[4px] before:-left-[12px] before:-top-[2px] before:w-[12px] before:bg-gradient-to-l before:from-[var(--color-bg-surface)] before:from-[30%] before:to-transparent before:content-['']"
        aria-label="Scroll tabs right"
        @click="scrollTabsRight"
      >
        <ChevronRight :size="14" :stroke-width="2" />
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-[1px] pb-[4px] pl-[2px]">
      <div ref="newTabTriggerRef" class="relative shrink-0">
        <div class="flex items-center">
          <button
            class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-l-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
            aria-label="New chat"
            @click="chat.addTab"
          >
            <Plus :size="14" :stroke-width="1.8" />
          </button>
          <button
            class="ml-[1px] flex h-[26px] w-[16px] shrink-0 cursor-pointer items-center justify-center rounded-r-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] aria-expanded:bg-[var(--color-bg-hover)] aria-expanded:text-[var(--color-text-primary)]"
            aria-label="New tab options"
            aria-haspopup="menu"
            :aria-expanded="newTabMenuOpen"
            @click="toggleNewTabMenu"
          >
            <ChevronDown :size="12" :stroke-width="2" />
          </button>
        </div>

        <Transition
          enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top"
          enter-from-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
          enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-top"
          leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-to-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
        >
          <div
            v-if="newTabMenuOpen"
            ref="newTabMenuRef"
            class="absolute left-1/2 -translate-x-1/2 top-[calc(100%+6px)] z-[1000] min-w-[180px] origin-top rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-surface)] p-[6px] [box-shadow:0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)]"
            role="menu"
          >
            <div class="mb-1 flex items-center border-b border-[var(--color-border-subtle)] px-[10px] py-0.5">
              <span class="select-none text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-dim)]">New</span>
            </div>
            <button class="mt-[2px] flex h-[32px] w-full cursor-pointer items-center gap-[10px] whitespace-nowrap rounded-[var(--radius-sm)] border-none bg-transparent px-[10px] text-[12.5px] font-[450] text-[var(--color-text-secondary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] first:mt-0" role="menuitem" @click="handleNewTab">
              <Plus :size="14" :stroke-width="1.8" />
              <span>New Tab</span>
            </button>
            <button class="mt-[2px] flex h-[32px] w-full cursor-pointer items-center gap-[10px] whitespace-nowrap rounded-[var(--radius-sm)] border-none bg-transparent px-[10px] text-[12.5px] font-[450] text-[var(--color-text-secondary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] first:mt-0" role="menuitem" @click="handleNewDesign">
              <Palette :size="14" :stroke-width="1.8" />
              <span>New Design</span>
            </button>
          </div>
        </Transition>
      </div>

      <div class="mx-[3px] h-[14px] w-[1px] shrink-0 bg-[var(--color-border-subtle)]" />

      <button
        class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-none transition-[background,color] duration-[120ms] ease-[ease]"
        :class="isDesignTab ? 'cursor-not-allowed text-[var(--color-text-dim)] opacity-30' : `cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]${activeBrowserOwner.isPanelOpen ? ' bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent-text)]' : ' bg-transparent text-[var(--color-text-tertiary)]'}`"
        aria-label="Toggle embedded browser"
        :disabled="isDesignTab"
        @click="toggleBrowser"
      >
        <Globe :size="14" :stroke-width="1.8" />
      </button>

      <button
        class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-none transition-[background,color] duration-[120ms] ease-[ease]"
        :class="isDesignTab ? 'cursor-not-allowed text-[var(--color-text-dim)] opacity-30' : `cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]${activeTerminalOwner.isPanelOpen ? ' bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent-text)]' : ' bg-transparent text-[var(--color-text-tertiary)]'}`"
        aria-label="Toggle terminal panel"
        :disabled="isDesignTab"
        @click="toggleTerminal"
      >
        <!-- Collapsed: outline with horizontal divider -->
        <svg v-if="!activeTerminalOwner.isPanelOpen" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <line x1="3" x2="21" y1="15" y2="15" />
        </svg>
        <!-- Expanded: bottom strip filled -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <rect width="18" height="6" x="3" y="15" fill="currentColor" stroke="none" />
          <line x1="3" x2="21" y1="15" y2="15" />
        </svg>
      </button>

      <button
        class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-none transition-[background,color] duration-[120ms] ease-[ease]"
        :class="isDesignTab ? 'cursor-not-allowed text-[var(--color-text-dim)] opacity-30' : `cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]${activeGitOwner.isPanelOpen ? ' bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent-text)]' : ' bg-transparent text-[var(--color-text-tertiary)]'}`"
        aria-label="Git Menu"
        :disabled="isDesignTab"
        @click="toggleGitPane"
      >
        <!-- Collapsed: outline only -->
        <svg v-if="!activeGitOwner.isPanelOpen" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <line x1="15" x2="15" y1="3" y2="21" />
        </svg>
        <!-- Expanded: right strip filled -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <rect width="6" height="18" x="15" y="3" fill="currentColor" stroke="none" />
          <line x1="15" x2="15" y1="3" y2="21" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style>
.tab-list-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.tab-list-scroll::-webkit-scrollbar {
  display: none;
}

/* Unscoped global style block to ensure keyframes are available to arbitrary Tailwind values */
@keyframes gsSpin {
  to {
    transform: rotate(360deg);
  }
}

.gs-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gs-spin {
  animation: gsSpin 1.8s linear infinite;
  transform-origin: center;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 30%, transparent));
}
</style>
