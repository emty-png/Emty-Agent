<script setup lang="ts">
import type { useGitWorkspace } from '@/composables/git/useGitWorkspace'
import type { GitFileEntry } from '@/utils/git'
import type { ParsedDiff } from '@/utils/gitDiff'
import type { WorktreeEntry } from '@/utils/worktrees'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  GitBranch,
  GitCommit,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ScrollText,
  Undo2,
  X,
} from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useProjectStore } from '@/stores/project'
import { gitDiff, gitDiffNoIndex } from '@/utils/git'
import { getFileChangeKind, getFileStatusLabel, parseDiffForDisplay } from '@/utils/gitDiff'
import { inspectWorkspace, listWorktrees } from '@/utils/worktrees'
import GitCommitModal from './popup/GitCommitModal.vue'

const props = defineProps<{
  cwd: string
  tabId: string
  workspace: ReturnType<typeof useGitWorkspace>
}>()

const {
  isRepo,
  status,
  stashes,
  loading,
  busyAction,
  refreshedAt,
  unstagedCount,
  stagedCount,
  hasConflicts,
  discardAllCount,
  refresh,
  stageFile,
  unstageFile,
  discardFile,
  stageAll,
  unstageAll,
  fetchRemote,
  pullRemote,
  pushRemote,
  stashChanges,
  popStash,
  discardAllConfirmed,
} = props.workspace

// ── Filter & file list ─────────────────────────────────────────────────────
const filter = ref<'unstaged' | 'staged'>('unstaged')

const displayedFiles = computed<GitFileEntry[]>(() => {
  if (!status.value)
    return []
  return filter.value === 'unstaged'
    ? [...status.value.conflicts, ...status.value.unstaged, ...status.value.untracked]
    : status.value.staged
})

const expandedFiles = reactive(new Set<string>())
const diffLoading = reactive(new Set<string>())
const parsedDiffs = reactive<Record<string, ParsedDiff[]>>({})

function resetDiffState() {
  expandedFiles.clear()
  Object.keys(parsedDiffs).forEach(key => delete parsedDiffs[key])
}

watch(filter, resetDiffState)

// Any completed mutating action (stage/unstage/discard/commit/...) can change
// file contents, so previously loaded diffs are no longer trustworthy.
watch(busyAction, (current, previous) => {
  if (previous && !current)
    resetDiffState()
})

async function toggleFile(path: string, isStaged: boolean) {
  if (expandedFiles.has(path)) {
    expandedFiles.delete(path)
    return
  }

  expandedFiles.add(path)
  if (parsedDiffs[path])
    return

  diffLoading.add(path)
  try {
    const isUntrackedFile = !isStaged && (status.value?.untracked.some(u => u.path === path) ?? false)
    const raw = isUntrackedFile
      ? await gitDiffNoIndex(props.cwd, path, props.tabId)
      : await gitDiff(props.cwd, path, isStaged, props.tabId)
    parsedDiffs[path] = parseDiffForDisplay(raw)
  }
  catch (err) {
    console.error('Failed to load diff for', path, err)
  }
  finally {
    diffLoading.delete(path)
  }
}

// ── Worktree switcher ───────────────────────────────────────────────────────
const chatStore = useChatStore()
const projectStore = useProjectStore()

const worktrees = ref<WorktreeEntry[]>([])
const worktreesLoading = ref(false)
const showWorktreePopover = ref(false)
const worktreeBtnRef = ref<HTMLElement | null>(null)
const worktreePopoverPos = ref({ x: 0, y: 0 })

async function loadWorktrees() {
  if (!isRepo.value) {
    worktrees.value = []
    return
  }
  worktreesLoading.value = true
  try {
    const result = await listWorktrees(props.cwd)
    worktrees.value = result?.entries ?? []
  }
  catch (err) {
    console.error('Failed to load worktrees', err)
  }
  finally {
    worktreesLoading.value = false
  }
}

// Reload whenever the workspace refreshes (branch/worktree state may have changed).
watch(refreshedAt, loadWorktrees)

const WORKTREE_POPOVER_WIDTH = 260
const WORKTREE_POPOVER_PADDING = 12

function updateWorktreePopoverPos() {
  if (!worktreeBtnRef.value)
    return
  const rect = worktreeBtnRef.value.getBoundingClientRect()
  const zoom = Number(document.documentElement.style.zoom) || 1
  const centerX = (rect.left + rect.width / 2) / zoom
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth
  const halfWidth = WORKTREE_POPOVER_WIDTH / 2

  let boundedX = centerX
  if (boundedX - halfWidth < WORKTREE_POPOVER_PADDING)
    boundedX = halfWidth + WORKTREE_POPOVER_PADDING
  else if (boundedX + halfWidth > viewportWidth - WORKTREE_POPOVER_PADDING)
    boundedX = viewportWidth - halfWidth - WORKTREE_POPOVER_PADDING

  worktreePopoverPos.value = {
    x: Math.round(boundedX),
    y: Math.round((rect.bottom + 8) / zoom),
  }
}

function toggleWorktreePopover() {
  if (showWorktreePopover.value) {
    showWorktreePopover.value = false
    return
  }
  updateWorktreePopoverPos()
  showWorktreePopover.value = true
}

async function selectWorktree(path: string) {
  const snapshot = await inspectWorkspace(path)
  chatStore.setTabWorkspace(props.tabId, { workspacePath: path, workspaceMeta: snapshot })
  projectStore.setProject(path)
  showWorktreePopover.value = false
}

let worktreeScrollRaf: number | null = null
function handleWorktreeScroll() {
  if (!showWorktreePopover.value || worktreeScrollRaf !== null)
    return
  worktreeScrollRaf = requestAnimationFrame(() => {
    updateWorktreePopoverPos()
    worktreeScrollRaf = null
  })
}

watch(showWorktreePopover, open => {
  if (open) {
    window.addEventListener('resize', updateWorktreePopoverPos, { passive: true })
    window.addEventListener('scroll', handleWorktreeScroll, { capture: true, passive: true })
  }
  else {
    window.removeEventListener('resize', updateWorktreePopoverPos)
    window.removeEventListener('scroll', handleWorktreeScroll, { capture: true })
  }
})

onMounted(loadWorktrees)
onUnmounted(() => {
  window.removeEventListener('resize', updateWorktreePopoverPos)
  window.removeEventListener('scroll', handleWorktreeScroll, { capture: true })
})

// ── Remote / stash actions popup ────────────────────────────────────────────
const showActionsPopup = ref(false)
function executeActionAndClose(action: () => void) {
  action()
  showActionsPopup.value = false
}

function openLogs() {
  showActionsPopup.value = false
  window.dispatchEvent(new CustomEvent('emty:open-git-logs', { detail: { tabId: props.tabId } }))
}

// ── Discard-all confirmation ────────────────────────────────────────────────
const showDiscardAllModal = ref(false)
function revertAll() {
  if (discardAllCount.value > 0)
    showDiscardAllModal.value = true
}
function confirmDiscardAll() {
  showDiscardAllModal.value = false
  discardAllConfirmed()
}

// ── Commit modal ─────────────────────────────────────────────────────────────
const showCommitModal = ref(false)

// ── Shared style tokens ──────────────────────────────────────────────────────
const iconBtnClass = 'inline-flex items-center justify-center w-[26px] h-[26px] border border-transparent rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-dim)] cursor-pointer transition-all duration-100 ease-in-out shrink-0 hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed active:not(:disabled):scale-[0.92]'
const popoverItemClass = 'flex items-center gap-2.5 py-2 px-2.5 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease-in-out hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]'
const popoverItemActiveClass = 'bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] border-[var(--color-accent-dim)] text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)]'
const bottomBtnClass = 'inline-flex items-center gap-[5px] py-[5px] px-[12px] rounded-[var(--radius-md)] text-[12px] font-medium cursor-pointer border transition-all duration-100 ease-in-out whitespace-nowrap active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none'
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex items-center justify-between py-2 px-2.5 gap-2 shrink-0 border-b border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-bg-base)_80%,transparent)]">
      <div class="flex items-center bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-md p-0.5 gap-0.5">
        <button
          class="flex items-center justify-center px-4 h-[26px] bg-transparent border-none rounded-[4px] text-xs leading-none cursor-pointer select-none transition-all duration-[120ms] ease-in-out m-0"
          :class="filter === 'unstaged' ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] font-semibold' : 'text-[var(--color-text-dim)] font-medium hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)]'"
          @click="filter = 'unstaged'"
        >
          Changes
        </button>
        <button
          class="flex items-center justify-center px-4 h-[26px] bg-transparent border-none rounded-[4px] text-xs leading-none cursor-pointer select-none transition-all duration-[120ms] ease-in-out m-0"
          :class="filter === 'staged' ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] font-semibold' : 'text-[var(--color-text-dim)] font-medium hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)]'"
          @click="filter = 'staged'"
        >
          Staged
        </button>
        <button
          v-if="isRepo"
          ref="worktreeBtnRef"
          class="ml-2" :class="[iconBtnClass]"
          title="Switch Worktree"
          @click="toggleWorktreePopover"
        >
          <GitBranch :size="13" />
        </button>
      </div>
      <div class="flex items-center gap-1">
        <div class="relative">
          <button
            :class="iconBtnClass"
            title="Git actions"
            @click="showActionsPopup = !showActionsPopup"
          >
            <MoreHorizontal :size="13" />
          </button>

          <div v-if="showActionsPopup" class="fixed inset-0 z-50" @click="showActionsPopup = false" />
          <Transition
            enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
            enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
            enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
            leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
            leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
            leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
          >
            <div
              v-if="showActionsPopup"
              class="absolute top-[calc(100%+8px)] right-0 w-[190px] p-1.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] border border-[var(--color-border-mid)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] z-[10020] overflow-hidden"
            >
              <div class="px-2 py-0.5 mb-1 border-b border-[var(--color-border-subtle)] flex items-center">
                <span class="text-[10.5px] font-bold tracking-[0.08em] uppercase text-[var(--color-text-dim)] select-none">Actions</span>
              </div>
              <main class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto pb-0.5">
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  @click="openLogs"
                >
                  <ScrollText :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Logs</span>
                </button>
                <div class="mx-1.5 my-0.5 h-px bg-[var(--color-border-subtle)]" />
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  :disabled="loading || !!busyAction"
                  @click="executeActionAndClose(fetchRemote)"
                >
                  <CloudDownload :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Fetch</span>
                </button>
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  :disabled="loading || !!busyAction || hasConflicts"
                  @click="executeActionAndClose(pullRemote)"
                >
                  <ArrowDownToLine :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Pull</span>
                </button>
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  :disabled="loading || !!busyAction || hasConflicts"
                  @click="executeActionAndClose(pushRemote)"
                >
                  <ArrowUpToLine :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Push</span>
                </button>
                <div class="mx-1.5 my-0.5 h-px bg-[var(--color-border-subtle)]" />
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  :disabled="loading || !!busyAction || unstagedCount === 0"
                  @click="executeActionAndClose(stashChanges)"
                >
                  <Archive :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Stash</span>
                </button>
                <button
                  class="flex items-center gap-2 h-[30px] px-2 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                  :disabled="loading || !!busyAction || stashes.length === 0"
                  @click="executeActionAndClose(popStash)"
                >
                  <ArchiveRestore :size="13" class="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span class="flex-1 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">Pop stash</span>
                </button>
              </main>
            </div>
          </Transition>
        </div>
        <button :class="iconBtnClass" title="Refresh" :disabled="loading" @click="() => refresh()">
          <RefreshCw :size="13" :class="{ 'animate-[spin_0.9s_linear_infinite]': loading }" />
        </button>
      </div>
    </div>

    <div v-if="!isRepo" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
      <div class="w-[38px] h-[38px] rounded-[var(--radius-lg)] flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)] border border-[var(--color-border-subtle)] mb-1">
        <GitBranch :size="20" :stroke-width="1.5" />
      </div>
      <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
        Not a git repository
      </p>
      <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[200px] leading-[1.5]">
        Open a folder that contains a git repository.
      </p>
    </div>
    <div v-else-if="loading && !status" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
      <Loader2 :size="18" :stroke-width="1.8" class="animate-[spin_0.9s_linear_infinite] text-[var(--color-text-dim)]" />
      <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
        Loading…
      </p>
    </div>
    <div v-else-if="status?.isClean" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
      <div class="w-[38px] h-[38px] rounded-[var(--radius-lg)] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)] border border-[color-mix(in_srgb,var(--color-success)_25%,transparent)] mb-1">
        <Check :size="18" :stroke-width="2" />
      </div>
      <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
        Nothing to see here…
      </p>
      <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[200px] leading-[1.5]">
        No changes to review.
      </p>
    </div>

    <div v-else class="flex flex-1 flex-col overflow-y-auto pb-[52px] [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
      <div v-for="f in displayedFiles" :key="f.path" class="flex flex-col border-b border-[color-mix(in_srgb,var(--color-border-subtle)_50%,transparent)]" :class="{ 'bg-[color-mix(in_srgb,var(--color-bg-surface)_40%,transparent)]': expandedFiles.has(f.path) }">
        <div class="flex items-center px-2.5 h-8 cursor-pointer gap-2 transition-colors duration-[80ms] ease-in-out hover:bg-[var(--color-state-hover)] group/file" @click="toggleFile(f.path, filter === 'staged')">
          <span
            class="text-[10px] font-bold w-4 h-4 rounded-[var(--radius-xs)] inline-flex items-center justify-center shrink-0 tracking-normal"
            :class="{
              'bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]': getFileChangeKind(f) === 'deleted',
              'bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]': getFileChangeKind(f) === 'added',
              'bg-[color-mix(in_srgb,var(--color-info)_18%,transparent)] text-[var(--color-info)]': getFileChangeKind(f) === 'modified',
            }"
          >
            {{ getFileStatusLabel(f) }}
          </span>

          <div class="flex-1 text-[12.5px] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
            <span class="text-[var(--color-text-dim)]">{{ f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/') + 1) : '' }}</span>
            <span class="text-[var(--color-text-primary)]">{{ f.path.includes('/') ? f.path.substring(f.path.lastIndexOf('/') + 1) : f.path }}</span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <div class="flex items-center gap-0.5 opacity-35 transition-opacity duration-[120ms] ease-in-out group-hover/file:opacity-100">
              <button
                v-if="filter === 'unstaged'"
                class="inline-flex items-center justify-center w-[22px] h-[22px] border-none rounded-[var(--radius-sm)] bg-transparent cursor-pointer transition-colors duration-100 ease-in-out text-[var(--color-text-dim)] hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] hover:text-[var(--color-danger)]"
                title="Discard changes"
                @click.stop="discardFile(f.path)"
              >
                <Undo2 :size="12" />
              </button>
              <button
                v-if="filter === 'unstaged'"
                class="inline-flex items-center justify-center w-[22px] h-[22px] border-none rounded-[var(--radius-sm)] bg-transparent cursor-pointer transition-colors duration-100 ease-in-out text-[var(--color-text-dim)] hover:bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] hover:text-[var(--color-success)]"
                title="Stage file"
                @click.stop="stageFile(f.path)"
              >
                <Plus :size="12" />
              </button>
              <button
                v-if="filter === 'staged'"
                class="inline-flex items-center justify-center w-[22px] h-[22px] border-none rounded-[var(--radius-sm)] bg-transparent cursor-pointer transition-colors duration-100 ease-in-out text-[var(--color-text-dim)] hover:bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)] hover:text-[var(--color-info)]"
                title="Unstage file"
                @click.stop="unstageFile(f.path)"
              >
                <Minus :size="12" />
              </button>
            </div>

            <ChevronDown v-if="expandedFiles.has(f.path)" :size="13" class="text-[var(--color-text-dim)] opacity-80 transition-all duration-200 ease-in-out" />
            <ChevronRight v-else :size="13" class="text-[var(--color-text-dim)] opacity-50 transition-all duration-200 ease-in-out" />
          </div>
        </div>

        <Transition
          enter-active-class="transition-opacity duration-[120ms] ease"
          leave-active-class="transition-opacity duration-[80ms] ease"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div v-if="expandedFiles.has(f.path)" class="font-mono text-[11.5px] leading-[1.55] overflow-x-auto [scrollbar-width:thin] border-t border-[color-mix(in_srgb,var(--color-border-subtle)_60%,transparent)]">
            <div v-if="diffLoading.has(f.path)" class="flex items-center justify-center gap-2 py-[14px] px-4 text-[var(--color-text-dim)] text-[11.5px] font-[inherit]">
              <Loader2 :size="14" class="animate-[spin_0.9s_linear_infinite]" />
              <span>Loading diff…</span>
            </div>
            <div v-else-if="!parsedDiffs[f.path]?.length" class="flex items-center justify-center gap-2 py-[14px] px-4 text-[var(--color-text-dim)] text-[11.5px] font-[inherit]">
              No diff available or binary file
            </div>
            <div v-else class="min-w-max">
              <div v-for="(hunk, i) in parsedDiffs[f.path]" :key="i" class="diff-hunk">
                <div class="py-[3px] px-3 text-[10.5px] text-[var(--color-text-dim)] bg-[color-mix(in_srgb,var(--color-bg-surface)_60%,var(--color-bg-base))] border-b border-[color-mix(in_srgb,var(--color-border-subtle)_40%,transparent)] select-none">
                  {{ hunk.header }}
                </div>
                <template v-for="(block, j) in hunk.blocks" :key="j">
                  <div v-if="block.type === 'ctx'" class="flex flex-col">
                    <div class="flex items-center bg-[color-mix(in_srgb,var(--color-bg-surface)_30%,var(--color-bg-base))] text-[var(--color-text-dim)] cursor-pointer select-none text-[11px] transition-colors duration-[80ms] ease-in-out hover:bg-[var(--color-state-hover)]" @click="block.expanded = !block.expanded">
                      <div class="w-[72px] flex items-center justify-center shrink-0 py-[3px] px-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_40%,transparent)]">
                        <ChevronDown v-if="block.expanded" :size="11" />
                        <ChevronRight v-else :size="11" />
                      </div>
                      <div class="py-[3px] px-3 text-[10.5px] tracking-[0.01em]">
                        {{ block.lines.length }} unchanged line{{ block.lines.length !== 1 ? 's' : '' }}
                      </div>
                    </div>
                    <template v-if="block.expanded">
                      <div v-for="(line, k) in block.lines" :key="k" class="flex items-stretch">
                        <div class="flex w-[72px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)]">
                          <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.oldLine }}</span>
                          <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.newLine }}</span>
                        </div>
                        <div class="w-[18px] shrink-0 text-center font-semibold text-[12px] select-none flex items-center justify-center" />
                        <div class="px-3 whitespace-pre flex-1 text-[var(--color-text-dim)] opacity-70">
                          {{ line.text }}
                        </div>
                      </div>
                    </template>
                  </div>

                  <template v-else>
                    <div
                      v-for="(line, k) in block.lines" :key="k" class="flex items-stretch"
                      :class="{
                        'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]': line.type === 'add',
                        'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]': line.type === 'del',
                      }"
                    >
                      <div
                        class="flex w-[72px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)]"
                        :class="{
                          'bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]': line.type === 'add',
                          'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]': line.type === 'del',
                        }"
                      >
                        <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.oldLine }}</span>
                        <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.newLine }}</span>
                      </div>
                      <div
                        class="w-[18px] shrink-0 text-center font-semibold text-[12px] select-none flex items-center justify-center"
                        :class="{
                          'text-[var(--color-success)]': line.type === 'add',
                          'text-[var(--color-danger)]': line.type === 'del',
                        }"
                      >
                        {{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}
                      </div>
                      <div
                        class="px-3 whitespace-pre flex-1"
                        :class="{
                          'text-[color-mix(in_srgb,var(--color-success)_60%,var(--color-text-primary))]': line.type === 'add',
                          'text-[color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]': line.type === 'del',
                        }"
                      >
                        {{ line.text }}
                      </div>
                    </div>
                  </template>
                </template>
              </div>
            </div>
          </div>
        </Transition>
      </div>
      <div v-if="displayedFiles.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-12 px-6 text-center min-h-[260px]">
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-dim)]">
          Nothing to see here…
        </p>
        <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[200px] leading-[1.5]">
          {{ filter === 'staged' ? 'No staged changes.' : 'No unstaged changes.' }}
        </p>
      </div>
    </div>

    <div v-if="isRepo && displayedFiles.length > 0" class="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1.5 py-2 px-2.5 bg-[var(--color-bg-base)] border-t border-[var(--color-border-subtle)] z-10">
      <template v-if="filter === 'unstaged'">
        <button class="bg-transparent border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-bright)]" :class="[bottomBtnClass]" :disabled="!!busyAction" @click="revertAll">
          <Undo2 :size="12" />
          Discard all
        </button>
        <button class="bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-transparent hover:opacity-[0.88]" :class="[bottomBtnClass]" :disabled="!!busyAction" @click="stageAll">
          <Plus :size="12" />
          Stage all
        </button>
      </template>
      <template v-else>
        <button class="bg-transparent border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-bright)]" :class="[bottomBtnClass]" :disabled="!!busyAction" @click="unstageAll">
          <Minus :size="12" />
          Unstage all
        </button>
        <button
          class="bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-transparent hover:opacity-[0.88]" :class="[bottomBtnClass]"
          :disabled="!!busyAction || hasConflicts"
          :title="hasConflicts ? 'Resolve conflicts before committing' : 'Commit staged changes'"
          @click="showCommitModal = true"
        >
          <GitCommit :size="12" />
          Commit
        </button>
      </template>
    </div>

    <GitCommitModal
      v-model:open="showCommitModal"
      :status="status"
      :unstaged-count="unstagedCount"
      :staged-count="stagedCount"
      :workspace="workspace"
    />

    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150 ease"
        leave-active-class="transition-opacity duration-120 ease"
        enter-from-class="opacity-0 [&_.commit-modal]:scale-[0.96] [&_.commit-modal]:translate-y-1"
        leave-to-class="opacity-0"
      >
        <div v-if="showDiscardAllModal" class="fixed inset-0 z-[9999] bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] flex items-center justify-center" @click.self="showDiscardAllModal = false">
          <div class="relative w-[360px] p-6 bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)]">
            <button class="absolute top-3 right-3 grid place-items-center w-[26px] h-[26px] border-none rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) cursor-pointer transition-[background] duration-[120ms] ease-[ease] hover:bg-(--color-state-hover)" @click="showDiscardAllModal = false">
              <X :size="14" :stroke-width="1.8" />
            </button>
            <h2 class="text-[15px] font-semibold text-(--color-text-primary) mb-[10px]">
              Discard changes
            </h2>
            <p class="text-[13px] text-(--color-text-secondary) leading-[1.6] mb-5">
              {{ discardAllCount }} unstaged change{{ discardAllCount === 1 ? '' : 's' }} will be permanently discarded from the working tree. This cannot be undone.
            </p>
            <div class="flex justify-end gap-2">
              <button class="h-8 px-4 rounded-(--radius-sm) border border-(--color-border-mid) bg-(--color-bg-card) text-[13px] font-medium text-(--color-text-secondary) cursor-pointer transition-[background,color] duration-[120ms] ease-[ease] hover:bg-(--color-state-hover) hover:text-(--color-text-primary)" @click="showDiscardAllModal = false">
                Cancel
              </button>
              <button class="h-8 px-4 rounded-(--radius-sm) border border-transparent bg-(--color-danger) text-[13px] font-medium text-(--color-text-primary) cursor-pointer transition-[background,color] duration-[120ms] ease-[ease] hover:not(:disabled):opacity-90 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!!busyAction" @click="confirmDiscardAll">
                Discard
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div v-if="showWorktreePopover" role="dialog" aria-modal="true" class="fixed inset-0 z-[10010]" @click="showWorktreePopover = false" />
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
        enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
        enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
        leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
      >
        <div
          v-if="isRepo && showWorktreePopover"
          class="fixed w-[260px] rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] border border-[var(--color-border-mid)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.04)_inset] z-[10020] -translate-x-1/2 overflow-hidden"
          :style="{ left: `${worktreePopoverPos.x}px`, top: `${worktreePopoverPos.y}px` }"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
            <GitBranch :size="12" class="text-[var(--color-text-tertiary)]" />
            <span class="text-[11px] font-semibold tracking-wide uppercase text-[var(--color-text-dim)]">Worktrees</span>
          </div>
          <main class="flex flex-col gap-px p-1.5 max-h-[220px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
            <div v-if="worktreesLoading && worktrees.length === 0" class="p-3 text-center text-[12px] text-[var(--color-text-tertiary)]">
              Loading…
            </div>
            <div v-else-if="worktrees.length === 0" class="p-3 text-center text-[11px] text-[var(--color-text-dim)]">
              No worktrees found
            </div>
            <template v-else>
              <button
                v-for="wt in worktrees"
                :key="wt.path"
                :class="[popoverItemClass, wt.isCurrent ? popoverItemActiveClass : '']"
                @click="selectWorktree(wt.path)"
              >
                <GitBranch :size="13" class="shrink-0" :class="wt.isCurrent ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-text-tertiary)]'" />
                <span class="flex-1 text-[12px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{{ wt.label }}</span>
                <Check v-if="wt.isCurrent" :size="13" class="text-[var(--color-accent-text)] shrink-0" />
              </button>
            </template>
          </main>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
