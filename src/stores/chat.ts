/**
 * src/stores/chat.ts
 *
 * Pinia store for the chat UI.
 *
 * Responsibilities:
 * - Owns the tab list and the active tab reference.
 * - Delegates message streaming to createSendMessage().
 * - Manages per-tab conversation state cache so switching tabs is instant.
 * - All async operations that mutate tab state are guarded — a failure never
 *   leaves a tab permanently stuck in isStreaming=true.
 *
 * Crash recovery:
 * - Assistant messages are now inserted into the DB the moment streaming
 *   begins (is_complete = 0) and updated incrementally throughout the stream.
 *   The old localStorage-based recovery system has been removed; SQLite is
 *   the single source of truth. On restart, any message with is_complete = 0
 *   was interrupted — the conversation loader can surface a truncation note
 *   if desired by checking that field on the loaded MessageRow.
 */

import type { ChatDraftState, ChatEstimatorState, ChatTab, Message } from './chat/types'
import type { ToolPermissionDecision, ToolPermissionRequest } from '@/utils/tools/permissions'
import type { QuestionAnswer } from '@/utils/tools/questions'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  dbDeleteMessages,
  dbUpdateConversationMsgCount,
  dbUpdateConversationTitle,
  dbUpdateMessage,
} from '@/db/database'
import { useBrowserStore } from '@/stores/browser'
import { useGitPaneStore } from '@/stores/gitPane'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { useTerminalStore } from '@/stores/terminal'
import { compactConversationSession, persistCompactionMessages } from './chat/compaction'
import { SESSION_COMPACTING_DIVIDER } from './chat/constants'
import { createSendMessage } from './chat/sendMessage'
import { createEmptyDraft, createEmptyEstimatorState, makeId, newTab } from './chat/utils'

export type {
  Attachment,
  ChatMode,
  ChatTab,
  Message,
  MessagePart,
  PendingToolPermission,
  SubAgentInfo,
  SubAgentPersonality,
  ToolEvent,
} from './chat/types'
export type { TaskItem } from '@/utils/tools/todos'

// ── store ─────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref<string>(tabs.value[0]!.id)
  const abortControllers = new Map<string, AbortController>()
  const questionResolvers = new Map<string, (answers: QuestionAnswer[]) => void>()
  /** Keyed by unique requestId (not tabId) so parallel tool calls each get their own resolver. */
  const permissionResolvers = new Map<string, (decision: ToolPermissionDecision) => void>()
  const sessionToolApprovals = ref<string[]>([])

  /**
   * Per-conversation state cache so switching back to a conversation
   * restores the draft text, model choice, and token estimate.
   */
  const conversationStateCache = ref<Record<string, {
    modelUid: string | null
    draft: ChatDraftState
    estimator: ChatEstimatorState
  }>>({})

  // ── derived ──────────────────────────────────────────────────────────────────

  const activeTab = computed<ChatTab>(
    () => tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0]!,
  )

  // ── conversation state cache ──────────────────────────────────────────────────

  function snapshotConversationState(tab: ChatTab): void {
    if (!tab.conversationId)
      return
    conversationStateCache.value[tab.conversationId] = {
      modelUid: tab.modelUid ?? null,
      draft: {
        text: tab.draft.text,
        attachments: [], // We don't persist attachments in the cache for now
      },
      estimator: {
        estimate: tab.estimator.estimate,
        error: tab.estimator.error,
        estimating: tab.estimator.estimating,
      },
    }
  }

  function restoreConversationState(conversationId: string): {
    modelUid: string | null
    draft: ChatDraftState
    estimator: ChatEstimatorState
  } {
    const cached = conversationStateCache.value[conversationId]
    if (!cached) {
      return {
        modelUid: null,
        draft: createEmptyDraft(),
        estimator: createEmptyEstimatorState(),
      }
    }
    return {
      modelUid: cached.modelUid,
      draft: { text: cached.draft.text, attachments: [] },
      estimator: { ...cached.estimator, estimating: false },
    }
  }

  // Keep cache in sync as tabs mutate
  watch(tabs, nextTabs => {
    nextTabs.forEach(snapshotConversationState)
  }, { deep: true })

  watch(activeId, id => {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab?.workspacePath)
      return

    const project = useProjectStore()
    if (project.projectPath !== tab.workspacePath)
      project.setProject(tab.workspacePath)
  }, { immediate: true })

  // ── tab actions ───────────────────────────────────────────────────────────────

  function addTab(): void {
    const tab = newTab()
    tab.workspacePath = useProjectStore().projectPath
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function markInterruptedAssistantMessage(tab: ChatTab, reason: string): void {
    const lastAssistant = [...tab.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant)
      return

    const interruptionNote = `[Assistant turn ended with error/interruption: ${reason}]`
    if (!/\[Assistant turn ended with error\/interruption:/.test(lastAssistant.content)) {
      lastAssistant.content = lastAssistant.content.trim()
        ? `${lastAssistant.content}\n\n${interruptionNote}`
        : interruptionNote
    }
    lastAssistant.error = reason
    if (tab.conversationId) {
      void dbUpdateMessage(lastAssistant.id, {
        content: lastAssistant.content,
        parts: lastAssistant.parts?.length ? JSON.stringify(lastAssistant.parts) : null,
        tool_events: lastAssistant.toolEvents?.length ? JSON.stringify(lastAssistant.toolEvents) : null,
      }).catch(() => { })
    }
  }

  function closeTab(id: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab)
      snapshotConversationState(tab)

    const browser = useBrowserStore()
    const gitPane = useGitPaneStore()
    const terminal = useTerminalStore()

    // Cancel any in-flight request
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    if (tab?.isStreaming)
      markInterruptedAssistantMessage(tab, 'Interrupted during generation.')

    // Dismiss any pending questions
    const resolve = questionResolvers.get(id)
    if (resolve) {
      const pendingTab = tabs.value.find(t => t.id === id)
      const skipped = (pendingTab?.pendingQuestions?.questions ?? []).map(q => ({
        question: q.question,
        answer: 'skipped',
      }))
      resolve(skipped)
      questionResolvers.delete(id)
    }

    // Deny all queued permission requests for this tab
    const closingTab = tabs.value.find(t => t.id === id)
    if (closingTab) {
      for (const perm of closingTab.pendingPermissions) {
        permissionResolvers.get(perm.requestId)?.('deny')
        permissionResolvers.delete(perm.requestId)
      }
      closingTab.pendingPermissions = []
    }

    // Clean up checkpoints for this tab
    import('./checkpoints').then(({ useCheckpointStore }) => {
      const checkpoints = useCheckpointStore()
      void checkpoints.finalizeCheckpoint(tab?.conversationId ?? null).finally(() => {
        checkpoints.clearTab(id, useProjectStore().projectPath ?? undefined)
      })
    }).catch(() => { })

    const idx = tabs.value.findIndex(t => t.id === id)

    if (tabs.value.length === 1) {
      // Always keep at least one tab
      browser.disposeOwner(id)
      gitPane.disposeOwner(id)
      void terminal.disposeOwner(id)
      const tab = newTab()
      tab.workspacePath = useProjectStore().projectPath
      tabs.value = [tab]
      activeId.value = tabs.value[0]!.id
      return
    }

    browser.disposeOwner(id)
    gitPane.disposeOwner(id)
    void terminal.disposeOwner(id)
    tabs.value.splice(idx, 1)
    if (activeId.value === id)
      activeId.value = tabs.value[Math.max(0, idx - 1)]!.id
  }

  function openConversation(payload: {
    conversationId: string
    title: string
    messages: Message[]
    workspacePath?: string | null
    workspaceMeta?: ChatTab['workspaceMeta']
    subAgent?: ChatTab['subAgent']
  }): void {
    // Don't open the same conversation twice
    const existing = tabs.value.find(t => t.conversationId === payload.conversationId)
    if (existing) {
      activeId.value = existing.id
      return
    }

    const restoredState = restoreConversationState(payload.conversationId)

    const tab: ChatTab = {
      id: makeId(),
      title: payload.title,
      messages: payload.messages,
      conversationId: payload.conversationId,
      workspacePath: payload.workspacePath ?? null,
      workspaceMeta: payload.workspaceMeta ?? null,
      ...(payload.subAgent ? { subAgent: payload.subAgent } : {}),
      workspaceLocked: payload.messages.length > 0,
      isStreaming: false,
      todos: [],
      modelUid: restoredState.modelUid,
      draft: restoredState.draft,
      estimator: restoredState.estimator,
      isCompacting: false,
      pendingQuestions: null,
      pendingPermissions: [],
      readRegistry: new Map(),
    }

    tabs.value.push(tab)
    activeId.value = tab.id
    if (tab.workspacePath)
      useProjectStore().setProject(tab.workspacePath)

    // Load checkpoints for this conversation
    import('./checkpoints').then(({ useCheckpointStore }) => {
      useCheckpointStore().loadForConversation(
        tab.id,
        payload.conversationId,
      )
    }).catch(() => { })
  }

  function stopGeneration(tabId?: string): void {
    const id = tabId ?? activeId.value
    // Deny all queued permission requests for this tab
    const stoppingTab = tabs.value.find(t => t.id === id)
    if (stoppingTab) {
      for (const perm of stoppingTab.pendingPermissions) {
        permissionResolvers.get(perm.requestId)?.('deny')
        permissionResolvers.delete(perm.requestId)
      }
      stoppingTab.pendingPermissions = []
    }
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      if (tab.isStreaming)
        markInterruptedAssistantMessage(tab, 'Interrupted during generation.')
      tab.isStreaming = false
      if (tab.subAgent)
        tab.subAgent.status = 'error'
      import('./checkpoints').then(({ useCheckpointStore }) => {
        void useCheckpointStore().finalizeCheckpoint(tab.conversationId)
      }).catch(() => { })
    }
  }

  function updateTabDraft(tabId: string, patch: Partial<ChatDraftState>): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.draft = { ...tab.draft, ...patch }
    }
  }

  function clearTabDraft(tabId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.draft = createEmptyDraft()
    }
  }

  function setTabWorkspace(
    tabId: string,
    patch: {
      workspacePath: string | null
      workspaceMeta?: ChatTab['workspaceMeta']
      lock?: boolean
    },
  ): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return

    tab.workspacePath = patch.workspacePath
    if ('workspaceMeta' in patch)
      tab.workspaceMeta = patch.workspaceMeta ?? null
    if (patch.lock === true)
      tab.workspaceLocked = true
  }

  function setTabModel(tabId: string, modelUid: string | null): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.modelUid = modelUid
      snapshotConversationState(tab)
    }
  }

  function setTabEstimatorState(tabId: string, next: Partial<ChatEstimatorState>): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return
    tab.estimator = {
      estimate: next.estimate === undefined ? tab.estimator.estimate : next.estimate,
      error: next.error === undefined ? tab.estimator.error : next.error,
      estimating: next.estimating === undefined ? tab.estimator.estimating : next.estimating,
    }
    snapshotConversationState(tab)
  }

  function insertStreamingCompactionDivider(tab: ChatTab): string | null {
    const existing = tab.messages.find(message =>
      message.role === 'assistant' && message.content.trim() === SESSION_COMPACTING_DIVIDER)
    if (existing)
      return existing.id

    let liveAssistantIndex = -1
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      const message = tab.messages[i]!
      if (message.role === 'assistant') {
        liveAssistantIndex = i
        break
      }
    }

    if (liveAssistantIndex <= 0)
      return null

    const divider: Message = {
      id: makeId(),
      role: 'assistant',
      content: SESSION_COMPACTING_DIVIDER,
      timestamp: new Date(),
    }
    tab.messages.splice(liveAssistantIndex, 0, divider)
    return divider.id
  }

  function removeStreamingCompactionDivider(tab: ChatTab, dividerId: string | null): void {
    if (!dividerId)
      return

    tab.messages = tab.messages.filter(message => message.id !== dividerId)
  }

  async function compactSession(
    tabId: string,
    source: 'auto' | 'manual' = 'manual',
  ): Promise<{ ok: boolean; error?: string }> {
    const tab = tabs.value.find(item => item.id === tabId)
    if (!tab)
      return { ok: false, error: 'Tab not found' }
    if (tab.isCompacting)
      return { ok: false, error: 'Session compaction is already running' }
    if (!tab.conversationId)
      return { ok: false, error: 'This conversation has not been saved yet' }

    tab.isCompacting = true
    const pendingDividerId = tab.isStreaming ? insertStreamingCompactionDivider(tab) : null
    console.warn('[compaction] Requested session compaction', {
      tabId,
      source,
      conversationId: tab.conversationId,
      messageCount: tab.messages.length,
      midStream: tab.isStreaming,
      contextUsageRatio: tab.estimator.estimate?.contextUsageRatio ?? null,
    })

    try {
      const settings = useSettingsStore()
      const { useCheckpointStore } = await import('./checkpoints')
      const checkpointStore = useCheckpointStore()

      await compactConversationSession({
        tab,
        settings: {
          activeModel: settings.activeModel,
          activeModelUid: settings.activeModelUid,
          enabledModels: settings.enabledModels,
          openai: settings.openai,
          anthropic: settings.anthropic,
          google: settings.google,
          compatibleProviders: settings.compatibleProviders,
          agent: settings.agent,
        },
        source,
        onPersist: async ({ deletedMessageIds, insertedMessages }) => {
          const persistedCurrentCount = tab.messages.filter(message =>
            message.content.trim() !== SESSION_COMPACTING_DIVIDER).length
          await dbDeleteMessages(deletedMessageIds)
          await persistCompactionMessages({
            conversationId: tab.conversationId!,
            insertedMessages,
          })
          await dbUpdateConversationMsgCount(
            tab.conversationId!,
            persistedCurrentCount - deletedMessageIds.length + insertedMessages.length,
          )
          await checkpointStore.clearConversationCheckpoints(tab.id, tab.conversationId)
        },
      })

      snapshotConversationState(tab)
      console.warn('[compaction] Session compaction completed', {
        tabId,
        source,
        nextMessageCount: tab.messages.length,
        contextUsageRatio: tab.estimator.estimate?.contextUsageRatio ?? null,
      })
      return { ok: true }
    }
    catch (error) {
      removeStreamingCompactionDivider(tab, pendingDividerId)
      console.warn('[compaction] Session compaction failed', {
        tabId,
        source,
        error: error instanceof Error ? error.message : 'Failed to compact session',
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to compact session',
      }
    }
    finally {
      tab.isCompacting = false
    }
  }

  // ── questions ─────────────────────────────────────────────────────────────────

  function _resolveQuestions(tabId: string, answers: Array<string | null>): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab?.pendingQuestions)
      return
    const resolve = questionResolvers.get(tabId)
    if (!resolve)
      return

    const result = tab.pendingQuestions.questions.map((q, i) => ({
      question: q.question,
      answer: answers[i] ?? 'skipped',
    }))

    questionResolvers.delete(tabId)
    tab.pendingQuestions = null
    resolve(result)
  }

  function submitAnswers(tabId: string, answers: Array<string | null>): void {
    _resolveQuestions(tabId, answers)
  }

  function dismissQuestions(tabId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab?.pendingQuestions)
      return
    const skipped = tab.pendingQuestions.questions.map(() => null)
    _resolveQuestions(tabId, skipped)
  }

  function isToolApprovedForSession(toolName: string): boolean {
    return sessionToolApprovals.value.includes(toolName)
  }

  function clearSessionToolApprovals(): void {
    sessionToolApprovals.value = []
  }

  function requestToolPermission(
    tabId: string,
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionDecision> {
    if (isToolApprovedForSession(request.toolName))
      return Promise.resolve('allow-session')

    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return Promise.resolve('deny')

    const requestId = `${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    return new Promise(resolve => {
      tab.pendingPermissions.push({
        requestId,
        toolName: request.toolName,
        toolLabel: request.toolLabel,
        actionTitle: request.actionTitle,
        actionDetails: request.actionDetails,
      })

      permissionResolvers.set(requestId, decision => {
        if (decision === 'allow-session' && !sessionToolApprovals.value.includes(request.toolName))
          sessionToolApprovals.value = [...sessionToolApprovals.value, request.toolName]

        permissionResolvers.delete(requestId)
        tab.pendingPermissions = tab.pendingPermissions.filter(p => p.requestId !== requestId)
        resolve(decision)
      })
    })
  }

  function submitToolPermission(tabId: string, decision: ToolPermissionDecision, requestId?: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab || tab.pendingPermissions.length === 0)
      return

    // Resolve a specific request, or the first one in the queue
    const targetId = requestId ?? tab.pendingPermissions[0]?.requestId
    if (targetId)
      permissionResolvers.get(targetId)?.(decision)
  }

  // ── send message ──────────────────────────────────────────────────────────────

  const { sendMessage } = createSendMessage(
    tabs,
    activeId,
    activeTab,
    abortControllers,
    questionResolvers,
    requestToolPermission,
  )

  // ── rename ────────────────────────────────────────────────────────────────────

  async function renameTab(tabId: string, newTitle: string): Promise<void> {
    const trimmed = newTitle.trim()
    if (!trimmed)
      return
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return
    tab.title = trimmed
    if (tab.conversationId) {
      await dbUpdateConversationTitle(tab.conversationId, trimmed).catch(e => {
        console.error('[chat] Failed to rename conversation in DB:', e)
      })
    }
  }

  // ── checkpoint restore ────────────────────────────────────────────────────────

  async function restoreToCheckpoint(
    tabId: string,
    checkpointId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return { ok: false, error: 'Tab not found' }
    if (tab.isStreaming)
      return { ok: false, error: 'Cannot restore while streaming' }

    try {
      const { useCheckpointStore } = await import('./checkpoints')
      return await useCheckpointStore().restoreToCheckpoint(tab, checkpointId)
    }
    catch (e) {
      const msg = e instanceof Error ? e.message : 'Restore failed'
      console.error('[chat] restoreToCheckpoint error:', e)
      return { ok: false, error: msg }
    }
  }

  // ── public API ────────────────────────────────────────────────────────────────

  return {
    tabs,
    activeId,
    activeTab,
    conversationStateCache,
    addTab,
    closeTab,
    openConversation,
    updateTabDraft,
    clearTabDraft,
    setTabWorkspace,
    setTabModel,
    setTabEstimatorState,
    compactSession,
    submitAnswers,
    dismissQuestions,
    submitToolPermission,
    requestToolPermission,
    clearSessionToolApprovals,
    sessionToolApprovals,
    sendMessage,
    stopGeneration,
    renameTab,
    restoreToCheckpoint,
  }
}, {
  persist: {
    pick: ['conversationStateCache'],
  },
})
