import type { MaybeRef } from 'vue'
import type { AgentStatus, AgentToolCategory, ChatTab } from '@/stores/chat/core/types'
import { computed, toValue, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

// ── Event types ───────────────────────────────────────────────────────────────

export interface AgentStatusChangeEvent {
  tabId: string
  prev: AgentStatus
  next: AgentStatus
}

export interface AgentToolEvent {
  tabId: string
  toolName: string
  category: AgentToolCategory
}

export interface AgentErrorEvent {
  tabId: string
  message: string
}

interface AgentEventMap {
  'status-change': AgentStatusChangeEvent
  'tool-start': AgentToolEvent
  'tool-end': AgentToolEvent
  'stream-start': { tabId: string }
  'stream-end': { tabId: string }
  error: AgentErrorEvent
}

type Listener<T> = (event: T) => void

// ── Global event bus ──────────────────────────────────────────────────────────

class AgentEventBus {
  private readonly listeners = new Map<string, Set<Listener<unknown>>>()

  on<K extends keyof AgentEventMap>(event: K, listener: Listener<AgentEventMap[K]>): () => void {
    if (!this.listeners.has(event))
      this.listeners.set(event, new Set())

    this.listeners.get(event)!.add(listener as Listener<unknown>)

    return () => {
      this.listeners.get(event)?.delete(listener as Listener<unknown>)
    }
  }

  emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]): void {
    this.listeners.get(event)?.forEach(l => l(payload))
  }
}

/**
 * Singleton event bus — prefer `useAgentLifecycle` / `useAgent` over direct import.
 * Kept public for OSS compatibility; treat as @internal.
 */
export const agentBus = new AgentEventBus()

// ── Centralized status accessors (CLEAN API) ─────────────────────────────────

/** Get current status for any tab (non-reactive). Use `useAgent(id).status` for reactive. */
export function getAgentStatus(tabId: string): AgentStatus {
  const chat = useChatStore()
  return chat.tabs.find(t => t.id === tabId)?.agentStatus ?? { type: 'idle' }
}

/** Single writer for agent status - always emits via bus. Replaces scattered setTabStatus. */
export function setAgentStatus(tabId: string, next: AgentStatus): void {
  const chat = useChatStore()
  const tab = chat.tabs.find(t => t.id === tabId)
  if (!tab)
    return
  setAgentStatusForTab(tab, next)
}

/** Direct tab-object variant - preferred in factories that already hold a tab ref. */
export function setAgentStatusForTab(tab: ChatTab, next: AgentStatus): void {
  const prev = tab.agentStatus
  if (prev.type === next.type && JSON.stringify(prev) === JSON.stringify(next))
    return
  tab.agentStatus = next
  emitStatusChange(tab.id, prev, next)
}

// ── Internal: emit status transitions ────────────────────────────────────────

export function emitStatusChange(tabId: string, prev: AgentStatus, next: AgentStatus): void {
  agentBus.emit('status-change', { tabId, prev, next })

  if (prev.type !== 'streaming' && next.type === 'streaming')
    agentBus.emit('stream-start', { tabId })

  if (prev.type === 'streaming' && next.type !== 'streaming')
    agentBus.emit('stream-end', { tabId })

  if (next.type === 'tool-running')
    agentBus.emit('tool-start', { tabId, toolName: next.toolName, category: next.category })

  if (prev.type === 'tool-running' && next.type !== 'tool-running')
    agentBus.emit('tool-end', { tabId, toolName: prev.toolName, category: prev.category })

  if (next.type === 'error')
    agentBus.emit('error', { tabId, message: next.message })
}

// ── Per-tab composable ────────────────────────────────────────────────────────

export function useAgentLifecycle(tabId: MaybeRef<string>) {
  const chat = useChatStore()

  const status = computed<AgentStatus>(() => {
    const id = toValue(tabId)
    return chat.tabs.find(t => t.id === id)?.agentStatus ?? { type: 'idle' }
  })

  function onStatusChange(cb: (event: AgentStatusChangeEvent) => void): () => void {
    return agentBus.on('status-change', event => {
      if (event.tabId === toValue(tabId))
        cb(event)
    })
  }

  function onToolStart(cb: (event: AgentToolEvent) => void): () => void {
    return agentBus.on('tool-start', event => {
      if (event.tabId === toValue(tabId))
        cb(event)
    })
  }

  function onToolEnd(cb: (event: AgentToolEvent) => void): () => void {
    return agentBus.on('tool-end', event => {
      if (event.tabId === toValue(tabId))
        cb(event)
    })
  }

  function onStreamStart(cb: () => void): () => void {
    return agentBus.on('stream-start', event => {
      if (event.tabId === toValue(tabId))
        cb()
    })
  }

  function onStreamEnd(cb: () => void): () => void {
    return agentBus.on('stream-end', event => {
      if (event.tabId === toValue(tabId))
        cb()
    })
  }

  function onError(cb: (event: AgentErrorEvent) => void): () => void {
    return agentBus.on('error', event => {
      if (event.tabId === toValue(tabId))
        cb(event)
    })
  }

  /** Watch-based alternative — fires synchronously on Vue's next tick. */
  function watchStatus(cb: (next: AgentStatus, prev: AgentStatus) => void) {
    return watch(status, (next, prev) => cb(next, prev), { immediate: false })
  }

  return {
    status,
    onStatusChange,
    onToolStart,
    onToolEnd,
    onStreamStart,
    onStreamEnd,
    onError,
    watchStatus,
  }
}
