/**
 * src/stores/designVersions/index.ts
 *
 * Per-conversation design versioning (mode-specific).
 * - Disk: ~/.emty/designs/{name}/.versions/v{n}/ holds full 3-file snapshots
 * - DB: design_versions table is the source of truth for listing/restore
 * - In-memory: tab.designVersions mirrors DB, updated at turn finalize
 */

import type { ChatTab, DesignVersionRef } from '@/stores/chat/core/types'
import { join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dbDeleteDesignVersions,
  dbDeleteMessages,
  dbGetDesignVersion,
  dbInsertDesignVersion,
  dbLoadDesignVersions,
  dbUpdateConversationMsgCount,
  dbUpdateMessage,
} from '@/db/database'
import { DESIGN_FILES } from '@/utils/tools/designProject'

export const MAX_VERSIONS_PER_CONVERSATION = 50

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function _basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}
void _basename

// ── Pending per-turn buffer (only one tab streams at a time, but key by tabId for safety) ──

interface PendingSnapshot {
  tabId: string
  conversationId: string | null
  messageId: string | null
  projectPath: string
  projectName: string
  // accumulated file contents for this turn, keyed by DESIGN_FILES entry
  files: Map<string, string>
  // files that were flagged as written/skipped via tool result
  writtenFiles: Set<string>
}

const pendingByTab = new Map<string, PendingSnapshot>()

export const useDesignVersionStore = defineStore('designVersions', () => {
  const versionsByConversation = ref<Record<string, DesignVersionRef[]>>({})
  // currently previewed version id per tab
  const previewByTab = ref<Record<string, string | null>>({})

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getVersions(conversationId: string): DesignVersionRef[] {
    return versionsByConversation.value[conversationId] ?? []
  }

  function getByMessageId(messageId: string): DesignVersionRef | undefined {
    for (const list of Object.values(versionsByConversation.value)) {
      const found = list.find(v => v.messageId === messageId)
      if (found)
        return found
    }
    return undefined
  }

  function getPreviewId(tabId: string): string | null {
    return previewByTab.value[tabId] ?? null
  }

  function setPreview(tabId: string, versionId: string | null): void {
    previewByTab.value[tabId] = versionId ?? null
  }

  async function loadForConversation(conversationId: string): Promise<DesignVersionRef[]> {
    const rows = await dbLoadDesignVersions(conversationId)
    const mapped: DesignVersionRef[] = rows.map(r => ({
      id: r.id,
      conversationId: r.conversation_id,
      versionNumber: r.version_number,
      messageId: r.message_id,
      projectPath: r.project_path,
      projectName: r.project_name,
      createdAt: r.created_at,
      label: r.label,
      filesChanged: r.files_changed
        ? (() => {
            try { return JSON.parse(r.files_changed!) as string[] }
            catch { return [] }
          })()
        : [],
      snapshotPath: r.snapshot_path,
    }))
    versionsByConversation.value[conversationId] = mapped
    return mapped
  }

  function clearForTab(tabId: string): void {
    delete previewByTab.value[tabId]
    pendingByTab.delete(tabId)
  }

  // ── Pending accumulation ──────────────────────────────────────────────────

  function initPending(tabId: string, tab: ChatTab, messageId: string): void {
    const convId = tab.conversationId
    const proj = tab.activeDesignProject
    pendingByTab.set(tabId, {
      tabId,
      conversationId: convId,
      messageId,
      projectPath: proj?.path ?? '',
      projectName: proj?.name ?? '',
      files: new Map(),
      writtenFiles: new Set(),
    })
  }

  function ensurePending(tabId: string, tab: ChatTab, messageId?: string): PendingSnapshot {
    let pending = pendingByTab.get(tabId)
    if (!pending) {
      initPending(tabId, tab, messageId ?? '')
      pending = pendingByTab.get(tabId)!
    }
    // Patch missing project info if scaffold happened after init
    if (tab.activeDesignProject) {
      if (!pending.projectPath || pending.projectPath !== tab.activeDesignProject.path) {
        pending.projectPath = tab.activeDesignProject.path
        pending.projectName = tab.activeDesignProject.name
      }
    }
    if (!pending.conversationId && tab.conversationId) {
      pending.conversationId = tab.conversationId
    }
    if (messageId && !pending.messageId) {
      pending.messageId = messageId
    }
    return pending
  }

  function updatePendingProject(tabId: string, project: { path: string; name: string }): void {
    const pending = pendingByTab.get(tabId)
    if (pending) {
      pending.projectPath = project.path
      pending.projectName = project.name
    }
  }

  function accumulateFiles(tabId: string, files: Array<{ path: string; content: string }>): void {
    let pending = pendingByTab.get(tabId)
    if (!pending) {
      // Create minimal pending on demand — project/conversation will be patched at finalize
      pending = {
        tabId,
        conversationId: null,
        messageId: null,
        projectPath: '',
        projectName: '',
        files: new Map(),
        writtenFiles: new Set(),
      }
      pendingByTab.set(tabId, pending)
    }
    for (const f of files) {
      pending.files.set(f.path, f.content)
      pending.writtenFiles.add(f.path)
    }
  }

  function _markNoop(_tabId: string): void {
    // called when edit_design result shows skipped/failed — we keep buffer but don't mark written
  }
  void _markNoop

  function discardPending(tabId: string): void {
    pendingByTab.delete(tabId)
  }

  // ── Finalize at turn end ──────────────────────────────────────────────────

  async function finalize(tab: ChatTab, assistantMessageId: string): Promise<DesignVersionRef | null> {
    const pending = pendingByTab.get(tab.id)
    // If no pending but tab is design, we may still need to snapshot start_project created files
    // start_project uses onProjectScaffold which doesn't go through edit_design, so handle separately
    if (!pending) {
      // No writes in this turn → no version
      return null
    }
    // Patch missing project/conversation info that may have been empty at init (scaffold after init)
    if ((!pending.projectPath || !pending.projectName) && tab.activeDesignProject) {
      pending.projectPath = tab.activeDesignProject.path
      pending.projectName = tab.activeDesignProject.name
    }
    if (!pending.projectPath) {
      pendingByTab.delete(tab.id)
      return null
    }
    if (pending.writtenFiles.size === 0) {
      pendingByTab.delete(tab.id)
      return null
    }
    if (!pending.conversationId) {
      // conversation not yet persisted — defer? Use tab.conversationId now (set by sendMessage)
      if (tab.conversationId) {
        pending.conversationId = tab.conversationId
      }
      else {
        pendingByTab.delete(tab.id)
        return null
      }
    }
    // Ensure messageId matches the live assistant message
    pending.messageId = assistantMessageId

    const conversationId = pending.conversationId!
    const existing = versionsByConversation.value[conversationId] ?? await loadForConversation(conversationId)
    const versionNumber = existing.length > 0 ? Math.max(...existing.map(v => v.versionNumber)) + 1 : 1

    const filesChanged = Array.from(pending.writtenFiles)
    const snapshotDir = await join(pending.projectPath, '.versions', `v${versionNumber}`)

    try {
      await mkdir(snapshotDir, { recursive: true })
    }
    catch (e) {
      console.warn('[designVersions] mkdir failed', e)
    }

    // Write snapshot: prefer buffered content, fallback to reading live file
    const toWrite: Array<{ name: string; content: string }> = []
    for (const fname of DESIGN_FILES) {
      let content = pending.files.get(fname)
      if (content === undefined) {
        // File not edited this turn — copy current live version so snapshot is complete
        try {
          content = await readTextFile(await join(pending.projectPath, fname))
        }
        catch {
          continue // missing file is ok (maybe project not yet scaffolded)
        }
      }
      toWrite.push({ name: fname, content })
    }

    for (const { name, content } of toWrite) {
      try {
        await writeTextFile(await join(snapshotDir, name), content)
      }
      catch (e) {
        console.warn('[designVersions] write snapshot failed', name, e)
      }
    }

    const now = Date.now()
    const label = `Version ${versionNumber}`
    const rowId = makeId()
    const row = {
      id: rowId,
      conversation_id: conversationId,
      version_number: versionNumber,
      message_id: assistantMessageId,
      project_path: pending.projectPath,
      project_name: pending.projectName,
      created_at: now,
      label,
      files_changed: JSON.stringify(filesChanged),
      snapshot_path: snapshotDir,
    }

    try {
      await dbInsertDesignVersion(row as never)
    }
    catch (e) {
      console.warn('[designVersions] dbInsert failed', e)
      // cleanup snapshot dir on DB failure
      try { await remove(snapshotDir, { recursive: true }) }
      catch {}
      pendingByTab.delete(tab.id)
      return null
    }

    const ref: DesignVersionRef = {
      id: rowId,
      conversationId,
      versionNumber,
      messageId: assistantMessageId,
      projectPath: pending.projectPath,
      projectName: pending.projectName,
      createdAt: now,
      label,
      filesChanged,
      snapshotPath: snapshotDir,
    }

    // Update in-memory
    const list = versionsByConversation.value[conversationId] ?? []
    list.push(ref)
    versionsByConversation.value[conversationId] = list

    // Also mirror to tab for UI without DB round-trip
    if (!tab.designVersions)
      tab.designVersions = []
    tab.designVersions.push(ref)

    // Link to message (both in-memory and DB)
    const msg = tab.messages.find(m => m.id === assistantMessageId)
    if (msg)
      msg.designVersionId = rowId
    try {
      await dbUpdateMessage(assistantMessageId, { design_version_id: rowId })
    }
    catch (e) {
      console.warn('[designVersions] dbUpdateMessage failed', e)
    }

    // Enforce cap 50 — delete oldest
    if (list.length > MAX_VERSIONS_PER_CONVERSATION) {
      const toEvict = list.slice(0, list.length - MAX_VERSIONS_PER_CONVERSATION)
      const ids = toEvict.map(v => v.id)
      for (const v of toEvict) {
        try { await remove(v.snapshotPath, { recursive: true }) }
        catch {}
      }
      try { await dbDeleteDesignVersions(ids) }
      catch (e) { console.warn('[designVersions] prune delete failed', e) }
      versionsByConversation.value[conversationId] = list.slice(-MAX_VERSIONS_PER_CONVERSATION)
      if (tab.designVersions) {
        const keepIds = new Set(versionsByConversation.value[conversationId]!.map(v => v.id))
        tab.designVersions = tab.designVersions.filter(v => keepIds.has(v.id))
      }
    }

    pendingByTab.delete(tab.id)
    return ref
  }

  // ── Restore ────────────────────────────────────────────────────────────────

  async function restoreVersion(tab: ChatTab, versionId: string): Promise<{ ok: boolean; error?: string }> {
    let version: DesignVersionRef | undefined
    for (const list of Object.values(versionsByConversation.value)) {
      const found = list.find(v => v.id === versionId)
      if (found) {
        version = found
        break
      }
    }
    if (!version) {
      const row = await dbGetDesignVersion(versionId).catch(() => undefined)
      if (!row)
        return { ok: false, error: 'Version not found' }
      version = {
        id: row.id,
        conversationId: row.conversation_id,
        versionNumber: row.version_number,
        messageId: row.message_id,
        projectPath: row.project_path,
        projectName: row.project_name,
        createdAt: row.created_at,
        label: row.label,
        filesChanged: row.files_changed
          ? (() => {
              try { return JSON.parse(row.files_changed!) as string[] }
              catch { return [] }
            })()
          : [],
        snapshotPath: row.snapshot_path,
      }
    }

    if (!tab.activeDesignProject)
      return { ok: false, error: 'No active design project' }

    const conversationId = version.conversationId

    // ── 1. Delete versions newer than the one being restored (disk + DB + memory) ──
    const list = versionsByConversation.value[conversationId]
    const newer = list ? list.filter(v => v.versionNumber > version.versionNumber) : []
    if (newer.length > 0) {
      for (const v of newer) {
        try { await remove(v.snapshotPath, { recursive: true }) }
        catch {}
      }
      try { await dbDeleteDesignVersions(newer.map(v => v.id)) }
      catch (e) {
        console.warn('[designVersions] restore prune delete failed', e)
      }
      if (list)
        versionsByConversation.value[conversationId] = list.filter(v => v.versionNumber <= version.versionNumber)
      if (tab.designVersions)
        tab.designVersions = tab.designVersions.filter(v => v.versionNumber <= version.versionNumber)
    }

    // ── 2. Truncate the conversation after the turn that produced this version ──
    const msgIndex = tab.messages.findIndex(m => m.id === version.messageId)
    if (msgIndex >= 0) {
      const removedIds = tab.messages.slice(msgIndex + 1).map(m => m.id)
      if (removedIds.length > 0) {
        tab.messages.splice(msgIndex + 1)
        if (conversationId) {
          try { await dbDeleteMessages(removedIds) }
          catch (e) {
            console.warn('[designVersions] restore message truncation failed', e)
          }
          await dbUpdateConversationMsgCount(conversationId, tab.messages.length).catch(() => {})
        }
      }
    }

    // ── 3. Copy snapshot files back to live project (overwrite) ────────────────
    for (const fname of DESIGN_FILES) {
      try {
        const src = await join(version.snapshotPath, fname)
        if (await exists(src)) {
          const content = await readTextFile(src)
          await writeTextFile(await join(tab.activeDesignProject.path, fname), content)
        }
      }
      catch (e) {
        console.warn('[designVersions] restore read failed', fname, e)
      }
    }

    // Bump projectVersion so DesignCanvas reloads
    tab.projectVersion = (tab.projectVersion ?? 0) + 1
    // Do NOT create a new version here; next assistant turn that edits will create V(n+1)
    // Clear preview
    setPreview(tab.id, null)
    return { ok: true }
  }

  // Restore as new version (non-destructive, creates V(n+1) immediately)
  async function restoreAsNewVersion(tab: ChatTab, versionId: string, _assistantMessageId?: string): Promise<DesignVersionRef | null> {
    const res = await restoreVersion(tab, versionId)
    if (!res.ok)
      return null
    return null
  }

  async function readSnapshotFiles(versionId: string): Promise<Record<string, string>> {
    let version: DesignVersionRef | undefined
    for (const list of Object.values(versionsByConversation.value)) {
      const found = list.find(v => v.id === versionId)
      if (found) {
        version = found
        break
      }
    }
    if (!version) {
      const row = await dbGetDesignVersion(versionId).catch(() => undefined)
      if (!row)
        return {}
      version = {
        id: row.id,
        conversationId: row.conversation_id,
        versionNumber: row.version_number,
        messageId: row.message_id,
        projectPath: row.project_path,
        projectName: row.project_name,
        createdAt: row.created_at,
        label: row.label,
        filesChanged: row.files_changed
          ? (() => {
              try { return JSON.parse(row.files_changed!) as string[] }
              catch { return [] }
            })()
          : [],
        snapshotPath: row.snapshot_path,
      }
    }
    const out: Record<string, string> = {}
    for (const fname of DESIGN_FILES) {
      try {
        const p = await join(version.snapshotPath, fname)
        if (await exists(p))
          out[fname] = await readTextFile(p)
      }
      catch {}
    }
    return out
  }

  return {
    versionsByConversation,
    previewByTab,
    getVersions,
    getByMessageId,
    getPreviewId,
    setPreview,
    loadForConversation,
    clearForTab,
    initPending,
    ensurePending,
    updatePendingProject,
    accumulateFiles,
    discardPending,
    finalize,
    restoreVersion,
    restoreAsNewVersion,
    readSnapshotFiles,
  }
})
