<script setup lang="ts">
import type { Component } from 'vue'
import type { Message } from '@/stores/chat'
import {
  Blocks,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Terminal,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useGitWorkspace } from '@/composables/useGitWorkspace'
import { useGitPaneStore } from '@/stores/gitPane'
import { hooksConfigExists } from '@/utils/hooks'
import { commandTasks } from '@/utils/tools/shell'
import BackgroundTasksReview from './BackgroundTasksReview.vue'
import DiffViewer from './DiffViewer.vue'
import GitChangesReview from './GitChangesReview.vue'
import HooksTab from './HooksTab.vue'
import PlanReview from './PlanReview.vue'
import SkillsMcpReview from './SkillsMcpReview.vue'
import ToolResultsReview from './ToolResultsReview.vue'

const props = defineProps<{
  cwd: string
  messages: Message[]
  tabId: string
}>()
defineEmits<{ close: [] }>()

type PaneType = 'review' | 'tools' | 'plan' | 'tasks' | 'skillsMcp' | 'diffViewer' | 'hooks'

interface TabMenuItem {
  id: PaneType
  label: string
  icon: Component
}

const ALL_PANES: TabMenuItem[] = [
  { id: 'review', label: 'Review', icon: FileText },
  { id: 'skillsMcp', label: 'Skills & MCP', icon: Blocks },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'plan', label: 'Plan', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: Terminal },
  { id: 'hooks', label: 'Hooks', icon: Zap },
]

const gitPaneStore = useGitPaneStore()
const gitPaneOwner = computed(() => gitPaneStore.getOwner(props.tabId))
const workspace = useGitWorkspace(toRef(props, 'cwd'), props.tabId)

// ── Tab bar state ────────────────────────────────────────────────────────
const activePane = ref<PaneType | null>(null)
const openedTabs = ref<PaneType[]>([])
const showTabMenu = ref(false)

function toggleTabMenu() {
  showTabMenu.value = !showTabMenu.value
}
function closeTabMenu() {
  showTabMenu.value = false
}

function openTab(tab: PaneType) {
  if (!openedTabs.value.includes(tab))
    openedTabs.value.push(tab)
  activePane.value = tab

  const closedIds = gitPaneOwner.value.closedPanes
  if (closedIds.includes(tab))
    gitPaneStore.setClosedPanes(props.tabId, closedIds.filter(t => t !== tab))
  closeTabMenu()
}

function closeTab(tab: PaneType, event: Event) {
  event.stopPropagation()
  openedTabs.value = openedTabs.value.filter(t => t !== tab)
  if (activePane.value === tab)
    activePane.value = openedTabs.value.at(-1) ?? null

  const closedIds = gitPaneOwner.value.closedPanes
  if (!closedIds.includes(tab))
    gitPaneStore.setClosedPanes(props.tabId, [...closedIds, tab])
}

/**
 * Keeps an auto-managed tab (tools/plan/tasks) open exactly while its
 * visibility source is true — unless the user explicitly closed it, in
 * which case we respect that choice and never force it back open.
 */
function watchAutoTab(source: () => boolean, tab: PaneType) {
  watch(source, visible => {
    if (visible) {
      if (!gitPaneOwner.value.closedPanes.includes(tab) && !openedTabs.value.includes(tab)) {
        openedTabs.value.push(tab)
        activePane.value = tab
      }
    }
    else if (openedTabs.value.includes(tab)) {
      openedTabs.value = openedTabs.value.filter(t => t !== tab)
      if (activePane.value === tab)
        activePane.value = openedTabs.value.at(-1) ?? null
    }
  }, { immediate: true })
}

// ── Pane visibility ──────────────────────────────────────────────────────
const toolEventCount = computed(() =>
  props.messages.reduce((count, message) => count + (message.role === 'assistant' ? message.toolEvents?.length ?? 0 : 0), 0),
)
const bgTaskCount = computed(() => commandTasks.value.filter(t => t.tabId === props.tabId && t.mode === 'background').length)
const planReviewRef = ref<{ hasPlans: boolean } | null>(null)
const hasPlanFiles = ref(false)
const showHooksTab = ref(false)

const showToolsTab = computed(() => toolEventCount.value > 0)
const showPlanTab = computed(() => hasPlanFiles.value || planReviewRef.value?.hasPlans === true)
const showTasksTab = computed(() => bgTaskCount.value > 0)

watchAutoTab(() => showToolsTab.value, 'tools')
watchAutoTab(() => showPlanTab.value, 'plan')
watchAutoTab(() => showTasksTab.value, 'tasks')

// The review tab is only ever auto-opened, never auto-closed (closing a
// repo mid-session shouldn't yank the tab away from under the user).
watch(() => workspace.isRepo.value, visible => {
  if (visible && !gitPaneOwner.value.closedPanes.includes('review') && !openedTabs.value.includes('review')) {
    openedTabs.value.push('review')
    activePane.value = 'review'
  }
}, { immediate: true })

async function checkHooksConfig() {
  showHooksTab.value = await hooksConfigExists(props.cwd)
}

const availablePanes = computed(() => {
  const panes: TabMenuItem[] = []
  if (workspace.isRepo.value)
    panes.push(ALL_PANES.find(p => p.id === 'review')!)
  panes.push(ALL_PANES.find(p => p.id === 'skillsMcp')!)
  if (showToolsTab.value)
    panes.push(ALL_PANES.find(p => p.id === 'tools')!)
  if (showTasksTab.value)
    panes.push(ALL_PANES.find(p => p.id === 'tasks')!)
  if (showPlanTab.value)
    panes.push(ALL_PANES.find(p => p.id === 'plan')!)
  if (showHooksTab.value)
    panes.push(ALL_PANES.find(p => p.id === 'hooks')!)
  return panes
})

const closedPanes = computed(() => availablePanes.value.filter(p => !openedTabs.value.includes(p.id)))

const diffViewerFileName = computed(() => {
  const filePath = gitPaneOwner.value.diffViewerData?.filePath
  if (!filePath)
    return 'Diff'
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? 'Diff'
})

function handlePlanCreated(e: Event) {
  const detail = (e as CustomEvent<{ tabId?: string; conversationId?: string }>).detail
  if (detail?.tabId === props.tabId) {
    hasPlanFiles.value = true
    if (!openedTabs.value.includes('plan'))
      openedTabs.value.push('plan')
    activePane.value = 'plan'
  }
}

function handleOpenDiffViewer(e: Event) {
  const detail = (e as CustomEvent<{ tabId?: string; filePath?: string; diff?: string; added?: number; removed?: number }>).detail
  if (detail?.tabId !== props.tabId || !detail.filePath || !detail.diff)
    return

  gitPaneStore.openDiffViewer(props.tabId, {
    filePath: detail.filePath,
    diff: detail.diff,
    added: detail.added ?? 0,
    removed: detail.removed ?? 0,
  })
  if (!openedTabs.value.includes('diffViewer'))
    openedTabs.value.push('diffViewer')
  activePane.value = 'diffViewer'
}

// ── Scroll arrows for the pane tab strip ─────────────────────────────────
const paneTabListRef = ref<HTMLElement | null>(null)
const paneCanScrollLeft = ref(false)
const paneCanScrollRight = ref(false)
const PANE_SCROLL_TOLERANCE = 2

function updatePaneScrollState() {
  const el = paneTabListRef.value
  if (!el)
    return
  paneCanScrollLeft.value = el.scrollLeft > PANE_SCROLL_TOLERANCE
  paneCanScrollRight.value = el.scrollWidth - el.scrollLeft - el.clientWidth > PANE_SCROLL_TOLERANCE
}

let paneScrollRaf = 0
function onPaneScroll() {
  cancelAnimationFrame(paneScrollRaf)
  paneScrollRaf = requestAnimationFrame(updatePaneScrollState)
}

function scrollPaneTabsLeft() {
  paneTabListRef.value?.scrollBy({ left: -200, behavior: 'smooth' })
}
function scrollPaneTabsRight() {
  paneTabListRef.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

let paneResizeObserver: ResizeObserver | null = null
let paneMutationObserver: MutationObserver | null = null

watch(openedTabs, () => {
  requestAnimationFrame(updatePaneScrollState)
}, { flush: 'post' })

watch(() => props.cwd, () => {
  checkHooksConfig()
})

onMounted(() => {
  workspace.refresh().catch(err => console.error('GitPane initial refresh failed', err))
  checkHooksConfig()
  window.addEventListener('emty:plan-created', handlePlanCreated)
  window.addEventListener('emty:open-diff-viewer', handleOpenDiffViewer)

  requestAnimationFrame(updatePaneScrollState)
  const el = paneTabListRef.value
  if (el) {
    paneResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(paneScrollRaf)
      paneScrollRaf = requestAnimationFrame(updatePaneScrollState)
    })
    paneResizeObserver.observe(el)
    paneMutationObserver = new MutationObserver(updatePaneScrollState)
    paneMutationObserver.observe(el, { childList: true })
  }
})

onUnmounted(() => {
  cancelAnimationFrame(paneScrollRaf)
  paneResizeObserver?.disconnect()
  paneMutationObserver?.disconnect()
  workspace.dispose()
  window.removeEventListener('emty:plan-created', handlePlanCreated)
  window.removeEventListener('emty:open-diff-viewer', handleOpenDiffViewer)
})

const iconBtnClass = 'inline-flex items-center justify-center w-[26px] h-[26px] border border-transparent rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-dim)] cursor-pointer transition-all duration-100 ease-in-out shrink-0 hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed active:not(:disabled):scale-[0.92]'
</script>

<template>
  <div class="flex flex-col h-full bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-sans relative overflow-hidden">
    <div class="flex items-end justify-between px-2 pr-1 h-9 bg-[var(--color-bg-surface)] shadow-[inset_0_-1px_0_var(--color-border-subtle)] shrink-0">
      <div class="flex items-end flex-1 min-w-0">
        <button
          v-show="paneCanScrollLeft"
          class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] after:pointer-events-none after:absolute after:-bottom-[4px] after:-right-[12px] after:-top-[2px] after:w-[12px] after:bg-gradient-to-r after:from-[var(--color-bg-surface)] after:from-[30%] after:to-transparent after:content-['']"
          aria-label="Scroll tabs left"
          @click="scrollPaneTabsLeft"
        >
          <ChevronLeft :size="14" :stroke-width="2" />
        </button>

        <div ref="paneTabListRef" class="pane-tab-list flex items-end flex-1 min-w-0 overflow-x-auto overflow-y-hidden" @scroll="onPaneScroll">
          <button
            v-for="tab in openedTabs"
            :key="tab"
            class="group/tab flex h-[30px] w-[140px] min-w-[140px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-t-[var(--radius-sm)] border-b border-l border-r border-t pl-[10px] pr-[8px] text-[12px] font-[450] transition-[background,color,border-color] duration-[120ms] ease-[ease]"
            :class="activePane === tab
              ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border-t-[var(--color-border-subtle)] border-l-[var(--color-border-subtle)] border-r-[var(--color-border-subtle)] border-b-[var(--color-bg-base)] cursor-default'
              : 'border-t-transparent border-l-transparent border-r-transparent border-b-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]'"
            @click="activePane = tab"
          >
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              <template v-if="tab === 'review'">Review</template>
              <template v-else-if="tab === 'skillsMcp'">Skills &amp; MCP</template>
              <template v-else-if="tab === 'tools'">Tools</template>
              <template v-else-if="tab === 'plan'">Plan</template>
              <template v-else-if="tab === 'tasks'">Tasks</template>
              <template v-else-if="tab === 'diffViewer'">{{ diffViewerFileName }}</template>
              <template v-else-if="tab === 'hooks'">Hooks</template>
            </span>

            <span
              class="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-[opacity,background] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
              :class="activePane === tab ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'"
              role="button"
              aria-label="Close tab"
              @click.stop="closeTab(tab, $event)"
            >
              <X :size="11" :stroke-width="2" />
            </span>
          </button>
        </div>

        <button
          v-show="paneCanScrollRight"
          class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] before:pointer-events-none before:absolute before:-bottom-[4px] before:-left-[12px] before:-top-[2px] before:w-[12px] before:bg-gradient-to-l before:from-[var(--color-bg-surface)] before:from-[30%] before:to-transparent before:content-['']"
          aria-label="Scroll tabs right"
          @click="scrollPaneTabsRight"
        >
          <ChevronRight :size="14" :stroke-width="2" />
        </button>

        <div class="relative ml-1 self-center mb-[5px]">
          <button
            :class="[iconBtnClass]"
            title="Open tab"
            @click="toggleTabMenu"
          >
            <Plus :size="14" />
          </button>

          <div v-if="showTabMenu" class="fixed inset-0 z-50" @click="closeTabMenu" />
          <Transition
            enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
            enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
            enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
            leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
            leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
            leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
          >
            <div
              v-if="showTabMenu"
              class="absolute top-[calc(100%+8px)] right-0 w-[190px] p-1.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] border border-[var(--color-border-mid)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] z-[10020] overflow-hidden"
            >
              <div class="px-2 py-0.5 mb-1 border-b border-[var(--color-border-subtle)] flex items-center">
                <span class="text-[10.5px] font-bold tracking-[0.08em] uppercase text-[var(--color-text-dim)] select-none">Open Tab</span>
              </div>
              <main class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto pb-0.5">
                <button
                  v-for="pane in closedPanes"
                  :key="pane.id"
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  @click="openTab(pane.id)"
                >
                  <component :is="pane.icon" :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{{ pane.label }}</span>
                </button>
                <div v-if="closedPanes.length === 0" class="py-3 px-2 text-center">
                  <span class="text-[11.5px] text-[var(--color-text-dim)]">All tabs are open</span>
                </div>
              </main>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <GitChangesReview
      v-if="activePane === 'review'"
      :cwd="cwd"
      :tab-id="tabId"
      :workspace="workspace"
    />

    <ToolResultsReview
      v-if="activePane === 'tools'"
      :messages="messages"
    />

    <PlanReview
      v-show="activePane === 'plan'"
      ref="planReviewRef"
      :tab-id="tabId"
    />

    <BackgroundTasksReview
      v-if="activePane === 'tasks'"
      :tab-id="tabId"
    />

    <SkillsMcpReview
      v-if="activePane === 'skillsMcp'"
      :tab-id="tabId"
    />

    <HooksTab
      v-if="activePane === 'hooks'"
      :tab-id="tabId"
    />

    <DiffViewer
      v-if="activePane === 'diffViewer' && gitPaneOwner.diffViewerData"
      :file-path="gitPaneOwner.diffViewerData.filePath"
      :diff="gitPaneOwner.diffViewerData.diff"
      :added="gitPaneOwner.diffViewerData.added"
      :removed="gitPaneOwner.diffViewerData.removed"
    />

    <div v-if="activePane === null" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
      <div class="w-[38px] h-[38px] rounded-[var(--radius-lg)] flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)] border border-[var(--color-border-subtle)] mb-1">
        <Plus :size="18" :stroke-width="1.5" />
      </div>
      <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
        Nothing to see here…
      </p>
      <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[200px] leading-[1.5]">
        Use the + button above to open Review, Tools, Plan, and more.
      </p>
    </div>
  </div>
</template>

<style>
.pane-tab-list {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.pane-tab-list::-webkit-scrollbar {
  display: none;
}
</style>
