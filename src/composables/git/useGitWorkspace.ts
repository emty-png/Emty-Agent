import type { Ref } from 'vue'
import type { GitStashEntry, GitStatusResult } from '@/utils/git'
import { generateText } from 'ai'
import { computed, ref, watch } from 'vue'
import { buildCommitPrompt } from '@/prompts/commit'
import { resolveLanguageModel } from '@/stores/chat/utils/modelResolver'
import { useGitPaneStore } from '@/stores/gitPane'
import { useSettingsStore } from '@/stores/settings'
import { buildLanguageModel } from '@/utils/ai'
import {
  gitCommit,
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

export interface ActionResult {
  ok: boolean
  stderr: string
}

export interface WorkspaceResult {
  type: 'ok' | 'err'
  text: string
}

const RESULT_VISIBLE_MS = 3500

/**
 * Encapsulates all git working-tree state and mutating actions for a single
 * tab: status polling, stage/unstage/discard, fetch/pull/push, stash
 * management, and the commit flow (including AI-generated commit messages).
 *
 * UI-only concerns (diff rendering, worktree popovers, tab layout) live in
 * the components that consume this composable — it deliberately has no
 * knowledge of them.
 */
export function useGitWorkspace(cwd: Ref<string>, tabId: string) {
  const gitPaneStore = useGitPaneStore()
  const settingsStore = useSettingsStore()
  const owner = computed(() => gitPaneStore.getOwner(tabId))

  const isRepo = ref(false)
  const status = ref<GitStatusResult | null>(null)
  const stashes = ref<GitStashEntry[]>([])
  const loading = ref(false)
  const busyAction = ref('')
  const result = ref<WorkspaceResult | null>(null)
  /** Bumped after every successful refresh so dependants (e.g. a worktree list) can react without deep-watching status. */
  const refreshedAt = ref(0)

  let resultTimer: ReturnType<typeof setTimeout> | null = null

  function showResult(type: WorkspaceResult['type'], text: string) {
    if (resultTimer)
      clearTimeout(resultTimer)
    result.value = { type, text }
    resultTimer = setTimeout(() => { result.value = null }, RESULT_VISIBLE_MS)
  }

  async function refresh() {
    loading.value = true
    try {
      isRepo.value = await isGitRepo(cwd.value)
      if (isRepo.value) {
        const [nextStatus, nextStashes] = await Promise.all([
          gitStatus(cwd.value),
          gitStashList(cwd.value),
        ])
        status.value = nextStatus
        stashes.value = nextStashes
      }
      else {
        status.value = null
        stashes.value = []
      }
      refreshedAt.value = Date.now()
    }
    catch (err) {
      console.error('Failed to refresh git status', err)
      status.value = null
    }
    finally {
      loading.value = false
    }
  }

  const unstagedCount = computed(() => (status.value?.unstaged.length ?? 0) + (status.value?.untracked.length ?? 0))
  const stagedCount = computed(() => status.value?.staged.length ?? 0)
  const hasConflicts = computed(() => (status.value?.conflicts.length ?? 0) > 0)
  const discardAllCount = computed(() => (status.value?.unstaged.length ?? 0) + (status.value?.untracked.length ?? 0))

  /** Runs a mutating git action, tracks busy/result state, and refreshes status afterwards. */
  async function runAction(
    name: string,
    fn: () => Promise<ActionResult>,
    successMsg?: string | null,
    errMsg?: string | null,
  ): Promise<boolean> {
    busyAction.value = name
    let success = false
    try {
      const outcome = await fn()
      if (outcome.ok) {
        success = true
        if (successMsg)
          showResult('ok', successMsg)
      }
      else if (errMsg) {
        showResult('err', errMsg)
      }
      else if (outcome.stderr) {
        showResult('err', outcome.stderr)
      }

      try {
        await refresh()
      }
      catch (err) {
        console.error('Failed to refresh git status after action', err)
      }
    }
    catch (err) {
      console.error(`Git action "${name}" failed`, err)
      showResult('err', 'An unexpected error occurred')
    }
    finally {
      busyAction.value = ''
    }
    return success
  }

  function stageFile(path: string) {
    return runAction('Stage', () => gitStage(cwd.value, [path]))
  }

  function unstageFile(path: string) {
    return runAction('Unstage', () => gitUnstage(cwd.value, [path]))
  }

  function discardFile(path: string) {
    const isUntracked = status.value?.untracked.some(u => u.path === path) ?? false
    return isUntracked
      ? runAction('Discard', () => gitDiscardUntracked(cwd.value, [path]))
      : runAction('Discard', () => gitDiscard(cwd.value, [path]))
  }

  const stageAll = () => runAction('Stage all', () => gitStageAll(cwd.value), null)
  const unstageAll = () => runAction('Unstage all', () => gitUnstageAll(cwd.value))
  const fetchRemote = () => runAction('Fetch', () => gitFetch(cwd.value), 'Fetched remote refs')
  const pullRemote = () => runAction('Pull', () => gitPull(cwd.value), 'Pulled latest changes')
  const pushRemote = () => runAction('Push', () => gitPush(cwd.value), 'Pushed commits')
  const stashChanges = () => runAction('Stash', () => gitStash(cwd.value, `WIP from Emty Agent ${new Date().toISOString()}`), 'Stashed changes')
  const popStash = () => runAction('Pop stash', () => gitStashPop(cwd.value), 'Applied latest stash')

  function discardAllConfirmed() {
    if (!status.value || discardAllCount.value === 0)
      return

    const untrackedPaths = status.value.untracked.map(f => f.path)
    const untrackedPathSet = new Set(untrackedPaths)
    const trackedPaths = status.value.unstaged
      .map(f => f.path)
      .filter(path => !untrackedPathSet.has(path))

    return runAction('Discard all', async () => {
      const [trackedResult, untrackedResult] = await Promise.all([
        trackedPaths.length ? gitDiscard(cwd.value, trackedPaths) : Promise.resolve<ActionResult>({ ok: true, stderr: '' }),
        untrackedPaths.length ? gitDiscardUntracked(cwd.value, untrackedPaths) : Promise.resolve<ActionResult>({ ok: true, stderr: '' }),
      ])
      return {
        ok: trackedResult.ok && untrackedResult.ok,
        stderr: [trackedResult.stderr, untrackedResult.stderr].filter(Boolean).join('; '),
      }
    })
  }

  // ── Commit flow ────────────────────────────────────────────────────────

  const commitMsg = ref('')
  const isCommitting = ref(false)

  const includeUnstaged = computed({
    get: () => owner.value.includeUnstagedOnCommit,
    set: (value: boolean) => gitPaneStore.setCommitOptions(tabId, { includeUnstagedOnCommit: value }),
  })
  const skipCommitHooks = computed({
    get: () => owner.value.skipCommitHooks,
    set: (value: boolean) => gitPaneStore.setCommitOptions(tabId, { skipCommitHooks: value }),
  })
  const amendCommit = computed({
    get: () => owner.value.amendCommit,
    set: (value: boolean) => gitPaneStore.setCommitOptions(tabId, { amendCommit: value }),
  })

  const commitDisabledReason = computed(() => {
    if (hasConflicts.value)
      return 'Resolve conflicts before committing.'
    if (stagedCount.value === 0 && (!includeUnstaged.value || unstagedCount.value === 0))
      return 'No changes selected for commit.'
    return ''
  })

  function normalizeCommitMessage(message: string): string {
    return message
      .trim()
      .replace(/^```(?:gitcommit|text)?\s*/i, '')
      .replace(/\s*```$/, '')
      .replace(/\r\n/g, '\n')
      .trim()
  }

  /** Thrown for user-facing preconditions (as opposed to unexpected generation failures). */
  class CommitMessageValidationError extends Error {}

  async function generateCommitMessage(): Promise<string> {
    const [diff, stat] = await Promise.all([
      gitDiffStaged(cwd.value),
      gitDiffStagedStat(cwd.value),
    ])
    if (!diff.trim())
      throw new CommitMessageValidationError('No staged changes to commit')

    if (!settingsStore.activeModel)
      throw new CommitMessageValidationError('Please select an AI model in settings to autogenerate commit message.')

    const languageModel = resolveLanguageModel(settingsStore.activeModel, settingsStore, buildLanguageModel)
    const prompt = buildCommitPrompt(diff, stat)
    const generated = await generateText({ model: languageModel, prompt, system: prompt })
    return normalizeCommitMessage(generated.text)
  }

  /** Stages unstaged changes if requested, generates a message when blank, then commits. */
  async function commit(): Promise<boolean> {
    if (isCommitting.value)
      return false
    if (commitDisabledReason.value) {
      showResult('err', commitDisabledReason.value)
      return false
    }

    isCommitting.value = true
    try {
      if (includeUnstaged.value && unstagedCount.value > 0) {
        const staged = await gitStageAll(cwd.value)
        if (!staged.ok) {
          showResult('err', staged.stderr || 'Failed to stage files')
          return false
        }
      }

      let message = commitMsg.value.trim()
      if (!message) {
        try {
          message = await generateCommitMessage()
        }
        catch (err) {
          showResult('err', err instanceof CommitMessageValidationError
            ? err.message
            : `Failed to generate commit message: ${err instanceof Error ? err.message : String(err)}`)
          return false
        }
      }

      if (!message) {
        showResult('err', 'Commit message cannot be empty')
        return false
      }

      const success = await runAction(
        'Commit',
        () => gitCommit(cwd.value, message, { amend: amendCommit.value, skipHooks: skipCommitHooks.value }),
        amendCommit.value ? 'Commit amended' : 'Committed',
        'Commit failed',
      )

      if (success) {
        commitMsg.value = ''
        amendCommit.value = false
      }
      return success
    }
    finally {
      isCommitting.value = false
    }
  }

  watch(cwd, () => { refresh() })

  function dispose() {
    if (resultTimer) {
      clearTimeout(resultTimer)
      resultTimer = null
    }
  }

  return {
    // state
    isRepo,
    status,
    stashes,
    loading,
    busyAction,
    result,
    refreshedAt,
    // derived
    unstagedCount,
    stagedCount,
    hasConflicts,
    discardAllCount,
    // status actions
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
    // commit flow
    commitMsg,
    isCommitting,
    includeUnstaged,
    skipCommitHooks,
    amendCommit,
    commitDisabledReason,
    commit,
    // lifecycle
    dispose,
  }
}
