import type { AgentStatus, Attachment, ChatDraftState, ChatEstimatorState, ChatMode, ChatTab, Message, QueuedMessage } from './chat/core/types'
import type { ToolPermissionDecision, ToolPermissionRequest } from '@/utils/tools/permissions'
import type { QuestionAnswer } from '@/utils/tools/questions'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  dbDeleteMessages,
  dbListMemories,
  dbUpdateConversationMsgCount,
  dbUpdateConversationTitle,
  dbUpdateMessage,
} from '@/db/database'
import { useBrowserStore } from '@/stores/browser'
import { useGitPaneStore } from '@/stores/gitPane'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { useTerminalStore } from '@/stores/terminal'
import { emitStatusChange } from './chat/agent/lifecycle'
import { createSendMessage } from './chat/agent/sendMessage'
import { STATUS_IDLE, statusWaitingPermission } from './chat/agent/status'
import { compactConversationSession, persistCompactionMessages } from './chat/context/compaction'
import { SESSION_COMPACTING_DIVIDER } from './chat/core/constants'
import { cleanupBgTaskNotifications, handleBgTaskCompletion, initBgTaskNotifications } from './chat/utils/bgTaskNotifications'
import { createEmptyDraft, createEmptyEstimatorState, makeId, newDesignTab, newTab } from './chat/utils/tabFactory'

export type {
  AgentStatus,
  AgentToolCategory,
  Attachment,
  ChatMode,
  ChatTab,
  Message,
  MessagePart,
  PendingToolPermission,
  SubAgentInfo,
  SubAgentPersonality,
  ToolEvent,
} from './chat/core/types'
export type { TaskItem } from '@/utils/tools/todos'

// ── Internal helper ───────────────────────────────────────────────────────────

function setTabStatus(tab: ChatTab, next: AgentStatus): void {
  const prev = tab.agentStatus
  tab.agentStatus = next
  emitStatusChange(tab.id, prev, next)
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref<string>(tabs.value[0]!.id)
  const abortControllers = new Map<string, AbortController>()
  const questionResolvers = new Map<string, (answers: QuestionAnswer[]) => void>()
  /** Keyed by requestId (not tabId) so parallel tool calls get separate resolvers. */
  const permissionResolvers = new Map<string, (decision: ToolPermissionDecision) => void>()
  const sessionToolApprovals = ref<string[]>([])

  const conversationStateCache = ref<Record<string, {
    modelUid: string | null
    draft: ChatDraftState
    estimator: ChatEstimatorState
  }>>({})

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeTab = computed<ChatTab>(
    () => tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0]!,
  )

  // ── Conversation state cache ───────────────────────────────────────────────

  function snapshotConversationState(tab: ChatTab): void {
    if (!tab.conversationId)
      return
    conversationStateCache.value[tab.conversationId] = {
      modelUid: tab.modelUid ?? null,
      draft: { text: tab.draft.text, attachments: [] },
      estimator: { estimate: tab.estimator.estimate, error: tab.estimator.error, estimating: tab.estimator.estimating },
    }
  }

  function restoreConversationState(conversationId: string): {
    modelUid: string | null
    draft: ChatDraftState
    estimator: ChatEstimatorState
  } {
    const cached = conversationStateCache.value[conversationId]
    if (!cached)
      return { modelUid: null, draft: createEmptyDraft(), estimator: createEmptyEstimatorState() }
    return {
      modelUid: cached.modelUid,
      draft: { text: cached.draft.text, attachments: [] },
      estimator: { ...cached.estimator, estimating: false },
    }
  }

  watch(tabs, nextTabs => { nextTabs.forEach(snapshotConversationState) }, { deep: true })

  watch(activeId, id => {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab?.workspacePath)
      return
    const project = useProjectStore()
    if (project.projectPath !== tab.workspacePath)
      project.setProject(tab.workspacePath)
  }, { immediate: true })

  // ── Idle compaction ───────────────────────────────────────────────────────

  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  import('./chat/agent/lifecycle').then(({ agentBus }) => {
    agentBus.on('status-change', event => {
      const tab = tabs.value.find(t => t.id === event.tabId)
      if (!tab)
        return

      const settings = useSettingsStore()
      const idleTime = 300

      if (event.next.type === 'idle' && event.prev.type !== 'idle') {
        idleTimers.set(tab.id, setTimeout(() => {
          import('./chat/context/compaction').then(({ shouldCompactSession }) => {
            if (shouldCompactSession(tab, settings.agent.sessionCompaction?.thresholdPercent ?? 90)) {
              compactSession(tab.id, 'auto').catch(() => {})
            }
          })
        }, idleTime * 1000))
      }
      else if (event.next.type !== 'idle' && event.prev.type === 'idle') {
        const timer = idleTimers.get(tab.id)
        if (timer) {
          clearTimeout(timer)
          idleTimers.delete(tab.id)
        }
      }
    })
  })

  // ── Tab actions ───────────────────────────────────────────────────────────

  function addTab(): void {
    const tab = newTab()
    tab.workspacePath = useProjectStore().projectPath
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function addDesignTab(): void {
    const tab = newDesignTab()
    tab.workspacePath = useProjectStore().projectPath
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function markInterruptedAssistantMessage(tab: ChatTab, reason: string): void {
    const lastAssistant = [...tab.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant)
      return

    lastAssistant.error = reason
    if (tab.conversationId) {
      void dbUpdateMessage(lastAssistant.id, {
        content: lastAssistant.content,
        parts: lastAssistant.parts?.length ? JSON.stringify(lastAssistant.parts) : null,
        tool_events: lastAssistant.toolEvents?.length ? JSON.stringify(lastAssistant.toolEvents) : null,
      }).catch(() => {})
    }
  }

  function closeTab(id: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab)
      snapshotConversationState(tab)

    // ── SessionEnd hook ──────────────────────────────────────────────
    if (tab?.conversationId) {
      const lastMsg = tab.messages[tab.messages.length - 1]
      import('@/utils/hooks').then(({ fireHooks, projectNameFromPath }) => {
        fireHooks('SessionEnd', {
          event: 'SessionEnd',
          tabId: id,
          workspacePath: tab.workspacePath,
          projectName: projectNameFromPath(tab.workspacePath),
          conversationId: tab.conversationId,
          toolCallsCount: lastMsg?.role === 'assistant' ? (lastMsg.toolEvents?.length ?? 0) : 0,
        })
      }).catch(() => {})
    }

    const browser = useBrowserStore()
    const gitPane = useGitPaneStore()
    const terminal = useTerminalStore()

    abortControllers.get(id)?.abort()
    abortControllers.delete(id)

    // Kill all running shell/git tasks for this tab
    import('../utils/tools/shell').then(({ stopTasksForTab }) => {
      stopTasksForTab(id)
    }).catch(() => {})
    cleanupBgTaskNotifications(id)
    if (tab?.activeDesignProject?.path) {
      const projectPath = tab.activeDesignProject.path
      import('../utils/tools/designProject').then(({ stopDevServer }) => {
        stopDevServer(projectPath)
      }).catch(() => {})
    }

    if (tab?.agentStatus.type !== 'idle' && tab?.agentStatus.type !== 'error')
      markInterruptedAssistantMessage(tab!, 'Interrupted during generation.')

    // Dismiss pending questions
    const resolve = questionResolvers.get(id)
    if (resolve) {
      const pendingTab = tabs.value.find(t => t.id === id)
      const skipped = (pendingTab?.pendingQuestions?.questions ?? []).map(q => ({ question: q.question, answer: 'skipped' }))
      resolve(skipped)
      questionResolvers.delete(id)
    }

    // Deny all queued permission requests
    const closingTab = tabs.value.find(t => t.id === id)
    if (closingTab) {
      for (const perm of closingTab.pendingPermissions) {
        permissionResolvers.get(perm.requestId)?.('deny')
        permissionResolvers.delete(perm.requestId)
      }
      closingTab.pendingPermissions = []
    }

    import('./checkpoints').then(({ useCheckpointStore }) => {
      const checkpoints = useCheckpointStore()
      void checkpoints.finalizeCheckpoint(tab?.conversationId ?? null).finally(() => {
        checkpoints.clearTab(id, useProjectStore().projectPath ?? undefined)
      })
    }).catch(() => {})

    const idx = tabs.value.findIndex(t => t.id === id)

    if (tabs.value.length === 1) {
      browser.disposeOwner(id)
      gitPane.disposeOwner(id)
      void terminal.disposeOwner(id)
      const freshTab = newTab()
      freshTab.workspacePath = useProjectStore().projectPath
      tabs.value = [freshTab]
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
    isDesignTab?: boolean
    mode?: ChatMode
    designs?: ChatTab['designs']
    activeDesignId?: string | null
  }): void {
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
      agentStatus: STATUS_IDLE,
      todos: [],
      modelUid: restoredState.modelUid,
      draft: restoredState.draft,
      estimator: restoredState.estimator,
      isCompacting: false,
      pendingQuestions: null,
      pendingPermissions: [],
      readRegistry: new Map(),
      ...(payload.isDesignTab ? { isDesignTab: true, mode: 'design' as ChatMode, designs: payload.designs ?? [], activeDesignId: payload.activeDesignId ?? null } : {}),
      messageQueue: [],
    }

    tabs.value.push(tab)
    activeId.value = tab.id
    if (tab.workspacePath)
      useProjectStore().setProject(tab.workspacePath)

    // Load persisted tasks for this conversation
    ;(async () => {
      try {
        const scope: 'project' | 'global' = tab.workspaceMeta?.projectKey ? 'project' : 'global'
        const projectKey = tab.workspaceMeta?.projectKey ?? null
        const memories = await dbListMemories({ scope, projectKey, kind: 'task', key: payload.conversationId, limit: 1 })
        const memory = memories[0]
        if (memory?.content) {
          try { tab.todos = JSON.parse(memory.content) }
          catch { tab.todos = [] }
        }
      }
      catch { /* ignore */ }
    })()

    import('./checkpoints').then(({ useCheckpointStore }) => {
      useCheckpointStore().loadForConversation(tab.id, payload.conversationId)
    }).catch(() => {})
  }

  function stopGeneration(tabId?: string): void {
    const id = tabId ?? activeId.value
    // #region agent log
    fetch('http://127.0.0.1:7411/ingest/f4b72c61-7d32-407b-a0c8-9bdf31e403c2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '61c5e2' }, body: JSON.stringify({ sessionId: '61c5e2', location: 'chat.ts:stopGeneration', message: 'stopGeneration called', data: { tabId: id, hadAbortController: abortControllers.has(id) }, timestamp: Date.now(), hypothesisId: 'A,C' }) }).catch(() => {})
    // #endregion
    const stoppingTab = tabs.value.find(t => t.id === id)
    if (stoppingTab) {
      for (const perm of stoppingTab.pendingPermissions) {
        permissionResolvers.get(perm.requestId)?.('deny')
        permissionResolvers.delete(perm.requestId)
      }
      stoppingTab.pendingPermissions = []
      stoppingTab.messageQueue = []
    }
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    // Kill all running shell/git tasks for this tab
    import('../utils/tools/shell').then(({ stopTasksForTab }) => {
      stopTasksForTab(id)
    }).catch(() => {})
    cleanupBgTaskNotifications(id)
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      if (tab.agentStatus.type !== 'idle' && tab.agentStatus.type !== 'error')
        markInterruptedAssistantMessage(tab, 'Interrupted during generation.')
      setTabStatus(tab, STATUS_IDLE)
      if (tab.subAgent)
        tab.subAgent.status = 'error'
      import('./checkpoints').then(({ useCheckpointStore }) => {
        void useCheckpointStore().finalizeCheckpoint(tab.conversationId)
      }).catch(() => {})
    }
  }

  function updateTabDraft(tabId: string, patch: Partial<ChatDraftState>): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab)
      tab.draft = { ...tab.draft, ...patch }
  }

  function clearTabDraft(tabId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab)
      tab.draft = createEmptyDraft()
  }

  function setTabWorkspace(
    tabId: string,
    patch: { workspacePath: string | null; workspaceMeta?: ChatTab['workspaceMeta']; lock?: boolean },
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

  // ── Session compaction ────────────────────────────────────────────────────

  function insertStreamingCompactionDivider(tab: ChatTab): string | null {
    const existing = tab.messages.find(m => m.role === 'assistant' && m.content.trim() === SESSION_COMPACTING_DIVIDER)
    if (existing)
      return existing.id

    let liveAssistantIndex = -1
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      if (tab.messages[i]!.role === 'assistant') {
        liveAssistantIndex = i
        break
      }
    }
    if (liveAssistantIndex <= 0)
      return null

    const divider: Message = { id: makeId(), role: 'assistant', content: SESSION_COMPACTING_DIVIDER, timestamp: new Date() }
    tab.messages.splice(liveAssistantIndex, 0, divider)
    return divider.id
  }

  function removeStreamingCompactionDivider(tab: ChatTab, dividerId: string | null): void {
    if (!dividerId)
      return
    tab.messages = tab.messages.filter(m => m.id !== dividerId)
  }

  async function compactSession(tabId: string, source: 'auto' | 'manual' = 'manual'): Promise<{ ok: boolean; error?: string }> {
    const tab = tabs.value.find(item => item.id === tabId)
    if (!tab)
      return { ok: false, error: 'Tab not found' }
    if (tab.isCompacting)
      return { ok: false, error: 'Session compaction is already running' }
    if (!tab.conversationId)
      return { ok: false, error: 'This conversation has not been saved yet' }

    tab.isCompacting = true
    const pendingDividerId = tab.agentStatus.type !== 'idle' ? insertStreamingCompactionDivider(tab) : null

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
          const persistedCurrentCount = tab.messages.filter(m => m.content.trim() !== SESSION_COMPACTING_DIVIDER).length
          await dbDeleteMessages(deletedMessageIds)
          await persistCompactionMessages({ conversationId: tab.conversationId!, insertedMessages })
          await dbUpdateConversationMsgCount(tab.conversationId!, persistedCurrentCount - deletedMessageIds.length + insertedMessages.length)
          await checkpointStore.clearConversationCheckpoints(tab.id, tab.conversationId)
        },
      })

      snapshotConversationState(tab)
      return { ok: true }
    }
    catch (error) {
      removeStreamingCompactionDivider(tab, pendingDividerId)
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to compact session' }
    }
    finally {
      tab.isCompacting = false
    }
  }

  // ── Questions ─────────────────────────────────────────────────────────────

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
    _resolveQuestions(tabId, tab.pendingQuestions.questions.map(() => null))
  }

  // ── Session tool approvals ────────────────────────────────────────────────

  function isToolApprovedForSession(toolName: string): boolean {
    return sessionToolApprovals.value.includes(toolName)
  }

  function clearSessionToolApprovals(): void {
    sessionToolApprovals.value = []
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  function requestToolPermission(tabId: string, request: ToolPermissionRequest): Promise<ToolPermissionDecision> {
    if (isToolApprovedForSession(request.toolName))
      return Promise.resolve('allow-session')

    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return Promise.resolve('deny')

    const requestId = `${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const previousStatus = tab.agentStatus

    // Show waiting-permission status on the tab
    setTabStatus(tab, statusWaitingPermission(request.toolName))

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
        // Restore previous status
        setTabStatus(tab, previousStatus)
        resolve(decision)
      })
    })
  }

  function submitToolPermission(tabId: string, decision: ToolPermissionDecision, requestId?: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab || tab.pendingPermissions.length === 0)
      return
    const targetId = requestId ?? tab.pendingPermissions[0]?.requestId
    if (targetId)
      permissionResolvers.get(targetId)?.(decision)
  }

  // ── Message queue ─────────────────────────────────────────────────────────

  function enqueueMessage(text: string, attachments: Attachment[]): QueuedMessage {
    const item: QueuedMessage = { id: makeId(), text, attachments, queuedAt: Date.now() }
    activeTab.value.messageQueue.push(item)
    return item
  }

  function removeFromQueue(queueItemId: string): void {
    const tab = activeTab.value
    tab.messageQueue = tab.messageQueue.filter(m => m.id !== queueItemId)
  }

  function clearQueue(tabId?: string): void {
    const tab = tabs.value.find(t => t.id === (tabId ?? activeId.value))
    if (tab)
      tab.messageQueue = []
  }

  // ── Send message ──────────────────────────────────────────────────────────

  const { sendMessage } = createSendMessage(tabs, activeId, activeTab, abortControllers, questionResolvers, requestToolPermission, drainQueue)

  function drainQueue(): void {
    const tab = activeTab.value
    if (tab.agentStatus.type !== 'idle' || tab.messageQueue.length === 0)
      return
    const next = tab.messageQueue.shift()!
    void sendMessage(next.text, (tab.mode ?? 'build') as ChatMode, next.attachments.length > 0 ? next.attachments : undefined)
  }

  // ── Background task completion notifications ─────────────────────────────
  initBgTaskNotifications({
    getTabs: () => tabs.value,
    getActiveId: () => activeId.value,
    sendDirectMessage: (text: string, isBgNotification?: boolean) => sendMessage(text, undefined, undefined, undefined, isBgNotification),
  })
  import('@/utils/tools/shell').then(({ onBackgroundTaskComplete }) => {
    onBackgroundTaskComplete(handleBgTaskCompletion)
  }).catch(() => {})

  // ── Rename ────────────────────────────────────────────────────────────────

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

  // ── Checkpoint restore ────────────────────────────────────────────────────

  async function restoreToCheckpoint(tabId: string, checkpointId: string, mode: 'full' | 'conversation' | 'files' = 'full'): Promise<{ ok: boolean; error?: string }> {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return { ok: false, error: 'Tab not found' }
    if (tab.agentStatus.type !== 'idle' && tab.agentStatus.type !== 'error')
      return { ok: false, error: 'Cannot restore while streaming' }

    try {
      const { useCheckpointStore } = await import('./checkpoints')
      return await useCheckpointStore().restoreToCheckpoint(tab, checkpointId, mode)
    }
    catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Restore failed' }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    tabs,
    activeId,
    activeTab,
    conversationStateCache,
    addTab,
    addDesignTab,
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
    enqueueMessage,
    removeFromQueue,
    clearQueue,
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
