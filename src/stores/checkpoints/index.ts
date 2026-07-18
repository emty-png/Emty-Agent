/**
 * src/stores/checkpoints.ts
 *
 * Manages checkpoint/restore-point lifecycle:
 *   • Creating checkpoints before each user turn
 *   • Snapshotting file state before agent mutations
 *   • Restoring files + truncating messages on user restore
 */

import type { CheckpointFileRow } from '@/db/database'
import type { ChatTab, Message } from '@/stores/chat'
import { readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dbDeleteCheckpointsFrom,
  dbDeleteMessages,
  dbInsertCheckpoint,
  dbInsertCheckpointFile,
  dbLoadCheckpointFiles,
  dbLoadCheckpoints,
  dbUpdateConversationMsgCount,
} from '@/db/database'
import { resetCwd } from '@/utils/tools/shell'

// ── types ─────────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string
  tabId: string
  conversationId: string | null
  messageIndex: number
  label: string
  timestamp: number
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── store ─────────────────────────────────────────────────────────────────────

export const useCheckpointStore = defineStore('checkpoints', () => {
  /**
   * Reactive map: tabId → ordered array of checkpoints.
   * The ChatView reads this to render restore-point dividers.
   */
  const checkpointsByTab = ref<Record<string, Checkpoint[]>>({})

  // ── active recording state (per-tab, only one tab streams at a time) ──────
  let _activeCheckpointId: string | null = null
  let _activeTabId: string | null = null
  const _snapshotted = new Set<string>() // paths already captured this turn
  const _persistedCheckpointIds = new Set<string>()
  const _persistedCheckpointFiles = new Set<string>()

  /**
   * In-memory buffer of file snapshots for the current checkpoint.
   * Snapshots are written immediately when the checkpoint row is already
   * persisted, and finalized later as a fallback for early/offline captures.
   */
  const _pendingSnapshots: Array<{
    relativePath: string
    absolutePath: string
    content: string | null
    existed: boolean
  }> = []

  // ── public API ──────────────────────────────────────────────────────────────

  /**
   * Create a new checkpoint before a user message is sent.
   * Returns the checkpoint ID so filesystem tools can snapshot against it.
   */
  async function createCheckpoint(
    tabId: string,
    conversationId: string | null,
    messageIndex: number,
    userMessage: string,
  ): Promise<string> {
    const id = makeId()
    const label = userMessage.length > 40
      ? `${userMessage.slice(0, 40)}\u2026`
      : userMessage
    const timestamp = Date.now()

    const cp: Checkpoint = {
      id,
      tabId,
      conversationId,
      messageIndex,
      label,
      timestamp,
    }

    // Add to reactive state
    if (!checkpointsByTab.value[tabId]) {
      checkpointsByTab.value[tabId] = []
    }
    checkpointsByTab.value[tabId]!.push(cp)

    // Set up recording state
    _activeCheckpointId = id
    _activeTabId = tabId
    _snapshotted.clear()
    _pendingSnapshots.length = 0

    if (conversationId) {
      try {
        await dbInsertCheckpoint({
          id: cp.id,
          conversation_id: conversationId,
          message_index: cp.messageIndex,
          label: cp.label,
          created_at: cp.timestamp,
        })
        _persistedCheckpointIds.add(cp.id)
      }
      catch (e) {
        console.warn('[checkpoints] Failed to persist checkpoint immediately:', e)
      }
    }

    return id
  }

  /**
   * Snapshot every file a shell command is about to mutate. Used by
   * `run_command` to extend checkpoint coverage to operations like
   * `sed -i`, `rm`, `mv`, `cp`, `echo > file`, etc. No-ops when no
   * checkpoint is active.
   *
   * Errors are swallowed — a snapshot failure must never block the
   * command itself.
   */
  async function snapshotFilesFromCommand(
    command: string,
    cwd: string,
    projectPath: string,
  ): Promise<void> {
    if (!_activeCheckpointId)
      return
    if (!command.trim() || !projectPath)
      return

    try {
      const { extractShellMutationTargets } = await import(
        '@/utils/tools/shellMutations',
      )
      const targets = await extractShellMutationTargets(command, { cwd, projectPath })
      for (const t of targets) {
        await snapshotFile(t.relativePath, t.absolutePath)
      }
    }
    catch (e) {
      console.warn('[checkpoints] Failed to snapshot shell command mutations:', e)
    }
  }

  /**
   * Snapshot a file's current state before the agent mutates it.
   * Called by the filesystem tool wrappers. Deduplicates by path within
   * a single checkpoint (we always want the FIRST pre-mutation state).
   *
   * Snapshots are kept in memory for restore/finalize and persisted immediately
   * when the checkpoint row already exists in SQLite.
   *
   * @param relativePath — path relative to project root
   * @param absolutePath — resolved absolute path
   * @param prefetchedContent — when provided, skips disk read:
   *   - `string` = file content (tool already loaded it)
   *   - `null`    = file doesn't exist yet
   *   - omit/undefined = reads from disk
   */
  async function snapshotFile(
    relativePath: string,
    absolutePath: string,
    prefetchedContent?: string | null,
  ): Promise<void> {
    if (!_activeCheckpointId)
      return

    // Deduplicate — only capture the first snapshot per path per checkpoint
    const key = absolutePath.toLowerCase()
    if (_snapshotted.has(key))
      return
    _snapshotted.add(key)

    let content: string | null = null
    let existed = false

    if (prefetchedContent !== undefined) {
      // Tool already loaded the content — use it directly
      content = prefetchedContent
      existed = prefetchedContent !== null
    }
    else {
      // No prefetched content — read from disk
      try {
        content = await readTextFile(absolutePath)
        existed = true
      }
      catch {
        // File doesn't exist yet → will be deleted on restore
        content = null
        existed = false
      }
    }

    // Keep an in-memory copy so finalize/restore can still recover if the
    // immediate DB write below fails or the checkpoint row is not available yet.
    const snapshot = { relativePath, absolutePath, content, existed }
    _pendingSnapshots.push(snapshot)

    const activeCheckpoint = Object.values(checkpointsByTab.value)
      .flat()
      .find(c => c.id === _activeCheckpointId)
    if (!activeCheckpoint?.conversationId || !_persistedCheckpointIds.has(activeCheckpoint.id))
      return

    try {
      await dbInsertCheckpointFile({
        checkpoint_id: activeCheckpoint.id,
        relative_path: snapshot.relativePath,
        absolute_path: snapshot.absolutePath,
        content: snapshot.content,
        existed: snapshot.existed ? 1 : 0,
      })
      _persistedCheckpointFiles.add(`${activeCheckpoint.id}:${key}`)
    }
    catch (e) {
      console.warn('[checkpoints] Failed to persist file snapshot immediately:', e)
    }
  }

  /**
   * Finalize the current checkpoint after the agent turn completes.
   * Persists the checkpoint row FIRST, then all buffered file snapshots,
   * ensuring the FK constraint is satisfied.
   */
  async function finalizeCheckpoint(conversationId: string | null): Promise<void> {
    if (!_activeCheckpointId || !_activeTabId)
      return

    // Capture state and clear synchronously to prevent async race conditions
    const currentCheckpointId = _activeCheckpointId
    const currentTabId = _activeTabId

    _activeCheckpointId = null
    _activeTabId = null
    const pendingSnapshots = [..._pendingSnapshots]
    _pendingSnapshots.length = 0
    _snapshotted.clear()

    // Update the checkpoint's conversationId (may have been created during sendMessage)
    const tabCheckpoints = checkpointsByTab.value[currentTabId]
    const cp = tabCheckpoints?.find(c => c.id === currentCheckpointId)
    if (cp && conversationId) {
      cp.conversationId = conversationId
    }

    // Ensure the checkpoint row and any snapshots not already written are saved.
    if (cp?.conversationId) {
      try {
        if (!_persistedCheckpointIds.has(cp.id)) {
          await dbInsertCheckpoint({
            id: cp.id,
            conversation_id: cp.conversationId,
            message_index: cp.messageIndex,
            label: cp.label,
            created_at: cp.timestamp,
          })
          _persistedCheckpointIds.add(cp.id)
        }

        for (const snap of pendingSnapshots) {
          const key = `${cp.id}:${snap.absolutePath.toLowerCase()}`
          if (_persistedCheckpointFiles.has(key))
            continue

          try {
            await dbInsertCheckpointFile({
              checkpoint_id: cp.id,
              relative_path: snap.relativePath,
              absolute_path: snap.absolutePath,
              content: snap.content,
              existed: snap.existed ? 1 : 0,
            })
            _persistedCheckpointFiles.add(key)
          }
          catch (e) {
            console.warn('[checkpoints] Failed to persist file snapshot:', e)
          }
        }
      }
      catch (e) {
        console.warn('[checkpoints] Failed to persist checkpoint:', e)
      }
    }
  }

  /**
   * Restore to a specific checkpoint. This:
   * 1. Restores all file snapshots from the target checkpoint onward
   * 2. Truncates in-memory messages
   * 3. Deletes DB messages and later checkpoints
   */
  async function restoreToCheckpoint(
    tab: ChatTab,
    checkpointId: string,
    mode: 'full' | 'conversation' | 'files' = 'full',
  ): Promise<{ ok: boolean; error?: string }> {
    const tabCheckpoints = checkpointsByTab.value[tab.id]
    if (!tabCheckpoints)
      return { ok: false, error: 'No checkpoints for this tab' }

    const targetIdx = tabCheckpoints.findIndex(c => c.id === checkpointId)
    if (targetIdx === -1)
      return { ok: false, error: 'Checkpoint not found' }

    const target = tabCheckpoints[targetIdx]!

    // Gather all checkpoints that will be removed (target and everything after)
    const toRemove = tabCheckpoints.slice(targetIdx)

    if (mode !== 'conversation') {
      // ── Step 1: Collect file snapshots to restore ──────────────────────────
      // For each unique path, use the EARLIEST snapshot (from the target checkpoint)
      // because that represents the true "before" state.
      const fileRestoreMap = new Map<string, CheckpointFileRow>()

      for (const cp of toRemove) {
        if (!cp.conversationId)
          continue
        try {
          const files = await dbLoadCheckpointFiles(cp.id)
          for (const f of files) {
            const key = f.absolute_path.toLowerCase()
            if (!fileRestoreMap.has(key)) {
              fileRestoreMap.set(key, f)
            }
          }
        }
        catch (e) {
          console.warn('[checkpoints] Failed to load snapshots for', cp.id, e)
        }
      }

      // ── Step 2: Restore files ──────────────────────────────────────────────
      const errors: string[] = []

      for (const [, snapshot] of fileRestoreMap) {
        try {
          if (snapshot.existed && snapshot.content !== null) {
            await writeTextFile(snapshot.absolute_path, snapshot.content)
          }
          else {
            try {
              await remove(snapshot.absolute_path)
            }
            catch {
              // File may have already been deleted, that's fine
            }
          }
        }
        catch (e) {
          errors.push(`${snapshot.relative_path}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (errors.length > 0)
        console.warn('[checkpoints] Some files failed to restore:', errors)
    }

    if (mode !== 'files') {
      // ── Step 3: Truncate in-memory messages ────────────────────────────────
      const messagesToRemove = tab.messages.slice(target.messageIndex)
      tab.messages.splice(target.messageIndex)

      // ── Step 4: Delete DB messages ────────────────────────────────────────
      if (tab.conversationId) {
        const idsToDelete = messagesToRemove.map((m: Message) => m.id)
        try {
          await dbDeleteMessages(idsToDelete)
          await dbUpdateConversationMsgCount(tab.conversationId, tab.messages.length)
        }
        catch (e) {
          console.warn('[checkpoints] Failed to delete DB messages:', e)
        }
      }
    }

    if (tab.conversationId) {
      // ── Step 5: Delete checkpoints from DB ──────────────────────────────
      try {
        await dbDeleteCheckpointsFrom(tab.conversationId, target.timestamp)
      }
      catch (e) {
        console.warn('[checkpoints] Failed to delete DB checkpoints:', e)
      }
    }

    // ── Step 6: Remove checkpoints from reactive state ────────────────────
    checkpointsByTab.value[tab.id] = tabCheckpoints.slice(0, targetIdx)

    // ── Step 6b: Reset shell CWD to project root ─────────────────────────
    if (tab.workspacePath)
      resetCwd(tab.workspacePath)

    // ── Step 7: Refresh the file tree so the project view reflects changes ─
    try {
      const { useFileTreeStore } = await import('@/stores/fileTree')
      const ft = useFileTreeStore()
      await ft.loadTree()
    }
    catch {
      // File tree refresh is non-critical
    }

    return { ok: true }
  }

  /**
   * Load checkpoints from DB when opening a saved conversation.
   */
  async function loadForConversation(
    tabId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const rows = await dbLoadCheckpoints(conversationId)
      checkpointsByTab.value[tabId] = rows.map(r => ({
        id: r.id,
        tabId,
        conversationId,
        messageIndex: r.message_index,
        label: r.label,
        timestamp: r.created_at,
      }))
    }
    catch (e) {
      console.warn('[checkpoints] Failed to load checkpoints:', e)
    }
  }

  async function clearConversationCheckpoints(
    tabId: string,
    conversationId: string | null,
  ): Promise<void> {
    checkpointsByTab.value[tabId] = []
    if (!conversationId)
      return

    try {
      await dbDeleteCheckpointsFrom(conversationId, 0)
    }
    catch (e) {
      console.warn('[checkpoints] Failed to clear conversation checkpoints:', e)
    }
  }

  /**
   * Clear checkpoints for a tab (on tab close).
   */
  function clearTab(tabId: string, projectPath?: string): void {
    // If the tab being closed is mid-recording, reset active state
    if (_activeTabId === tabId) {
      _activeCheckpointId = null
      _activeTabId = null
      _snapshotted.clear()
      _pendingSnapshots.length = 0
    }
    delete checkpointsByTab.value[tabId]

    // Reset shell CWD to project root
    if (projectPath)
      resetCwd(projectPath)
  }

  /**
   * Get checkpoints for a specific tab (for ChatView rendering).
   */
  function getCheckpoints(tabId: string): Checkpoint[] {
    return checkpointsByTab.value[tabId] ?? []
  }

  return {
    checkpointsByTab,
    createCheckpoint,
    snapshotFile,
    snapshotFilesFromCommand,
    finalizeCheckpoint,
    restoreToCheckpoint,
    loadForConversation,
    clearConversationCheckpoints,
    clearTab,
    getCheckpoints,
  }
})
