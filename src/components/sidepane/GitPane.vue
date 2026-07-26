<script setup lang="ts">
import type { Component } from 'vue'
import type { Message } from '@/stores/chat'
import type { GitFileEntry, GitStashEntry, GitStatusResult } from '@/utils/git'
import type { WorktreeEntry } from '@/utils/worktrees'
import { generateText } from 'ai'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpToLine,
  Blocks,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  FileText,
  GitBranch,
  GitCommit,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Undo2,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { buildCommitPrompt } from '@/prompts/commit'
import { useChatStore } from '@/stores/chat'
import { resolveLanguageModel } from '@/stores/chat/models'
import { useGitPaneStore } from '@/stores/gitPane'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { buildLanguageModel } from '@/utils/ai'
import {
  gitCommit,
  gitDiff,
  gitDiffNoIndex,
  gitDiffStaged,
  gitDiffStagedStat,
  gitDiscard,
  gitDiscardUntracked,
  gitFetch,
  gitPull,
  gitPush,
  gitStage,
  gitStageAll,
  gitStash,
  gitStashList,
  gitStashPop,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  isGitRepo,
} from '@/utils/git'
import { hooksConfigExists } from '@/utils/hooks'
import { commandTasks } from '@/utils/tools/shell'
import { inspectWorkspace, listWorktrees } from '@/utils/worktrees'
import BackgroundTasksReview from './BackgroundTasksReview.vue'
import DiffViewer from './DiffViewer.vue'
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

const loading = ref(false)
const isRepo = ref(false)
const status = ref<GitStatusResult | null>(null)
type PaneType = 'review' | 'tools' | 'plan' | 'tasks' | 'skillsMcp' | 'diffViewer' | 'hooks'
const activePane = ref<PaneType | null>(null)
const openedTabs = ref<PaneType[]>([])

const showTabMenu = ref(false)

function toggleTabMenu() {
  showTabMenu.value = !showTabMenu.value
}

function closeTabMenu() {
  showTabMenu.value = false
}

const gitPaneStore = useGitPaneStore()

const allPanes: TabMenuItem[] = [
  { id: 'review', label: 'Review', icon: FileText },
  { id: 'skillsMcp', label: 'Skills & MCP', icon: Blocks },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'plan', label: 'Plan', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: Terminal },
  { id: 'hooks', label: 'Hooks', icon: Zap },
]

const gitPaneOwner = computed(() => gitPaneStore.getOwner(props.tabId))

const filter = ref<'unstaged' | 'staged'>('unstaged')
const settingsStore = useSettingsStore()
const chatStore = useChatStore()
const projectStore = useProjectStore()

const worktrees = ref<WorktreeEntry[]>([])
const showWorktreePopover = ref(false)
const worktreeBtnRef = ref<HTMLElement | null>(null)
const worktreePopoverPos = ref({ x: 0, y: 0 })
const worktreesLoading = ref(false)

const unstagedCount = computed(() => (status.value?.unstaged.length || 0) + (status.value?.untracked.length || 0))
const stagedCount = computed(() => status.value?.staged.length || 0)
const toolEventCount = computed(() =>
  props.messages.reduce((count, message) => count + (message.role === 'assistant' ? message.toolEvents?.length ?? 0 : 0), 0),
)
const bgTaskCount = computed(() => commandTasks.value.filter(t => t.tabId === props.tabId && t.mode === 'background').length)
const planReviewRef = ref<{ hasPlans: boolean } | null>(null)
const hasPlanFiles = ref(false)

const showToolsTab = computed(() => toolEventCount.value > 0)
const showPlanTab = computed(() => hasPlanFiles.value || planReviewRef.value?.hasPlans === true)
const showTasksTab = computed(() => bgTaskCount.value > 0)
const showHooksTab = ref(false)

async function checkHooksConfig() {
  showHooksTab.value = await hooksConfigExists(props.cwd)
}

const diffViewerFileName = computed(() => {
  const filePath = gitPaneOwner.value.diffViewerData?.filePath
  if (!filePath)
    return 'Diff'
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? 'Diff'
})

const availablePanes = computed(() => {
  const panes: TabMenuItem[] = []
  if (isRepo.value)
    panes.push(allPanes.find(p => p.id === 'review')!)
  panes.push(allPanes.find(p => p.id === 'skillsMcp')!)
  if (showToolsTab.value)
    panes.push(allPanes.find(p => p.id === 'tools')!)
  if (showTasksTab.value)
    panes.push(allPanes.find(p => p.id === 'tasks')!)
  if (showPlanTab.value)
    panes.push(allPanes.find(p => p.id === 'plan')!)
  if (showHooksTab.value)
    panes.push(allPanes.find(p => p.id === 'hooks')!)
  return panes
})

const closedPanes = computed(() =>
  availablePanes.value.filter(p => !openedTabs.value.includes(p.id)),
)

function openTab(tab: PaneType) {
  if (!openedTabs.value.includes(tab)) {
    openedTabs.value.push(tab)
  }
  activePane.value = tab
  const closedIds = gitPaneOwner.value.closedPanes
  if (closedIds.includes(tab)) {
    gitPaneStore.setClosedPanes(props.tabId, closedIds.filter(t => t !== tab))
  }
  closeTabMenu()
}

function closeTab(tab: PaneType, event: Event) {
  event.stopPropagation()
  openedTabs.value = openedTabs.value.filter(t => t !== tab)
  if (activePane.value === tab) {
    const lastPane = openedTabs.value.at(-1)
    activePane.value = lastPane !== undefined ? lastPane : null
  }
  const closedIds = gitPaneOwner.value.closedPanes
  if (!closedIds.includes(tab)) {
    gitPaneStore.setClosedPanes(props.tabId, [...closedIds, tab])
  }
}

interface TabMenuItem {
  id: PaneType
  label: string
  icon: Component
}

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
  if (detail?.tabId !== props.tabId)
    return
  if (!detail.filePath || !detail.diff)
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

const displayedFiles = computed(() => {
  if (!status.value)
    return []
  if (filter.value === 'unstaged') {
    return [...status.value.conflicts, ...status.value.unstaged, ...status.value.untracked]
  }
  return status.value.staged
})

// Use reactive collections so Vue tracks mutations correctly
const expandedFiles = reactive(new Set<string>())
const diffLoading = reactive(new Set<string>())
const parsedDiffs = reactive<Record<string, ParsedDiff[]>>({})

const commitMsg = ref('')
const showCommitModal = ref(false)
const showDiscardAllModal = ref(false)
const busyAction = ref('')
const commitResult = ref<{ type: 'ok' | 'err'; text: string } | null>(null)
const stashes = ref<GitStashEntry[]>([])
let commitResultTimer: ReturnType<typeof setTimeout> | null = null

const includeUnstaged = computed({
  get: () => gitPaneOwner.value.includeUnstagedOnCommit,
  set: value => gitPaneStore.setCommitOptions(props.tabId, { includeUnstagedOnCommit: value }),
})
const skipCommitHooks = computed({
  get: () => gitPaneOwner.value.skipCommitHooks,
  set: value => gitPaneStore.setCommitOptions(props.tabId, { skipCommitHooks: value }),
})
const amendCommit = computed({
  get: () => gitPaneOwner.value.amendCommit,
  set: value => gitPaneStore.setCommitOptions(props.tabId, { amendCommit: value }),
})
const hasConflicts = computed(() => (status.value?.conflicts.length ?? 0) > 0)
const discardAllCount = computed(() => (status.value?.unstaged.length ?? 0) + (status.value?.untracked.length ?? 0))
const commitDisabledReason = computed(() => {
  if (hasConflicts.value)
    return 'Resolve conflicts before committing.'
  if (stagedCount.value === 0 && (!includeUnstaged.value || unstagedCount.value === 0))
    return 'No changes selected for commit.'
  return ''
})

async function refresh() {
  loading.value = true
  try {
    isRepo.value = await isGitRepo(props.cwd)
    if (isRepo.value) {
      status.value = await gitStatus(props.cwd)
      stashes.value = await gitStashList(props.cwd)
      loadWorktrees()
    }
    else {
      status.value = null
      stashes.value = []
    }
  }
  catch (err) {
    console.error('Failed to refresh git status', err)
    status.value = null
  }
  finally { loading.value = false }
}

function showCommitResult(type: 'ok' | 'err', text: string) {
  if (commitResultTimer)
    clearTimeout(commitResultTimer)
  commitResult.value = { type, text }
  commitResultTimer = setTimeout(() => { commitResult.value = null }, 3500)
}

async function doAction(name: string, fn: () => Promise<{ ok: boolean; stderr: string }>, successMsg?: string | null, errMsg?: string | null): Promise<boolean> {
  busyAction.value = name
  let success = false
  try {
    const r = await fn()
    if (r.ok) {
      success = true
      if (successMsg)
        showCommitResult('ok', successMsg)
    }
    else {
      if (errMsg)
        showCommitResult('err', errMsg)
      else if (r.stderr)
        showCommitResult('err', r.stderr)
    }

    try {
      await refresh()
    }
    catch (err) {
      console.error('refresh after action failed', err)
    }

    // Clear parsed diffs and expanded files in a reactive-friendly way
    Object.keys(parsedDiffs).forEach(k => delete parsedDiffs[k])
    expandedFiles.clear()
  }
  catch (err) {
    console.error('doAction error', err)
    showCommitResult('err', 'An unexpected error occurred')
  }

  finally { busyAction.value = '' }

  return success
}

const stageFile = (f: string) => doAction('Stage', () => gitStage(props.cwd, [f]))
const unstageFile = (f: string) => doAction('Unstage', () => gitUnstage(props.cwd, [f]))
function discardFile(f: string) {
  const isUntracked = status.value?.untracked.some(u => u.path === f)
  if (isUntracked) {
    return doAction('Discard', () => gitDiscardUntracked(props.cwd, [f]))
  }
  return doAction('Discard', () => gitDiscard(props.cwd, [f]))
}
const stageAll = () => doAction('Stage all', () => gitStageAll(props.cwd), null)
const unstageAll = () => doAction('Unstage all', () => gitUnstageAll(props.cwd))
const fetchRemote = () => doAction('Fetch', () => gitFetch(props.cwd), 'Fetched remote refs')
const pullRemote = () => doAction('Pull', () => gitPull(props.cwd), 'Pulled latest changes')
const pushRemote = () => doAction('Push', () => gitPush(props.cwd), 'Pushed commits')
const stashChanges = () => doAction('Stash', () => gitStash(props.cwd, `WIP from Emty Agent ${new Date().toISOString()}`), 'Stashed changes')
const popStash = () => doAction('Pop stash', () => gitStashPop(props.cwd), 'Applied latest stash')
function revertAll() {
  if (discardAllCount.value === 0)
    return
  showDiscardAllModal.value = true
}

function discardAllConfirmed() {
  if (!status.value)
    return
  if (discardAllCount.value === 0)
    return

  const trackedPaths = status.value.unstaged.map(f => f.path).filter(p => !status.value!.untracked.some(u => u.path === p))
  const untrackedPaths = status.value.untracked.map(f => f.path)

  showDiscardAllModal.value = false
  doAction('Discard all', async () => {
    let trackedRes = { ok: true, stderr: '' }
    let untrackedRes = { ok: true, stderr: '' }
    if (trackedPaths.length)
      trackedRes = await gitDiscard(props.cwd, trackedPaths)
    if (untrackedPaths.length)
      untrackedRes = await gitDiscardUntracked(props.cwd, untrackedPaths)
    return {
      ok: trackedRes.ok && untrackedRes.ok,
      stderr: [trackedRes.stderr, untrackedRes.stderr].filter(Boolean).join('; '),
    }
  })
}

const isCommitting = ref(false)

function normalizeCommitMessage(message: string): string {
  return message
    .trim()
    .replace(/^```(?:gitcommit|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

async function commitFromModal() {
  if (isCommitting.value)
    return
  if (commitDisabledReason.value) {
    showCommitResult('err', commitDisabledReason.value)
    return
  }
  isCommitting.value = true
  try {
    if (includeUnstaged.value && unstagedCount.value > 0) {
      const r = await gitStageAll(props.cwd)
      if (!r.ok) {
        showCommitResult('err', r.stderr || 'Failed to stage files')
        return
      }
    }

    let msg = commitMsg.value.trim()

    if (!msg) {
      try {
        const [diff, stat] = await Promise.all([
          gitDiffStaged(props.cwd),
          gitDiffStagedStat(props.cwd),
        ])
        if (!diff.trim()) {
          showCommitResult('err', 'No staged changes to commit')
          return
        }

        if (!settingsStore.activeModel) {
          showCommitResult('err', 'Please select an AI model in settings to autogenerate commit message.')
          return
        }

        const languageModel = resolveLanguageModel(settingsStore.activeModel, settingsStore, buildLanguageModel)
        const prompt = buildCommitPrompt(diff, stat)

        const result = await generateText({
          model: languageModel,
          prompt,
          system: prompt,
        })

        msg = normalizeCommitMessage(result.text)
      }
      catch (e) {
        showCommitResult('err', `Failed to generate commit message: ${String(e)}`)
        return
      }
    }

    if (!msg) {
      showCommitResult('err', 'Commit message cannot be empty')
      return
    }

    const success = await doAction(
      'Commit',
      () => gitCommit(props.cwd, msg, {
        amend: amendCommit.value,
        skipHooks: skipCommitHooks.value,
      }),
      amendCommit.value ? 'Commit amended' : 'Committed',
      'Commit failed',
    )
    if (success) {
      commitMsg.value = ''
      showCommitModal.value = false
      amendCommit.value = false
    }
  }
  finally {
    isCommitting.value = false
  }
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
  if (expandedFiles.has(path)) {
    expandedFiles.delete(path)
  }
  else {
    expandedFiles.add(path)
    if (!parsedDiffs[path]) {
      diffLoading.add(path)
      try {
        const isUntrackedFile = !isStaged && !!status.value?.untracked.some(u => u.path === path)
        const raw = isUntrackedFile
          ? await gitDiffNoIndex(props.cwd, path)
          : await gitDiff(props.cwd, path, isStaged)

        parsedDiffs[path] = parseDiffIntoBlocks(raw)
      }
      catch (err) {
        console.error('Failed to load diff for', path, err)
      }
      finally {
        diffLoading.delete(path)
      }
    }
  }
}

watch(filter, () => {
  expandedFiles.clear()
})

watch(showToolsTab, val => {
  if (val && !gitPaneOwner.value.closedPanes.includes('tools')) {
    if (!openedTabs.value.includes('tools')) {
      openedTabs.value.push('tools')
      activePane.value = 'tools'
    }
  }
  else if (!val) {
    openedTabs.value = openedTabs.value.filter(t => t !== 'tools')
    if (activePane.value === 'tools') {
      const lastPane = openedTabs.value.at(-1)
      activePane.value = lastPane !== undefined ? lastPane : null
    }
  }
}, { immediate: true })

watch(showPlanTab, val => {
  if (val && !gitPaneOwner.value.closedPanes.includes('plan')) {
    if (!openedTabs.value.includes('plan')) {
      openedTabs.value.push('plan')
      activePane.value = 'plan'
    }
  }
  else if (!val) {
    openedTabs.value = openedTabs.value.filter(t => t !== 'plan')
    if (activePane.value === 'plan') {
      const lastPane = openedTabs.value.at(-1)
      activePane.value = lastPane !== undefined ? lastPane : null
    }
  }
}, { immediate: true })

watch(showTasksTab, val => {
  if (val && !gitPaneOwner.value.closedPanes.includes('tasks')) {
    if (!openedTabs.value.includes('tasks')) {
      openedTabs.value.push('tasks')
      activePane.value = 'tasks'
    }
  }
  else if (!val) {
    openedTabs.value = openedTabs.value.filter(t => t !== 'tasks')
    if (activePane.value === 'tasks') {
      const lastPane = openedTabs.value.at(-1)
      activePane.value = lastPane !== undefined ? lastPane : null
    }
  }
}, { immediate: true })

watch(isRepo, val => {
  if (val && !gitPaneOwner.value.closedPanes.includes('review') && !openedTabs.value.includes('review')) {
    openedTabs.value.push('review')
    activePane.value = 'review'
  }
}, { immediate: true })

// ── Scroll arrows for pane tabs ──────────────────────────────────────────────
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

onMounted(() => {
  ;(async () => {
    try {
      await refresh()
    }
    catch (err) {
      console.error('GitPane initial refresh failed', err)
    }
  })()
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

async function loadWorktrees() {
  if (!isRepo.value) {
    worktrees.value = []
    return
  }
  worktreesLoading.value = true
  try {
    const res = await listWorktrees(props.cwd)
    worktrees.value = res?.entries || []
  }
  catch (err) {
    console.error('Failed to load worktrees', err)
  }
  finally {
    worktreesLoading.value = false
  }
}

function updateWorktreePopoverPos() {
  if (!worktreeBtnRef.value)
    return
  const rect = worktreeBtnRef.value.getBoundingClientRect()
  const zoom = Number(document.documentElement.style.zoom) || 1
  const centerX = (rect.left + rect.width / 2) / zoom
  const vw = document.documentElement.clientWidth || window.innerWidth
  const popoverWidth = 260
  const halfWidth = popoverWidth / 2
  const padding = 12

  let boundedX = centerX
  if (boundedX - halfWidth < padding)
    boundedX = halfWidth + padding
  else if (boundedX + halfWidth > vw - padding)
    boundedX = vw - halfWidth - padding

  worktreePopoverPos.value = {
    x: Math.round(boundedX),
    y: Math.round((rect.bottom + 8) / zoom),
  }
}

function toggleWorktreePopover() {
  if (showWorktreePopover.value) {
    showWorktreePopover.value = false
  }
  else {
    updateWorktreePopoverPos()
    showWorktreePopover.value = true
  }
}

async function selectWorktree(path: string) {
  const snapshot = await inspectWorkspace(path)
  chatStore.setTabWorkspace(props.tabId, {
    workspacePath: path,
    workspaceMeta: snapshot,
  })
  projectStore.setProject(path)
  showWorktreePopover.value = false
}

let worktreeScrollRafId: number | null = null
function handleWorktreeScroll() {
  if (!showWorktreePopover.value)
    return
  if (!worktreeScrollRafId) {
    worktreeScrollRafId = requestAnimationFrame(() => {
      updateWorktreePopoverPos()
      worktreeScrollRafId = null
    })
  }
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

onUnmounted(() => {
  cancelAnimationFrame(paneScrollRaf)
  paneResizeObserver?.disconnect()
  paneMutationObserver?.disconnect()
  if (commitResultTimer) {
    clearTimeout(commitResultTimer)
    commitResultTimer = null
  }
  window.removeEventListener('emty:plan-created', handlePlanCreated)
  window.removeEventListener('emty:open-diff-viewer', handleOpenDiffViewer)
  window.removeEventListener('resize', updateWorktreePopoverPos)
  window.removeEventListener('scroll', handleWorktreeScroll, { capture: true })
})

watch(() => props.cwd, () => {
  refresh()
  checkHooksConfig()
})

// Reusable utility classes mapped to Tailwind
const iconBtnClass = 'inline-flex items-center justify-center w-[26px] h-[26px] border border-transparent rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-dim)] cursor-pointer transition-all duration-100 ease-in-out shrink-0 hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed active:not(:disabled):scale-[0.92]'

const popoverItemClass = 'flex items-center gap-2.5 py-2 px-2.5 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] cursor-pointer text-left transition-all duration-100 ease-in-out hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]'
const popoverItemActiveClass = 'bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] border-[var(--color-accent-dim)] text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)]'

const showActionsPopup = ref(false)

function toggleActionsPopup() {
  showActionsPopup.value = !showActionsPopup.value
}

function executeActionAndClose(fn: () => void) {
  fn()
  showActionsPopup.value = false
}

const bottomBtnClass = 'inline-flex items-center gap-[5px] py-[5px] px-[12px] rounded-[var(--radius-md)] text-[12px] font-medium cursor-pointer border transition-all duration-100 ease-in-out whitespace-nowrap active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none'

watch(openedTabs, () => {
  requestAnimationFrame(updatePaneScrollState)
}, { flush: 'post' })
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

    <div v-if="activePane === 'review'" class="flex items-center justify-between py-2 px-2.5 gap-2 shrink-0 border-b border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-bg-base)_80%,transparent)]">
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
            @click="toggleActionsPopup"
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
        <button :class="iconBtnClass" title="Refresh" :disabled="loading" @click="refresh">
          <RefreshCw :size="13" :class="{ 'animate-[spin_0.9s_linear_infinite]': loading }" />
        </button>
      </div>
    </div>

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

    <div v-if="activePane === 'review' && !isRepo" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
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
    <div v-else-if="activePane === 'review' && loading && !status" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
      <Loader2 :size="18" :stroke-width="1.8" class="animate-[spin_0.9s_linear_infinite] text-[var(--color-text-dim)]" />
      <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
        Loading…
      </p>
    </div>
    <div v-else-if="activePane === 'review' && status?.isClean" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
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

    <div v-else-if="activePane === 'review'" class="flex-1 overflow-y-auto pb-[52px] [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
      <div v-for="f in displayedFiles" :key="f.path" class="flex flex-col border-b border-[color-mix(in_srgb,var(--color-border-subtle)_50%,transparent)]" :class="{ 'bg-[color-mix(in_srgb,var(--color-bg-surface)_40%,transparent)]': expandedFiles.has(f.path) }">
        <div class="flex items-center px-2.5 h-8 cursor-pointer gap-2 transition-colors duration-[80ms] ease-in-out hover:bg-[var(--color-state-hover)] group/file" @click="toggleFile(f.path, filter === 'staged')">
          <span
            class="text-[10px] font-bold w-4 h-4 rounded-[var(--radius-xs)] inline-flex items-center justify-center shrink-0 tracking-normal"
            :class="{
              'bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]': getDotClass(f) === 'dot-deleted',
              'bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]': getDotClass(f) === 'dot-added',
              'bg-[color-mix(in_srgb,var(--color-info)_18%,transparent)] text-[var(--color-info)]': getDotClass(f) === 'dot-modified',
            }"
          >
            {{ getStatusLabel(f) }}
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
      <div v-if="displayedFiles.length === 0" class="flex flex-col items-center justify-center gap-2 py-12 px-6 flex-1 text-center">
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-dim)]">
          Nothing to see here…
        </p>
        <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[200px] leading-[1.5]">
          {{ filter === 'staged' ? 'No staged changes.' : 'No unstaged changes.' }}
        </p>
      </div>
    </div>

    <div v-if="activePane === 'review' && displayedFiles.length > 0" class="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1.5 py-2 px-2.5 bg-[var(--color-bg-base)] border-t border-[var(--color-border-subtle)] z-10">
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

    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
        leave-active-class="transition-opacity duration-100 ease-[cubic-bezier(0.7,0,0.84,0)]"
        enter-from-class="opacity-0 [&_.commit-modal]:scale-[0.96] [&_.commit-modal]:translate-y-1"
        leave-to-class="opacity-0 [&_.commit-modal]:scale-[0.96] [&_.commit-modal]:translate-y-1"
      >
        <div v-if="showCommitModal" class="fixed inset-0 z-[99999] bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] flex items-center justify-center p-6" @click.self="showCommitModal = false">
          <div class="commit-modal bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-xl) w-full max-w-[480px] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.3)] overflow-hidden [transition:transform_150ms_cubic-bezier(0.16,1,0.3,1)]">
            <!-- Header -->
            <div class="flex flex-col gap-1.5 py-3.5 px-5 border-b border-(--color-border-subtle)">
              <div class="flex items-center gap-2.5">
                <div class="flex items-center justify-center w-6.5 h-6.5 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shrink-0">
                  <GitCommit :size="13" class="text-[var(--color-accent)]" />
                </div>
                <span class="flex-1 text-[14px] font-semibold text-[var(--color-text-primary)] truncate">Commit changes</span>
                <button class="inline-flex items-center justify-center w-6 h-6 rounded-(--radius-sm) border-none bg-transparent text-[var(--color-text-tertiary)] cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.94] active:duration-[80ms] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) shrink-0" @click="showCommitModal = false">
                  <X :size="13" />
                </button>
              </div>
              <!-- Branch / Files / Remote strip -->
              <div class="flex items-center gap-1.5 pl-[35px] flex-wrap">
                <span class="inline-flex items-center gap-1 py-0.5 px-2 rounded-(--radius-sm) bg-(--color-bg-card) border border-(--color-border-bright) font-mono text-[11px] text-[var(--color-text-primary)]">
                  <GitBranch :size="10" class="text-[var(--color-text-tertiary)]" />
                  {{ status?.branch || 'main' }}
                </span>
                <span class="text-[var(--color-text-dim)] text-[11px]">·</span>
                <span class="text-[11px] text-[var(--color-text-secondary)]">{{ unstagedCount + stagedCount }} file{{ (unstagedCount + stagedCount) === 1 ? '' : 's' }}</span>
                <template v-if="status?.upstream">
                  <span class="text-[var(--color-text-dim)] text-[11px]">·</span>
                  <span class="text-[11px] text-[var(--color-text-secondary)]">{{ status.upstream }}</span>
                  <template v-if="status.aheadCount > 0 || status.behindCount > 0">
                    <span class="text-[11px]">
                      <span :class="status.aheadCount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-dim)]'">+{{ status.aheadCount }}</span>
                      <span class="text-[var(--color-text-dim)]">/</span>
                      <span :class="status.behindCount > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-dim)]'">{{ status.behindCount }}</span>
                    </span>
                  </template>
                </template>
              </div>
            </div>

            <!-- Body -->
            <div class="flex flex-col overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-md)">
              <!-- Options as a settings card -->
              <div class="mx-5 mt-4 mb-1 rounded-(--radius-lg) bg-(--color-bg-card) border border-(--color-border-bright) overflow-hidden">
                <div class="flex items-center gap-2 px-3.5 py-2 border-b border-(--color-border-subtle)">
                  <span class="text-[10.5px] font-bold tracking-[0.06em] uppercase text-[var(--color-text-dim)] select-none">Options</span>
                </div>
                <div class="flex flex-col">
                  <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                    <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                      <input v-model="includeUnstaged" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                      <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                      <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                    </span>
                    <div class="flex flex-col min-w-0">
                      <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Include unstaged changes</span>
                      <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Stage all working tree changes before committing</span>
                    </div>
                  </label>
                  <div class="mx-4 h-px bg-(--color-border-subtle)" />
                  <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                    <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                      <input v-model="amendCommit" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                      <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                      <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                    </span>
                    <div class="flex flex-col min-w-0">
                      <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Amend previous commit</span>
                      <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Add staged changes to the last commit</span>
                    </div>
                  </label>
                  <div class="mx-4 h-px bg-(--color-border-subtle)" />
                  <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                    <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                      <input v-model="skipCommitHooks" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                      <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                      <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                    </span>
                    <div class="flex flex-col min-w-0">
                      <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Skip hooks</span>
                      <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Run commit with --no-verify flag</span>
                    </div>
                  </label>
                </div>
                <div v-if="skipCommitHooks" class="flex items-start gap-2 px-3.5 py-2 border-t border-(--color-border-subtle) bg-[color-mix(in_srgb,var(--color-warning)_6%,var(--color-bg-card))]">
                  <ShieldCheck :size="12" class="shrink-0 mt-0.5 text-[var(--color-warning)]" />
                  <span class="text-[11px] text-[var(--color-text-secondary)] leading-[1.45]">Hooks run until they finish. Skip only when checks have already passed.</span>
                </div>
              </div>

              <!-- Conflict warning -->
              <div v-if="hasConflicts" class="mx-5 mt-3">
                <div class="py-2.5 px-3 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] border border-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] flex flex-col gap-0.5">
                  <div class="font-bold text-[var(--color-danger)] text-[12px]">
                    Conflicts must be resolved
                  </div>
                  <div class="text-[11.5px] text-[var(--color-text-secondary)]">
                    {{ status?.conflicts.length }} conflicted file{{ status?.conflicts.length === 1 ? '' : 's' }} need attention.
                  </div>
                </div>
              </div>

              <!-- Commit message -->
              <div class="px-5 pt-3 pb-4 flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--color-text-dim)] select-none">Message</span>
                  <span class="text-[10px] text-[var(--color-text-dim)] font-medium">optional — auto-generated if blank</span>
                </div>
                <textarea
                  v-model="commitMsg"
                  class="w-full bg-(--color-bg-card) border border-(--color-border-mid) rounded-(--radius-lg) py-2.5 px-3.5 text-[var(--color-text-primary)] font-[inherit] text-[13px] resize-y min-h-[68px] box-border leading-[1.55] outline-none [transition:border-color_150ms_cubic-bezier(0.4,0,0.2,1),box-shadow_150ms_cubic-bezier(0.4,0,0.2,1)] focus:border-(--color-accent) focus:shadow-[0_0_0_3px_var(--color-accent-muted),0_0_0_1px_var(--color-accent-muted-plus)] placeholder-[var(--color-text-dim)]"
                  placeholder="Leave blank to autogenerate…"
                  rows="2"
                />

                <div v-if="commitResult && commitResult.type === 'err'" class="py-2 px-3 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] border border-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] flex flex-col gap-0.5">
                  <div class="font-bold text-[var(--color-danger)] text-[12px]">
                    Commit Failed
                  </div>
                  <div class="text-[11.5px] text-[var(--color-text-secondary)]">
                    {{ commitResult.text }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-end gap-2.5 py-3 px-5 bg-(--color-bg-surface) border-t border-(--color-border-mid)">
              <button class="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-(--radius-md) text-[12.5px] font-semibold cursor-pointer border border-(--color-border-mid) bg-transparent text-[var(--color-text-secondary)] [transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),color_120ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] active:duration-[80ms] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) hover:border-(--color-border-bright)" @click="showCommitModal = false">
                Cancel
              </button>
              <button class="inline-flex items-center justify-center gap-2 h-8 px-5 rounded-(--radius-md) text-[12.5px] font-bold cursor-pointer border border-transparent bg-[var(--color-accent)] text-[var(--color-bg-base)] [transition:opacity_120ms_cubic-bezier(0.4,0,0.2,1),box-shadow_120ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] active:duration-[80ms] hover:not(:disabled):opacity-90 hover:not(:disabled):shadow-[0_4px_12px_var(--color-accent-muted)] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="isCommitting || !!commitDisabledReason" :title="commitDisabledReason || 'Commit changes'" @click="commitFromModal">
                <Loader2 v-if="isCommitting" :size="13" class="animate-[spin_0.9s_linear_infinite]" />
                <GitCommit v-else :size="13" />
                {{ isCommitting ? (commitMsg.trim() ? 'Committing…' : 'Generating…') : 'Commit' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
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
              <button class="h-8 px-4 rounded-(--radius-sm) border border-transparent bg-(--color-danger) text-[13px] font-medium text-(--color-text-primary) cursor-pointer transition-[background,color] duration-[120ms] ease-[ease] hover:not(:disabled):opacity-90 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!!busyAction" @click="discardAllConfirmed">
                Discard
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div v-if="showWorktreePopover" class="fixed inset-0 z-[10010]" @click="showWorktreePopover = false" />
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

<style>
.pane-tab-list {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.pane-tab-list::-webkit-scrollbar {
  display: none;
}
</style>
