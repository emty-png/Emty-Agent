<script setup lang="ts">
import type { GitFileEntry, GitStatusResult } from '@/utils/git'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  GitCommit,
  Loader2,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  RefreshCw,
  Undo2,
  X,
} from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import {
  gitCommit,
  gitDiff,
  gitDiscard,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  isGitRepo,
} from '@/utils/git'

const props = defineProps<{ cwd: string }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const isRepo = ref(true)
const status = ref<GitStatusResult | null>(null)
const filter = ref<'unstaged' | 'staged'>('unstaged')

const unstagedCount = computed(() => (status.value?.unstaged.length || 0) + (status.value?.untracked.length || 0))
const stagedCount = computed(() => status.value?.staged.length || 0)

const displayedFiles = computed(() => {
  if (!status.value)
    return []
  if (filter.value === 'unstaged') {
    return [...status.value.unstaged, ...status.value.untracked]
  }
  return status.value.staged
})

const expandedFiles = ref<Set<string>>(new Set())
const diffLoading = ref<Set<string>>(new Set())
const parsedDiffs = ref<Record<string, ParsedDiff[]>>({})

const commitMsg = ref('')
const showCommitModal = ref(false)
const includeUnstaged = ref(true)
const busyAction = ref('')
const toast = ref<{ text: string; type: 'ok' | 'err' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

async function refresh() {
  loading.value = true
  try {
    isRepo.value = await isGitRepo(props.cwd)
    if (isRepo.value)
      status.value = await gitStatus(props.cwd)
    else
      status.value = null
  }
  finally { loading.value = false }
}

function showToast(text: string, type: 'ok' | 'err' = 'ok') {
  if (toastTimer)
    clearTimeout(toastTimer)
  toast.value = { text, type }
  toastTimer = setTimeout(() => { toast.value = null }, 3500)
}

async function doAction(name: string, fn: () => Promise<{ ok: boolean; stderr: string }>, successMsg?: string | null) {
  busyAction.value = name
  try {
    const r = await fn()
    if (r.ok) {
      if (successMsg !== null)
        showToast(successMsg ?? `${name} done`, 'ok')
    }
    else {
      showToast(r.stderr || `${name} failed`, 'err')
    }
    await refresh()
    parsedDiffs.value = {}
    expandedFiles.value.clear()
  }
  catch (e) { showToast(String(e), 'err') }
  finally { busyAction.value = '' }
}

const stageFile = (f: string) => doAction('Stage', () => gitStage(props.cwd, [f]))
const unstageFile = (f: string) => doAction('Unstage', () => gitUnstage(props.cwd, [f]))
const discardFile = (f: string) => doAction('Discard', () => gitDiscard(props.cwd, [f]))
const stageAll = () => doAction('Stage all', () => gitStageAll(props.cwd), null)
const unstageAll = () => doAction('Unstage all', () => gitUnstageAll(props.cwd))
function revertAll() {
  if (status.value) {
    doAction('Discard all', () => gitDiscard(props.cwd, [...status.value!.unstaged, ...status.value!.untracked].map(f => f.path)))
  }
}

async function commitFromModal() {
  if (includeUnstaged.value && unstagedCount.value > 0) {
    const r = await gitStageAll(props.cwd)
    if (!r.ok) {
      showToast(r.stderr || 'Failed to stage files', 'err')
      return
    }
  }
  const msg = commitMsg.value.trim() || 'Update files'
  await doAction('Commit', () => gitCommit(props.cwd, msg, false), 'Committed!')
  commitMsg.value = ''
  showCommitModal.value = false
}

function getDotClass(f: GitFileEntry) {
  const st = (f.indexStatus && f.indexStatus !== ' ') ? f.indexStatus : f.workdirStatus
  if (st === 'D')
    return 'dot-deleted'
  if (st === '?' || st === 'A')
    return 'dot-added'
  return 'dot-modified'
}

function getStatusLabel(f: GitFileEntry) {
  const st = (f.indexStatus && f.indexStatus !== ' ') ? f.indexStatus : f.workdirStatus
  if (st === 'D')
    return 'D'
  if (st === '?' || st === 'A')
    return 'A'
  return 'M'
}

interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  oldLine: string
  newLine: string
  text: string
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface DiffBlock {
  type: string
  lines: DiffLine[]
  expanded: boolean
}

interface ParsedDiff {
  header: string
  blocks: DiffBlock[]
}

function parseDiff(raw: string) {
  if (!raw)
    return []
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined)
      continue
    if (line.startsWith('---') || line.startsWith('+++'))
      continue
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = Number.parseInt(match[1]!, 10)
        newLine = Number.parseInt(match[2]!, 10)
        currentHunk = { header: line, lines: [] }
        hunks.push(currentHunk)
      }
      continue
    }
    if (!currentHunk)
      continue
    if (line.startsWith('\\ No newline'))
      continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldLine: '', newLine: String(newLine++), text: line.substring(1) })
    }
    else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldLine: String(oldLine++), newLine: '', text: line.substring(1) })
    }
    else if (line.startsWith(' ') || line === '') {
      const text = line.startsWith(' ') ? line.substring(1) : line
      currentHunk.lines.push({ type: 'ctx', oldLine: String(oldLine++), newLine: String(newLine++), text })
    }
  }
  return hunks
}

function processHunksForRendering(hunk: DiffHunk) {
  const blocks: DiffBlock[] = []
  let currentType = ''
  let currentLines: DiffLine[] = []

  for (const line of hunk.lines) {
    const type = line.type === 'ctx' ? 'ctx' : 'changes'
    if (type !== currentType) {
      if (currentLines.length > 0) {
        blocks.push({ type: currentType, lines: currentLines, expanded: false })
      }
      currentType = type
      currentLines = [line]
    }
    else {
      currentLines.push(line)
    }
  }
  if (currentLines.length > 0) {
    blocks.push({ type: currentType, lines: currentLines, expanded: false })
  }
  return blocks
}

function parseDiffIntoBlocks(raw: string) {
  const hunks = parseDiff(raw)
  return hunks.map(h => ({
    header: h.header,
    blocks: processHunksForRendering(h),
  }))
}

async function toggleFile(path: string, isStaged: boolean) {
  if (expandedFiles.value.has(path)) {
    expandedFiles.value.delete(path)
  }
  else {
    expandedFiles.value.add(path)
    if (!parsedDiffs.value[path]) {
      diffLoading.value.add(path)
      try {
        const raw = await gitDiff(props.cwd, path, isStaged)
        parsedDiffs.value[path] = parseDiffIntoBlocks(raw)
      }
      finally {
        diffLoading.value.delete(path)
      }
    }
  }
}

watch(filter, () => {
  expandedFiles.value.clear()
})
onMounted(refresh)
watch(() => props.cwd, refresh)
</script>

<template>
  <div class="git-root">
    <!-- Top Header -->
    <div class="pane-header">
      <div class="pane-title">
        <FileText :size="13" class="pane-title-icon" />
        <span>Review</span>
      </div>
      <div class="pane-header-actions">
        <button class="icon-btn" title="Refresh" :disabled="loading" @click="refresh">
          <RefreshCw :size="13" :class="{ spin: loading }" />
        </button>
        <button class="icon-btn" title="Commit changes" @click="showCommitModal = true">
          <GitCommit :size="13" />
        </button>
        <button class="icon-btn" title="Close panel" @click="emit('close')">
          <PanelRightClose :size="13" />
        </button>
      </div>
    </div>

    <!-- Filter Row -->
    <div class="filter-bar">
      <div class="filter-tabs">
        <button
          class="filter-tab"
          :class="{ active: filter === 'unstaged' }"
          @click="filter = 'unstaged'"
        >
          Changes
          <span class="tab-count" :class="{ 'tab-count--active': filter === 'unstaged' }">{{ unstagedCount }}</span>
        </button>
        <button
          class="filter-tab"
          :class="{ active: filter === 'staged' }"
          @click="filter = 'staged'"
        >
          Staged
          <span class="tab-count" :class="{ 'tab-count--active': filter === 'staged' }">{{ stagedCount }}</span>
        </button>
      </div>
      <button class="icon-btn" title="More options">
        <MoreHorizontal :size="13" />
      </button>
    </div>

    <!-- Empty States -->
    <div v-if="!isRepo" class="git-empty">
      <div class="git-empty-icon-wrap">
        <GitBranch :size="20" :stroke-width="1.5" />
      </div>
      <p class="git-empty-title">
        Not a git repository
      </p>
      <p class="git-empty-hint">
        Open a folder that contains a git repository.
      </p>
    </div>
    <div v-else-if="loading && !status" class="git-empty">
      <Loader2 :size="18" :stroke-width="1.8" class="spin git-empty-spinner" />
      <p class="git-empty-title">
        Loading…
      </p>
    </div>
    <div v-else-if="status?.isClean" class="git-empty">
      <div class="git-empty-icon-wrap git-empty-icon-wrap--ok">
        <Check :size="18" :stroke-width="2" />
      </div>
      <p class="git-empty-title">
        Nothing to see here…
      </p>
      <p class="git-empty-hint">
        No changes to review.
      </p>
    </div>

    <!-- File List & Inline Diffs -->
    <div v-else class="file-list">
      <div v-for="f in displayedFiles" :key="f.path" class="file-wrapper" :class="{ 'file-wrapper--expanded': expandedFiles.has(f.path) }">
        <div class="file-row" @click="toggleFile(f.path, filter === 'staged')">
          <!-- Status badge -->
          <span class="file-status-badge" :class="getDotClass(f)">{{ getStatusLabel(f) }}</span>

          <!-- File name -->
          <div class="file-name">
            <span class="file-dir">{{ f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/') + 1) : '' }}</span>
            <span class="file-base">{{ f.path.includes('/') ? f.path.substring(f.path.lastIndexOf('/') + 1) : f.path }}</span>
          </div>

          <div class="file-row-right">
            <!-- Action buttons — always visible, highlighted on row hover -->
            <div class="file-actions">
              <button
                v-if="filter === 'unstaged'"
                class="file-action-btn file-action-btn--discard"
                title="Discard changes"
                @click.stop="discardFile(f.path)"
              >
                <Undo2 :size="12" />
              </button>
              <button
                v-if="filter === 'unstaged'"
                class="file-action-btn file-action-btn--stage"
                title="Stage file"
                @click.stop="stageFile(f.path)"
              >
                <Plus :size="12" />
              </button>
              <button
                v-if="filter === 'staged'"
                class="file-action-btn file-action-btn--unstage"
                title="Unstage file"
                @click.stop="unstageFile(f.path)"
              >
                <Minus :size="12" />
              </button>
            </div>

            <ChevronDown v-if="expandedFiles.has(f.path)" :size="13" class="chevron chevron--open" />
            <ChevronRight v-else :size="13" class="chevron" />
          </div>
        </div>

        <!-- Inline Diff -->
        <Transition name="diff-expand">
          <div v-if="expandedFiles.has(f.path)" class="inline-diff">
            <div v-if="diffLoading.has(f.path)" class="diff-loading">
              <Loader2 :size="14" class="spin" />
              <span>Loading diff…</span>
            </div>
            <div v-else-if="!parsedDiffs[f.path]?.length" class="diff-empty">
              No diff available or binary file
            </div>
            <div v-else class="diff-content">
              <div v-for="(hunk, i) in parsedDiffs[f.path]" :key="i" class="diff-hunk">
                <div class="hunk-header">
                  {{ hunk.header }}
                </div>
                <template v-for="(block, j) in hunk.blocks" :key="j">
                  <div v-if="block.type === 'ctx'" class="diff-ctx-block">
                    <div class="ctx-header" @click="block.expanded = !block.expanded">
                      <div class="ctx-gutter">
                        <ChevronDown v-if="block.expanded" :size="11" />
                        <ChevronRight v-else :size="11" />
                      </div>
                      <div class="ctx-text">
                        {{ block.lines.length }} unchanged line{{ block.lines.length !== 1 ? 's' : '' }}
                      </div>
                    </div>
                    <template v-if="block.expanded">
                      <div v-for="(line, k) in block.lines" :key="k" class="diff-line diff-ctx">
                        <div class="line-gutter">
                          <span class="line-num">{{ line.oldLine }}</span>
                          <span class="line-num">{{ line.newLine }}</span>
                        </div>
                        <div class="line-sign" />
                        <div class="line-text">
                          {{ line.text }}
                        </div>
                      </div>
                    </template>
                  </div>

                  <template v-else>
                    <div v-for="(line, k) in block.lines" :key="k" class="diff-line" :class="`diff-${line.type}`">
                      <div class="line-gutter">
                        <span class="line-num">{{ line.oldLine }}</span>
                        <span class="line-num">{{ line.newLine }}</span>
                      </div>
                      <div class="line-sign">
                        {{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}
                      </div>
                      <div class="line-text">
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
    </div>

    <!-- Bottom Action Bar -->
    <div v-if="displayedFiles.length > 0" class="bottom-bar">
      <template v-if="filter === 'unstaged'">
        <button class="bottom-btn bottom-btn--ghost" @click="revertAll">
          <Undo2 :size="12" />
          Discard all
        </button>
        <button class="bottom-btn bottom-btn--primary" @click="stageAll">
          <Plus :size="12" />
          Stage all
        </button>
      </template>
      <template v-else>
        <button class="bottom-btn bottom-btn--ghost" @click="unstageAll">
          <Minus :size="12" />
          Unstage all
        </button>
        <button class="bottom-btn bottom-btn--primary" @click="showCommitModal = true">
          <GitCommit :size="12" />
          Commit
        </button>
      </template>
    </div>

    <!-- Commit Modal -->
    <Transition name="modal">
      <div v-if="showCommitModal" class="commit-modal-overlay" @click.self="showCommitModal = false">
        <div class="commit-modal">
          <div class="modal-header">
            <GitCommit :size="14" class="modal-header-icon" />
            <span class="modal-title">Commit changes</span>
            <button class="icon-btn" @click="showCommitModal = false">
              <X :size="13" />
            </button>
          </div>

          <div class="modal-body">
            <div class="modal-meta">
              <div class="modal-meta-row">
                <span class="meta-label">Branch</span>
                <span class="meta-value branch-value">
                  <GitBranch :size="11" />
                  {{ status?.branch || 'main' }}
                </span>
              </div>
              <div class="modal-meta-row">
                <span class="meta-label">Files</span>
                <span class="meta-value">{{ unstagedCount + stagedCount }} changed</span>
              </div>
            </div>

            <div class="modal-toggle-row">
              <label class="toggle-switch">
                <input v-model="includeUnstaged" type="checkbox">
                <span class="toggle-track">
                  <span class="toggle-thumb" />
                </span>
              </label>
              <span class="toggle-label">Include unstaged changes</span>
            </div>

            <div class="commit-input-group">
              <label class="input-label">
                <span>Commit message</span>
                <span class="input-label-hint">optional</span>
              </label>
              <textarea
                v-model="commitMsg"
                class="commit-textarea"
                placeholder="Leave blank to autogenerate…"
                rows="3"
              />
            </div>
          </div>

          <div class="modal-footer">
            <button class="footer-btn footer-btn--cancel" @click="showCommitModal = false">
              Cancel
            </button>
            <button class="footer-btn footer-btn--commit" @click="commitFromModal">
              <GitCommit :size="12" />
              Commit
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="git-toast" :class="`git-toast--${toast.type}`">
        <Check v-if="toast.type === 'ok'" :size="12" />
        <X v-else :size="12" />
        {{ toast.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Base ────────────────────────────────────────────────────── */
.git-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  font-family: ui-sans-serif, system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}

/* ── Pane Header ─────────────────────────────────────────────── */
.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  height: 36px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.pane-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  text-transform: uppercase;
}
.pane-title-icon {
  color: var(--color-text-dim);
}
.pane-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* ── Icon Buttons ────────────────────────────────────────────── */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  transition:
    background 100ms ease,
    color 100ms ease;
  flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.icon-btn:active:not(:disabled) {
  transform: scale(0.92);
}
.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
/* ── Filter Bar ──────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
  padding: 6px 8px 0;
  gap: 4px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
}
.filter-tabs {
  display: flex;
  flex: 1;
  gap: 2px;
}
.filter-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 7px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-dim);
  cursor: pointer;
  transition:
    color 100ms ease,
    border-color 100ms ease;
  margin-bottom: -1px;
}
.filter-tab:hover {
  color: var(--color-text-secondary);
}
.filter-tab.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent, #58a6ff);
}
.tab-count {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
  transition:
    background 100ms ease,
    color 100ms ease;
  letter-spacing: 0;
}
.tab-count--active {
  background: color-mix(in srgb, var(--color-accent, #58a6ff) 15%, transparent);
  color: var(--color-accent, #58a6ff);
}

/* ── File List ───────────────────────────────────────────────── */
.file-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 52px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}
.file-wrapper {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
}
.file-wrapper--expanded {
  background: color-mix(in srgb, var(--color-bg-surface) 40%, transparent);
}
.file-row {
  display: flex;
  align-items: center;
  padding: 0 10px;
  height: 32px;
  cursor: pointer;
  gap: 8px;
  transition: background 80ms ease;
}
.file-row:hover {
  background: var(--color-bg-hover);
}

/* Status badge */
.file-status-badge {
  font-size: 10px;
  font-weight: 700;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0;
}
.dot-added {
  background: color-mix(in srgb, #4ade80 18%, transparent);
  color: #4ade80;
}
.dot-modified {
  background: color-mix(in srgb, #60a5fa 18%, transparent);
  color: #60a5fa;
}
.dot-deleted {
  background: color-mix(in srgb, #f87171 18%, transparent);
  color: #f87171;
}

/* File name */
.file-name {
  flex: 1;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.file-dir {
  color: var(--color-text-dim);
}
.file-base {
  color: var(--color-text-primary);
}

/* Right side actions */
.file-row-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.file-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  /* Always visible but subtle; pop on row hover */
  opacity: 0.35;
  transition: opacity 120ms ease;
}
.file-row:hover .file-actions {
  opacity: 1;
}
.file-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition:
    background 100ms ease,
    color 100ms ease;
}
.file-action-btn--discard {
  color: var(--color-text-dim);
}
.file-action-btn--discard:hover {
  background: color-mix(in srgb, #f87171 15%, transparent);
  color: #f87171;
}
.file-action-btn--stage {
  color: var(--color-text-dim);
}
.file-action-btn--stage:hover {
  background: color-mix(in srgb, #4ade80 15%, transparent);
  color: #4ade80;
}
.file-action-btn--unstage {
  color: var(--color-text-dim);
}
.file-action-btn--unstage:hover {
  background: color-mix(in srgb, #60a5fa 15%, transparent);
  color: #60a5fa;
}
.chevron {
  color: var(--color-text-dim);
  opacity: 0.5;
  transition:
    opacity 100ms ease,
    transform 200ms ease;
}
.chevron--open {
  opacity: 0.8;
}

/* ── Inline Diff ─────────────────────────────────────────────── */
.inline-diff {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11.5px;
  line-height: 1.55;
  overflow-x: auto;
  scrollbar-width: thin;
  border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
}
.diff-loading,
.diff-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 16px;
  color: var(--color-text-dim);
  font-size: 11.5px;
  font-family: inherit;
}
.diff-content {
  min-width: max-content;
}
.hunk-header {
  padding: 3px 12px;
  font-size: 10.5px;
  color: var(--color-text-dim);
  background: color-mix(in srgb, var(--color-bg-surface) 60%, var(--color-bg-base));
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  user-select: none;
}
.diff-ctx-block {
  display: flex;
  flex-direction: column;
}
.ctx-header {
  display: flex;
  align-items: center;
  background: color-mix(in srgb, var(--color-bg-surface) 30%, var(--color-bg-base));
  color: var(--color-text-dim);
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  transition: background 80ms ease;
}
.ctx-header:hover {
  background: var(--color-bg-hover);
}
.ctx-gutter {
  width: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 3px 0;
  border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
}
.ctx-text {
  padding: 3px 12px;
  font-size: 10.5px;
  letter-spacing: 0.01em;
}

.diff-line {
  display: flex;
  align-items: stretch;
}
.line-gutter {
  display: flex;
  width: 72px;
  flex-shrink: 0;
  border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 30%, transparent);
}
.line-num {
  width: 36px;
  text-align: right;
  padding: 0 6px;
  color: var(--color-text-dim);
  opacity: 0.5;
  user-select: none;
  font-size: 10.5px;
  line-height: inherit;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.line-sign {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-weight: 600;
  font-size: 12px;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.line-text {
  padding: 0 12px;
  white-space: pre;
  flex: 1;
}

/* Add */
.diff-add {
  background: color-mix(in srgb, #238636 12%, transparent);
}
.diff-add .line-sign {
  color: #3fb950;
}
.diff-add .line-text {
  color: #aff5b4;
}
.diff-add .line-gutter {
  background: color-mix(in srgb, #238636 8%, transparent);
}

/* Delete */
.diff-del {
  background: color-mix(in srgb, #da3633 12%, transparent);
}
.diff-del .line-sign {
  color: #f85149;
}
.diff-del .line-text {
  color: #ffa198;
}
.diff-del .line-gutter {
  background: color-mix(in srgb, #da3633 8%, transparent);
}

/* Context */
.diff-ctx .line-text {
  color: var(--color-text-dim);
  opacity: 0.7;
}

/* ── Bottom Action Bar ───────────────────────────────────────── */
.bottom-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-base);
  border-top: 1px solid var(--color-border-subtle);
  z-index: 5;
}
.bottom-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 100ms ease,
    border-color 100ms ease,
    color 100ms ease;
  white-space: nowrap;
}
.bottom-btn:active {
  transform: scale(0.97);
}
.bottom-btn--ghost {
  background: transparent;
  border-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
}
.bottom-btn--ghost:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}
.bottom-btn--primary {
  background: var(--color-text-primary);
  color: var(--color-bg-base);
}
.bottom-btn--primary:hover {
  opacity: 0.88;
}

/* ── Empty States ────────────────────────────────────────────── */
.git-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  flex: 1;
  text-align: center;
}
.git-empty-icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 4px;
}
.git-empty-icon-wrap--ok {
  background: color-mix(in srgb, #238636 12%, transparent);
  color: #3fb950;
  border-color: color-mix(in srgb, #238636 25%, transparent);
}
.git-empty-spinner {
  color: var(--color-text-dim);
}
.git-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
.git-empty-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-dim);
  max-width: 200px;
  line-height: 1.5;
}

/* ── Commit Modal ────────────────────────────────────────────── */
.commit-modal-overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}
.commit-modal {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04) inset,
    0 16px 48px rgba(0, 0, 0, 0.55);
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.modal-header-icon {
  color: var(--color-text-dim);
}
.modal-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.modal-body {
  padding: 14px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--color-bg-base);
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
}
.modal-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.meta-label {
  color: var(--color-text-dim);
}
.meta-value {
  color: var(--color-text-secondary);
  font-weight: 500;
}
.branch-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Toggle */
.modal-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.toggle-switch {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}
.toggle-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-track {
  display: block;
  width: 30px;
  height: 17px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 17px;
  position: relative;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  background: var(--color-text-dim);
  border-radius: 50%;
  transition:
    transform 150ms ease,
    background 150ms ease;
}
.toggle-switch input:checked + .toggle-track {
  background: color-mix(in srgb, var(--color-accent, #58a6ff) 25%, transparent);
  border-color: var(--color-accent, #58a6ff);
}
.toggle-switch input:checked + .toggle-track .toggle-thumb {
  transform: translateX(13px);
  background: var(--color-accent, #58a6ff);
}
.toggle-label {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* Commit input */
.commit-input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.input-label {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
.input-label-hint {
  color: var(--color-text-dim);
  font-weight: 400;
}
.commit-textarea {
  width: 100%;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 12px;
  resize: none;
  box-sizing: border-box;
  line-height: 1.5;
  transition: border-color 100ms ease;
}
.commit-textarea:focus {
  outline: none;
  border-color: var(--color-accent, #58a6ff);
}
.commit-textarea::placeholder {
  color: var(--color-text-dim);
}

/* Modal footer */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-subtle);
}
.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 100ms ease,
    opacity 100ms ease;
}
.footer-btn:active {
  transform: scale(0.97);
}
.footer-btn--cancel {
  background: transparent;
  border-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
}
.footer-btn--cancel:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.footer-btn--commit {
  background: var(--color-text-primary);
  color: var(--color-bg-base);
}
.footer-btn--commit:hover {
  opacity: 0.88;
}

/* ── Toast ───────────────────────────────────────────────────── */
.git-toast {
  position: absolute;
  bottom: 58px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  z-index: 200;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.git-toast--ok {
  background: color-mix(in srgb, #238636 18%, var(--color-bg-elevated));
  color: #3fb950;
  border: 1px solid color-mix(in srgb, #238636 30%, transparent);
}
.git-toast--err {
  background: color-mix(in srgb, #da3633 18%, var(--color-bg-elevated));
  color: #f85149;
  border: 1px solid color-mix(in srgb, #da3633 30%, transparent);
}

/* ── Transitions ─────────────────────────────────────────────── */
.toast-enter-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.toast-leave-active {
  transition:
    opacity 130ms ease,
    transform 130ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

.modal-enter-active {
  transition: opacity 150ms ease;
}
.modal-leave-active {
  transition: opacity 120ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .commit-modal {
  transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-enter-from .commit-modal {
  transform: scale(0.96) translateY(4px);
}

.diff-expand-enter-active {
  transition: opacity 120ms ease;
}
.diff-expand-leave-active {
  transition: opacity 80ms ease;
}
.diff-expand-enter-from,
.diff-expand-leave-to {
  opacity: 0;
}

.spin {
  animation: git-spin 0.9s linear infinite;
}
@keyframes git-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
