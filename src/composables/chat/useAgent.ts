import type { MaybeRef } from 'vue'
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import type { AgentStatus, ChatMode, ChatTab } from '@/stores/chat/core/types'
import { computed, toValue } from 'vue'
import { useChatStore } from '@/stores/chat'
import { getAgentStatus, useAgentLifecycle } from '@/stores/chat/agent/lifecycle'
import {
  isActiveStatus,
  isCompactingStatus,
  isErrorStatus,
  isIdleStatus,
  isSleepingStatus,
  isStreamingStatus,
  isStrictStreamingStatus,
  isToolRunningStatus,
  isWaitingPermissionStatus,
  isWaitingQuestionsStatus,
  isWaitingStatus,
} from '@/stores/chat/agent/status'

export type { AgentStatus, ChatTab }

/**
 * CLEAN public API for agent status + AI interactions per tab.
 * Mode-agnostic - works for build/plan/chat/design and future modes.
 *
 * Usage:
 *   const { status, isStreaming, send, stop, onStatusChange } = useAgent()
 *   const { status: tabStatus } = useAgent(tabId)
 *   const { status } = useAgent(() => chat.activeId) // reactive ref
 *
 * For non-composable contexts: `getAgentStatus(tabId)` / `setAgentStatus(tabId, next)`
 */
export function useAgent(tabId?: MaybeRef<string>) {
  const chat = useChatStore()

  const id = computed(() => {
    const v = tabId !== undefined ? toValue(tabId) : undefined
    return v ?? chat.activeId
  })

  const tab = computed<ChatTab>(() => chat.tabs.find(t => t.id === id.value) ?? chat.activeTab)

  const lifecycle = useAgentLifecycle(id)

  // ── Status predicates ────────────────────────────────────────────────
  // isStreaming (strict) = spinner/gloss only (streaming|tool-running|initializing)
  // isBusy/active = Stop/queue logic (not idle/error) - legacy isStreamingStatus
  const isIdle = computed(() => isIdleStatus(lifecycle.status.value))
  const isError = computed(() => isErrorStatus(lifecycle.status.value))
  const isStreaming = computed(() => isStrictStreamingStatus(lifecycle.status.value))
  const isBusy = computed(() => isActiveStatus(lifecycle.status.value))
  // Legacy alias - same as isBusy, for OSS compat where isStreaming meant busy
  const isStreamingLegacy = computed(() => isStreamingStatus(lifecycle.status.value))
  const isCompacting = computed(() => isCompactingStatus(lifecycle.status.value))
  const isWaiting = computed(() => isWaitingStatus(lifecycle.status.value))
  const isToolRunning = computed(() => isToolRunningStatus(lifecycle.status.value))
  const isWaitingPermission = computed(() => isWaitingPermissionStatus(lifecycle.status.value))
  const isWaitingQuestions = computed(() => isWaitingQuestionsStatus(lifecycle.status.value))
  const isSleeping = computed(() => isSleepingStatus(lifecycle.status.value))

  function isToolRunningFor(toolName?: string): boolean {
    const s = lifecycle.status.value
    if (s.type !== 'tool-running')
      return false
    return !toolName || s.toolName === toolName
  }

  // ── Messages / draft ─────────────────────────────────────────────────────
  const messages = computed(() => tab.value.messages)
  const draft = computed({
    get: () => tab.value.draft,
    set: (v: ChatTab['draft']) => chat.updateTabDraft(id.value, v),
  })

  // ── Actions ──────────────────────────────────────────────────────────────
  function send(
    content: string,
    opts?: {
      attachments?: Attachment[]
      mode?: ChatMode
      modelUid?: string | null
    },
  ): Promise<void> {
    // Overload-friendly: supports both old positional mental model and new object opts.
    // Respects per-tab mode if not specified - future modes auto-handled.
    const mode = opts?.mode ?? tab.value.mode ?? 'build'
    return chat.sendMessage(content, mode as ChatMode, opts?.attachments, opts?.modelUid ?? null)
  }

  function stop(): void {
    chat.stopGeneration(id.value)
  }

  function enqueue(text: string, attachments: Attachment[] = []): unknown {
    // Delegates to chat.enqueueMessage but ensures active tab handling is via id
    if (id.value === chat.activeId)
      return chat.enqueueMessage(text, attachments)
    // Fallback: switch active then enqueue (keeps existing queue semantics)
    const prev = chat.activeId
    chat.activeId = id.value
    const res = chat.enqueueMessage(text, attachments)
    chat.activeId = prev
    return res
  }

  return {
    // State
    tab,
    status: lifecycle.status,
    messages,
    draft,
    // Predicates
    isIdle,
    isError,
    isStreaming,
    isStreamingLegacy,
    isBusy,
    isCompacting,
    isWaiting,
    isToolRunning,
    isWaitingPermission,
    isWaitingQuestions,
    isSleeping,
    isToolRunningFor,
    // Events (from useAgentLifecycle)
    onStatusChange: lifecycle.onStatusChange,
    onToolStart: lifecycle.onToolStart,
    onToolEnd: lifecycle.onToolEnd,
    onStreamStart: lifecycle.onStreamStart,
    onStreamEnd: lifecycle.onStreamEnd,
    onError: lifecycle.onError,
    watchStatus: lifecycle.watchStatus,
    // Actions
    send,
    stop,
    enqueue,
    // Escape hatch for non-reactive read
    getStatus: () => getAgentStatus(id.value),
  }
}

/** Alias for searchability - useChat === useAgent */
export const useChat = useAgent

/** Re-export helpers for direct import `import { isStreamingStatus } from '@/composables/chat/useAgent'` */
export {
  getAgentStatus,
  isActiveStatus,
  isCompactingStatus,
  isErrorStatus,
  isIdleStatus,
  isSleepingStatus,
  isStreamingStatus,
  isStrictStreamingStatus,
  isToolRunningStatus,
  isWaitingPermissionStatus,
  isWaitingQuestionsStatus,
  isWaitingStatus,
}
