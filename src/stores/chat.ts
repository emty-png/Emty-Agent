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
 */

import type { ChatDraftState, ChatEstimatorState, ChatTab, Message } from './chat/types'
import type { QuestionAnswer } from '@/utils/tools/questions'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  dbUpdateConversationTitle,
} from '@/db/database'
import { createSendMessage } from './chat/sendMessage'
import { createEmptyDraft, createEmptyEstimatorState, makeId, newTab } from './chat/utils'

export type {
  Attachment,
  ChatMode,
  ChatTab,
  Message,
  MessagePart,
  SubAgentInfo,
  SubAgentPersonality,
  ToolEvent,
} from './chat/types'
export type { TodoItem } from '@/utils/tools/todos'

// ── constants ─────────────────────────────────────────────────────────────────

const MAX_TABS = 9

// ── store ─────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref<string>(tabs.value[0]!.id)
  const abortControllers = new Map<string, AbortController>()
  const questionResolvers = new Map<string, (answers: QuestionAnswer[]) => void>()

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
        mode: tab.draft.mode,
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
      draft: { text: cached.draft.text, mode: cached.draft.mode, attachments: [] },
      estimator: { ...cached.estimator, estimating: false },
    }
  }

  // Keep cache in sync as tabs mutate
  watch(tabs, nextTabs => {
    nextTabs.forEach(snapshotConversationState)
  }, { deep: true })

  // ── tab actions ───────────────────────────────────────────────────────────────

  function addTab(): void {
    if (tabs.value.length >= MAX_TABS)
      return
    const tab = newTab()
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function closeTab(id: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab)
      snapshotConversationState(tab)

    // Cancel any in-flight request
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)

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

    // Clean up checkpoints for this tab
    import('./checkpoints').then(({ useCheckpointStore }) => {
      useCheckpointStore().clearTab(id)
    }).catch(() => { })

    const idx = tabs.value.findIndex(t => t.id === id)

    if (tabs.value.length === 1) {
      // Always keep at least one tab
      tabs.value = [newTab()]
      activeId.value = tabs.value[0]!.id
      return
    }

    tabs.value.splice(idx, 1)
    if (activeId.value === id)
      activeId.value = tabs.value[Math.max(0, idx - 1)]!.id
  }

  function openConversation(payload: {
    conversationId: string
    title: string
    messages: Message[]
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
      isStreaming: false,
      todos: [],
      modelUid: restoredState.modelUid,
      draft: restoredState.draft,
      estimator: restoredState.estimator,
      pendingQuestions: null,
    }

    tabs.value.push(tab)
    activeId.value = tab.id

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
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      tab.isStreaming = false
      if (tab.subAgent)
        tab.subAgent.status = 'error'
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

  // ── send message ──────────────────────────────────────────────────────────────

  const sendMessage = createSendMessage(tabs, activeId, activeTab, abortControllers, questionResolvers)

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
    setTabModel,
    setTabEstimatorState,
    submitAnswers,
    dismissQuestions,
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
