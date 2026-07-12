<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBrowserStore } from '@/stores/browser'
import { useGitPaneStore } from '@/stores/gitPane'
import { useTerminalStore } from '@/stores/terminal'
import TerminalSessionView from './TerminalSessionView.vue'

const props = defineProps<{
  ownerId: string
  cwd?: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const terminal = useTerminalStore()
const browser = useBrowserStore()
const gitPane = useGitPaneStore()
const owner = computed(() => terminal.getOwner(props.ownerId))
const activeSession = computed(() =>
  owner.value.sessions.find(session => session.id === owner.value.activeSessionId) ?? null,
)

async function addSession() {
  await terminal.createSession(props.ownerId, props.cwd)
}

async function closeSession(sessionId: string) {
  await terminal.closeSession(props.ownerId, sessionId)
}

function togglePosition() {
  const next = owner.value.position === 'bottom' ? 'right' : 'bottom'
  if (next === 'right') {
    browser.closePanel(props.ownerId)
    gitPane.closePanel(props.ownerId)
  }
  terminal.setTerminalPosition(props.ownerId, next)
}

// ── Scroll arrows for session tabs ──────────────────────────────────────────
const tabListRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const SCROLL_TOLERANCE = 2

function updateScrollState() {
  const el = tabListRef.value
  if (!el)
    return
  canScrollLeft.value = el.scrollLeft > SCROLL_TOLERANCE
  canScrollRight.value = el.scrollWidth - el.scrollLeft - el.clientWidth > SCROLL_TOLERANCE
}

let scrollRaf = 0
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

watch(() => owner.value.sessions, () => {
  requestAnimationFrame(updateScrollState)
}, { flush: 'post' })

onMounted(() => {
  requestAnimationFrame(updateScrollState)
  const el = tabListRef.value
  if (el) {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(updateScrollState)
    })
    resizeObserver.observe(el)
    mutationObserver = new MutationObserver(updateScrollState)
    mutationObserver.observe(el, { childList: true })
  }
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
})
</script>

<template>
  <section class="flex flex-col h-full bg-[var(--color-bg-base)] border-t border-[var(--color-border-subtle)] min-h-0">
    <div class="flex items-end h-9 min-h-9 pl-1 pr-2 bg-[var(--color-bg-surface)] shadow-[inset_0_-1px_0_var(--color-border-subtle)]">
      <button
        v-show="canScrollLeft"
        class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] after:pointer-events-none after:absolute after:-bottom-[4px] after:-right-[12px] after:-top-[2px] after:w-[12px] after:bg-gradient-to-r after:from-[var(--color-bg-surface)] after:from-[30%] after:to-transparent after:content-['']"
        aria-label="Scroll tabs left"
        @click="scrollTabsLeft"
      >
        <ChevronLeft :size="14" :stroke-width="2" />
      </button>

      <div ref="tabListRef" class="terminal-tab-list flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden" @scroll="onScroll">
        <button
          v-for="session in owner.sessions"
          :key="session.id"
          class="group flex h-[30px] w-[140px] min-w-[140px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-t-[var(--radius-sm)] border-b border-l border-r border-t pl-[10px] pr-[8px] text-[12px] font-[450] transition-[background,color,border-color] duration-[120ms] ease-[ease]"
          :class="session.id === owner.activeSessionId
            ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border-t-[var(--color-border-subtle)] border-l-[var(--color-border-subtle)] border-r-[var(--color-border-subtle)] border-b-[var(--color-bg-base)] cursor-default'
            : 'bg-transparent text-[var(--color-text-tertiary)] border-transparent border-b-[var(--color-border-subtle)] cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]'"
          :title="session.cwd || session.title"
          @click="terminal.activateSession(props.ownerId, session.id)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ session.title }}</span>
          <span
            class="grid place-items-center w-4 h-4 rounded-[var(--radius-sm)] text-inherit shrink-0 transition-all duration-[120ms] ease-in-out hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
            :class="session.id === owner.activeSessionId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
            role="button"
            aria-label="Close terminal session"
            @click.stop="closeSession(session.id)"
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

      <div class="flex items-center gap-[1px] shrink-0 pb-1">
        <button
          class="grid place-items-center w-[26px] h-[26px] border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-colors duration-[120ms] ease-in-out hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          :aria-label="owner.position === 'bottom' ? 'Move terminal to right pane' : 'Move terminal to bottom'"
          :title="owner.position === 'bottom' ? 'Move to right pane' : 'Move to bottom'"
          @click="togglePosition"
        >
          <!-- At bottom: show right-strip (will move to right) -->
          <svg v-if="owner.position === 'bottom'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" stroke="var(--color-text-tertiary)" fill="none" />
            <rect width="6" height="18" x="15" y="3" fill="var(--color-text-secondary)" stroke="none" />
            <line x1="15" x2="15" y1="3" y2="21" stroke="var(--color-text-secondary)" />
          </svg>
          <!-- At right: show bottom-strip (will move to bottom) -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" stroke="var(--color-text-tertiary)" fill="none" />
            <rect width="18" height="6" x="3" y="15" fill="var(--color-text-secondary)" stroke="none" />
            <line x1="3" x2="21" y1="15" y2="15" stroke="var(--color-text-secondary)" />
          </svg>
        </button>
        <button
          class="grid place-items-center w-[26px] h-[26px] border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-colors duration-[120ms] ease-in-out hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="Open a new terminal session"
          title="New terminal"
          @click="addSession"
        >
          <Plus :size="14" :stroke-width="1.9" />
        </button>
        <button
          class="grid place-items-center w-[26px] h-[26px] border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-colors duration-[120ms] ease-in-out hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="Hide terminal panel"
          title="Hide terminal"
          @click="emit('close')"
        >
          <X :size="14" :stroke-width="1.9" />
        </button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
      <!-- Force a clean mount/unmount cycle on active tab shifts using :key -->
      <TerminalSessionView
        v-if="activeSession"
        :key="activeSession.id"
        :session="activeSession"
        :active="true"
      />

      <div v-else class="flex items-center justify-center h-full text-[var(--color-text-tertiary)] text-[12px] bg-[var(--color-bg-base)]">
        Terminal panel is open with no active session.
      </div>
    </div>
  </section>
</template>

<style>
.terminal-tab-list {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.terminal-tab-list::-webkit-scrollbar {
  display: none;
}
</style>
