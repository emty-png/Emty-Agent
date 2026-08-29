/**
 * src/stores/designVersions/index.ts
 *
 * Per-conversation design versioning (multi-screen).
 * - Disk: ~/.emty/designs/{design}/{screen}/.versions/v{n}/ holds full 3-file snapshots per screen
 * - DB: design_versions table is the source of truth for listing/restore (now includes screen_name/design_name)
 * - In-memory: tab.designVersions mirrors DB, updated at turn finalize
 * Legacy single-project paths ( ~/.emty/designs/{name}/.versions/vN ) are still readable via snapshot_path.
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

// ── Pending per-turn buffer — per-screen ────────────────────────────────────

interface PendingSnapshot {
  tabId: string
  conversationId: string | null
  messageId: string | null
  projectPath: string // design root ~/.emty/designs/{design}
  projectName: string // design name
  screenName: string
  files: Map<string, string>
  writtenFiles: Set<string>
}

const pendingByKey = new Map<string, PendingSnapshot>()

function pendingKey(tabId: string, screenName: string): string {
  return `${tabId}:${screenName}`
}

function pendingKeysForTab(tabId: string): string[] {
  const out: string[] = []
  for (const k of pendingByKey.keys()) {
    if (k === tabId || k.startsWith(`${tabId}:`))
      out.push(k)
  }
  return out
}

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
    const mapped: DesignVersionRef[] = rows.map(r => {
      const screenNameRaw = (r as unknown as { screen_name?: string | null }).screen_name
      const designNameRaw = (r as unknown as { design_name?: string | null }).design_name
      return {
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
        ...(screenNameRaw ? { screenName: screenNameRaw } : {}),
        ...(designNameRaw ? { designName: designNameRaw } : {}),
      }
    })
    versionsByConversation.value[conversationId] = mapped
    return mapped
  }

  function clearForTab(tabId: string): void {
    delete previewByTab.value[tabId]
    for (const k of pendingKeysForTab(tabId))
      pendingByKey.delete(k)
  }

  // ── Pending accumulation ──────────────────────────────────────────────────

  function initPending(tabId: string, tab: ChatTab, messageId: string): void {
    // Clear any stale pending for this tab (multi-screen)
    for (const k of pendingKeysForTab(tabId))
      pendingByKey.delete(k)
    // Keep a sentinel pending for fallback legacy path (no-screen) so that finalize can still produce a version
    const convId = tab.conversationId
    // Prefer activeDesign, fallback to legacy activeDesignProject
    const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
    const proj = activeDesign ?? tab.activeDesignProject
    // Do not create a pending yet; accumulate will create per-screen entries.
    // Store a marker for conversation/message linkage under empty-screen key if we need it for generic fallback
    // We store empty key sentinel to carry conversationId/messageId if accumulate happens after init
    pendingByKey.set(tabId, {
      tabId,
      conversationId: convId,
      messageId,
      projectPath: proj?.path ?? '',
      projectName: proj?.name ?? '',
      screenName: '',
      files: new Map(),
      writtenFiles: new Set(),
    })
  }

  function ensurePending(tabId: string, tab: ChatTab, messageId?: string): PendingSnapshot {
    // Legacy single-key pending (used by older code paths)
    let pending = pendingByKey.get(tabId)
    if (!pending) {
      initPending(tabId, tab, messageId ?? '')
      pending = pendingByKey.get(tabId)!
    }
    const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
    const proj = activeDesign ?? tab.activeDesignProject
    if (proj) {
      if (!pending.projectPath || pending.projectPath !== proj.path) {
        pending.projectPath = proj.path
        pending.projectName = proj.name
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

  function ensurePendingForScreen(tabId: string, tab: ChatTab, screenName: string, messageId?: string): PendingSnapshot {
    const key = pendingKey(tabId, screenName)
    let pending = pendingByKey.get(key)
    if (!pending) {
      // Inherit design info from sentinel or tab
      const sentinel = pendingByKey.get(tabId)
      const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
      const proj = activeDesign ?? tab.activeDesignProject
      pending = {
        tabId,
        conversationId: sentinel?.conversationId ?? tab.conversationId ?? null,
        messageId: messageId ?? sentinel?.messageId ?? null,
        projectPath: sentinel?.projectPath ?? proj?.path ?? '',
        projectName: sentinel?.projectName ?? proj?.name ?? '',
        screenName,
        files: new Map(),
        writtenFiles: new Set(),
      }
      pendingByKey.set(key, pending)
    }
    // Patch missing design info
    const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
    const proj = activeDesign ?? tab.activeDesignProject
    if (proj) {
      if (!pending.projectPath || pending.projectPath !== proj.path) {
        pending.projectPath = proj.path
        pending.projectName = proj.name
      }
    }
    if (!pending.conversationId && tab.conversationId)
      pending.conversationId = tab.conversationId
    if (messageId && !pending.messageId)
      pending.messageId = messageId
    return pending
  }

  function updatePendingProject(tabId: string, project: { path: string; name: string }): void {
    // Update all pending for this tab (including sentinel)
    for (const k of pendingKeysForTab(tabId)) {
      const p = pendingByKey.get(k)
      if (p) {
        p.projectPath = project.path
        p.projectName = project.name
      }
    }
  }

  function updatePendingDesign(tabId: string, design: { path: string; name: string }): void {
    updatePendingProject(tabId, design)
  }

  function accumulateFiles(tabId: string, files: Array<{ path: string; content: string }>): void {
    // Legacy single-screen accumulate (without explicit screen) → treat as '' key aggregated
    let pending = pendingByKey.get(tabId)
    if (!pending) {
      pending = {
        tabId,
        conversationId: null,
        messageId: null,
        projectPath: '',
        projectName: '',
        screenName: '',
        files: new Map(),
        writtenFiles: new Set(),
      }
      pendingByKey.set(tabId, pending)
    }
    for (const f of files) {
      pending.files.set(f.path, f.content)
      pending.writtenFiles.add(f.path)
    }
  }

  function accumulateFilesForScreen(tabId: string, screenName: string, files: Array<{ path: string; content: string }>): void {
    // Need tab for context but we don't have it here; create minimal pending with screen
    const key = pendingKey(tabId, screenName)
    let pending = pendingByKey.get(key)
    if (!pending) {
      // Try to inherit from sentinel
      const sentinel = pendingByKey.get(tabId)
      pending = {
        tabId,
        conversationId: sentinel?.conversationId ?? null,
        messageId: sentinel?.messageId ?? null,
        projectPath: sentinel?.projectPath ?? '',
        projectName: sentinel?.projectName ?? '',
        screenName,
        files: new Map(),
        writtenFiles: new Set(),
      }
      pendingByKey.set(key, pending)
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
    for (const k of pendingKeysForTab(tabId))
      pendingByKey.delete(k)
  }

  // ── Finalize at turn end ──────────────────────────────────────────────────

  async function finalize(tab: ChatTab, assistantMessageId: string): Promise<DesignVersionRef | null> {
    const keys = pendingKeysForTab(tab.id)
    if (keys.length === 0)
      return null

    // Collect per-screen pendings that actually have written files
    const perScreenPendings: PendingSnapshot[] = []
    for (const k of keys) {
      const p = pendingByKey.get(k)!
      // Sentinel with screenName '' is legacy aggregated; handle separately below if no per-screen pendings exist
      if (p.screenName === '') {
        // Keep for fallback if no explicit screen pendings have writes
        continue
      }
      if (p.writtenFiles.size === 0)
        continue
      // Patch missing project/conversation info
      const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
      const proj = activeDesign ?? tab.activeDesignProject
      if ((!p.projectPath || !p.projectName) && proj) {
        p.projectPath = proj.path
        p.projectName = proj.name
      }
      if (!p.projectPath)
        continue
      if (!p.conversationId) {
        if (tab.conversationId)
          p.conversationId = tab.conversationId
        else continue
      }
      p.messageId = assistantMessageId
      perScreenPendings.push(p)
    }

    // Legacy fallback: if no per-screen pending but sentinel has writes (old single-project or single-screen via old path)
    if (perScreenPendings.length === 0) {
      const sentinel = pendingByKey.get(tab.id)
      if (sentinel && sentinel.writtenFiles.size > 0) {
        const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? null
        const proj = activeDesign ?? tab.activeDesignProject
        if (proj) {
          if (!sentinel.projectPath) {
            sentinel.projectPath = proj.path
            sentinel.projectName = proj.name
          }
        }
        if (!sentinel.projectPath) {
          discardPending(tab.id)
          return null
        }
        if (!sentinel.conversationId) {
          if (tab.conversationId) {
            sentinel.conversationId = tab.conversationId
          }
          else {
            discardPending(tab.id)
            return null
          }
        }
        sentinel.messageId = assistantMessageId
        // Legacy path is treated as screen '' with version at design/.versions
        // But for multi-screen compat we still create a version — store as legacy with screenName ''
        perScreenPendings.push(sentinel)
      }
    }

    if (perScreenPendings.length === 0) {
      discardPending(tab.id)
      return null
    }

    // Ensure conversation versions loaded
    const conversationId = perScreenPendings[0]!.conversationId!
    const existingAll = versionsByConversation.value[conversationId] ?? await loadForConversation(conversationId)

    let lastCreated: DesignVersionRef | null = null

    // For each screen pending, create a version with per-screen counter
    for (const pending of perScreenPendings) {
      const screenFilter = (v: DesignVersionRef) => (v.screenName ?? '') === pending.screenName
      const existingForScreen = existingAll.filter(screenFilter)
      const versionNumber = existingForScreen.length > 0 ? Math.max(...existingForScreen.map(v => v.versionNumber)) + 1 : 1

      const filesChanged = Array.from(pending.writtenFiles)
      // Snapshot path: design/screen/.versions/vN  (or design/.versions for legacy '' )
      const snapshotDir = pending.screenName
        ? await join(pending.projectPath, pending.screenName, '.versions', `v${versionNumber}`)
        : await join(pending.projectPath, '.versions', `v${versionNumber}`)

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
            const livePath = pending.screenName
              ? await join(pending.projectPath, pending.screenName, fname)
              : await join(pending.projectPath, fname)
            content = await readTextFile(livePath)
          }
          catch {
            continue // missing file is ok
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
      const label = pending.screenName ? `${pending.screenName} v${versionNumber}` : `Version ${versionNumber}`
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
        screen_name: pending.screenName || null,
        design_name: pending.projectName,
      }

      try {
        await dbInsertDesignVersion(row as never)
      }
      catch (e) {
        console.warn('[designVersions] dbInsert failed', e)
        // cleanup snapshot dir on DB failure
        try { await remove(snapshotDir, { recursive: true }) }
        catch {}
        continue
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
        ...(pending.screenName ? { screenName: pending.screenName } : {}),
        designName: pending.projectName,
      }

      // Update in-memory
      const list = versionsByConversation.value[conversationId] ?? []
      list.push(ref)
      versionsByConversation.value[conversationId] = list
      // For lookup at finalize we need existingAll to reflect new entry for next screen's counter
      existingAll.push(ref)

      // Also mirror to tab for UI without DB round-trip
      if (!tab.designVersions)
        tab.designVersions = []
      tab.designVersions.push(ref)

      // Link to message (both in-memory and DB) — last version wins for message link
      const msg = tab.messages.find(m => m.id === assistantMessageId)
      if (msg)
        msg.designVersionId = rowId
      try {
        await dbUpdateMessage(assistantMessageId, { design_version_id: rowId })
      }
      catch (e) {
        console.warn('[designVersions] dbUpdateMessage failed', e)
      }

      lastCreated = ref
    }

    // Enforce cap 50 total — delete oldest across any screen
    const finalList = versionsByConversation.value[conversationId]!
    if (finalList.length > MAX_VERSIONS_PER_CONVERSATION) {
      // Sort by createdAt ascending
      const sorted = [...finalList].sort((a, b) => a.createdAt - b.createdAt)
      const toEvict = sorted.slice(0, finalList.length - MAX_VERSIONS_PER_CONVERSATION)
      const ids = toEvict.map(v => v.id)
      for (const v of toEvict) {
        try { await remove(v.snapshotPath, { recursive: true }) }
        catch {}
      }
      try { await dbDeleteDesignVersions(ids) }
      catch (e) { console.warn('[designVersions] prune delete failed', e) }
      const keepSet = new Set(finalList.filter(v => !ids.includes(v.id)).map(v => v.id))
      versionsByConversation.value[conversationId] = finalList.filter(v => keepSet.has(v.id))
      if (tab.designVersions) {
        tab.designVersions = tab.designVersions.filter(v => keepSet.has(v.id))
      }
    }

    discardPending(tab.id)
    return lastCreated
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
      const screenNameRaw = (row as unknown as { screen_name?: string | null }).screen_name
      const designNameRaw = (row as unknown as { design_name?: string | null }).design_name
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
        ...(screenNameRaw ? { screenName: screenNameRaw } : {}),
        ...(designNameRaw ? { designName: designNameRaw } : {}),
      }
    }

    if (!version)
      return { ok: false, error: 'Version not found' }

    const activeDesign = (tab as unknown as { activeDesign?: { path: string; name: string } }).activeDesign ?? tab.activeDesignProject
    if (!activeDesign)
      return { ok: false, error: 'No active design project' }

    const conversationId = version.conversationId

    // ── 1. Delete versions newer than the one being restored for same screen (disk + DB + memory) ──
    const list = versionsByConversation.value[conversationId]
    const targetScreen = version.screenName ?? ''
    const newer = list ? list.filter(v => (v.screenName ?? '') === targetScreen && v.versionNumber > version.versionNumber) : []
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
        versionsByConversation.value[conversationId] = list.filter(v => !((v.screenName ?? '') === targetScreen && v.versionNumber > version.versionNumber))
      if (tab.designVersions)
        tab.designVersions = tab.designVersions.filter(v => !((v.screenName ?? '') === targetScreen && v.versionNumber > version.versionNumber))
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

    // ── 3. Copy snapshot files back to live screen (overwrite) ────────────────
    const destBase = version.screenName
      ? await join(activeDesign.path, version.screenName)
      : activeDesign.path
    for (const fname of DESIGN_FILES) {
      try {
        const src = await join(version.snapshotPath, fname)
        if (await exists(src)) {
          const content = await readTextFile(src)
          await writeTextFile(await join(destBase, fname), content)
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
      const screenNameRaw = (row as unknown as { screen_name?: string | null }).screen_name
      const designNameRaw = (row as unknown as { design_name?: string | null }).design_name
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
        ...(screenNameRaw ? { screenName: screenNameRaw } : {}),
        ...(designNameRaw ? { designName: designNameRaw } : {}),
      }
    }
    if (!version)
      return {}
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
    ensurePendingForScreen,
    updatePendingProject,
    updatePendingDesign,
    accumulateFiles,
    accumulateFilesForScreen,
    discardPending,
    finalize,
    restoreVersion,
    restoreAsNewVersion,
    readSnapshotFiles,
  }
})
