/**
 * Background task completion notification bridge.
 *
 * Buffers completion events from shell.ts, batches rapid completions,
 * and delivers them to the correct chat tab as visible messages with
 * a divider. Auto-starts the agent if the tab is idle and active.
 */

import type { ChatTab } from './types'
import type { BackgroundTaskCompletionEvent } from '@/utils/tools/shell'
import { dbInsertMessage, dbTouchConversation } from '@/db/database'
import { agentBus } from './agentLifecycle'
import { isActiveStatus } from './agentStatus'
import { BG_TASK_COMPLETED_DIVIDER } from './constants'
import { makeId } from './utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface PendingNotification {
  event: BackgroundTaskCompletionEvent
  tabId: string
}

// ── State ──────────────────────────────────────────────────────────────────

/** Per-tab buffer of pending completion events. */
const pendingByTab = new Map<string, PendingNotification[]>()

/** Debounce timer per tab — batches rapid completions into one delivery. */
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** How long to wait (ms) before flushing a batch. */
const BATCH_DELAY_MS = 300

/** Tab IDs for which we are currently waiting for the agent to become idle. */
const waitingForIdle = new Set<string>()

/** Active status-change listeners for waiting tabs. */
const idleWaitUnsub = new Map<string, () => void>()

// ── Injected dependencies ──────────────────────────────────────────────────

let getTabs: (() => ChatTab[]) | null = null
let getActiveId: (() => string) | null = null
let sendDirectMessage: ((text: string, isBgNotification?: boolean) => Promise<void>) | null = null

/**
 * Initialize the notification bridge with references to the chat store.
 * Must be called once during store setup.
 */
export function initBgTaskNotifications(deps: {
  getTabs: () => ChatTab[]
  getActiveId: () => string
  sendDirectMessage: (text: string, isBgNotification?: boolean) => Promise<void>
}): void {
  getTabs = deps.getTabs
  getActiveId = deps.getActiveId
  sendDirectMessage = deps.sendDirectMessage
}

// ── Public: called by shell.ts completion listener ─────────────────────────

/**
 * Handle a background task completion event.
 * Buffers the event and schedules a flush after a short debounce.
 */
export function handleBgTaskCompletion(event: BackgroundTaskCompletionEvent): void {
  if (!event.tabId || !getTabs)
    return

  // Validate tab still exists
  const tab = getTabs().find(t => t.id === event.tabId)
  if (!tab)
    return

  // Skip sub-agent tabs — they see tool results directly
  if (tab.subAgent)
    return

  // Add to buffer
  if (!pendingByTab.has(event.tabId))
    pendingByTab.set(event.tabId, [])
  pendingByTab.get(event.tabId)!.push({ event, tabId: event.tabId })

  // Debounce: reset timer so rapid completions batch together
  const existingTimer = flushTimers.get(event.tabId)
  if (existingTimer)
    clearTimeout(existingTimer)
  const tabId = event.tabId
  flushTimers.set(tabId, setTimeout(() => {
    flushTimers.delete(tabId)
    tryFlushTab(tabId)
  }, BATCH_DELAY_MS))
}

// ── Internal: flush logic ──────────────────────────────────────────────────

/**
 * Attempt to deliver pending notifications for a tab.
 * If the agent is idle, deliver immediately.
 * If the agent is busy, wait for idle via agentBus status-change events.
 */
function tryFlushTab(tabId: string): void {
  const pending = pendingByTab.get(tabId)
  if (!pending || pending.length === 0)
    return

  const tabs = getTabs!()
  const tab = tabs.find((t: ChatTab) => t.id === tabId)
  if (!tab) {
    pendingByTab.delete(tabId)
    return
  }

  // If agent is idle, deliver now
  if (!isActiveStatus(tab.agentStatus)) {
    deliverNotifications(tabId, pending)
    return
  }

  // Agent is busy — wait for idle
  if (waitingForIdle.has(tabId))
    return
  waitingForIdle.add(tabId)

  const unsub = agentBus.on('status-change', evt => {
    if (evt.tabId !== tabId)
      return
    if (isActiveStatus(evt.next))
      return

    // Agent became idle
    waitingForIdle.delete(tabId)
    idleWaitUnsub.delete(tabId)
    unsub()

    // Re-check tab still exists and notifications still pending
    const buffered = pendingByTab.get(tabId)
    if (buffered && buffered.length > 0) {
      const stillTab = getTabs!().find((t: ChatTab) => t.id === tabId)
      if (stillTab) {
        deliverNotifications(tabId, buffered)
      }
      else {
        pendingByTab.delete(tabId)
      }
    }
  })
  idleWaitUnsub.set(tabId, unsub)
}

// ── Internal: message construction and delivery ────────────────────────────

const MAX_NOTIFY_OUTPUT_CHARS = 4000
const MAX_NOTIFY_OUTPUT_LINES = 100

/**
 * Build notification messages and deliver them to the tab.
 * Produces: divider message (assistant role) + content (user role).
 * If the tab is active and idle, auto-starts a new agent turn.
 */
function deliverNotifications(tabId: string, notifications: PendingNotification[]): void {
  const tab = getTabs!().find((t: ChatTab) => t.id === tabId)
  if (!tab) {
    pendingByTab.delete(tabId)
    return
  }

  // Clear the buffer
  pendingByTab.delete(tabId)

  // Build the content message
  const lines: string[] = []
  for (const { event } of notifications) {
    const statusLabel = event.status === 'completed'
      ? (event.exitCode === 0 ? 'completed successfully' : `completed with exit code ${event.exitCode}`)
      : event.status === 'failed'
        ? 'failed'
        : event.status === 'killed'
          ? 'was killed'
          : 'timed out'

    lines.push(`Background task ${event.taskId} (${event.command}): ${statusLabel}`)

    const stdout = event.stdout?.trim()
    const stderr = event.stderr?.trim()
    const parts: string[] = []

    if (stdout) {
      const truncated = truncateForNotification(stdout)
      if (truncated)
        parts.push(truncated)
    }
    if (stderr) {
      const truncated = truncateForNotification(stderr)
      if (truncated)
        parts.push(`[stderr]\n${truncated}`)
    }

    if (parts.length > 0) {
      lines.push(parts.join('\n\n'))
    }
    lines.push('') // blank line between tasks
  }

  let contentText = lines.join('\n').trim()
  if (!contentText)
    return

  contentText = `[SYSTEM NOTIFICATION]
This is an automated system reminder indicating that the background task(s) have finished. This is NOT a message from the user.
Please do NOT reply to or mention this notification in your response to the user, as it would disrupt the conversation flow. Simply proceed with your work or wait for the user's next instructions.

---
${contentText}`

  // 1. Push divider message (assistant role — filtered from API messages)
  const dividerMsg = {
    id: makeId(),
    role: 'assistant' as const,
    content: BG_TASK_COMPLETED_DIVIDER,
    timestamp: new Date(),
  }
  tab.messages.push(dividerMsg)

  // 2. If this is the active tab, sendMessage will create the user message
  //    and start the agent turn. For non-active tabs, push the user message
  //    directly so it's visible when the user switches to that tab.
  const isActive = tabId === getActiveId!()

  if (isActive && sendDirectMessage) {
    // sendMessage creates the user message and starts the agent turn
    void sendDirectMessage(contentText, true)
  }
  else {
    // Non-active tab: push user message directly
    const userMsg = {
      id: makeId(),
      role: 'user' as const,
      content: contentText,
      timestamp: new Date(),
      isBgNotification: true,
    }
    tab.messages.push(userMsg)
  }

  // 3. Persist messages to DB
  if (tab.conversationId) {
    const convId = tab.conversationId
    const now = Date.now()
    dbInsertMessage({
      id: dividerMsg.id,
      conversation_id: convId,
      role: 'assistant',
      content: BG_TASK_COMPLETED_DIVIDER,
      created_at: now,
    }).catch(() => {})
    if (!isActive) {
      // sendMessage handles persistence for active tab
      const lastMsg = tab.messages[tab.messages.length - 1]
      if (lastMsg && lastMsg.role === 'user') {
        dbInsertMessage({
          id: lastMsg.id,
          conversation_id: convId,
          role: 'user',
          content: lastMsg.content,
          created_at: now,
          is_bg_notification: 1,
        }).catch(() => {})
      }
    }
    dbTouchConversation(convId).catch(() => {})
  }
}

// ── Internal: truncation ───────────────────────────────────────────────────

function truncateForNotification(text: string): string {
  const lines = text.split(/\r?\n/g)
  let result = text

  if (lines.length > MAX_NOTIFY_OUTPUT_LINES) {
    result = lines.slice(-MAX_NOTIFY_OUTPUT_LINES).join('\n')
  }
  if (result.length > MAX_NOTIFY_OUTPUT_CHARS) {
    const half = Math.floor(MAX_NOTIFY_OUTPUT_CHARS / 2)
    result = `${result.slice(0, half).trimEnd()}\n\n[... truncated ...]\n\n${result.slice(-half).trimStart()}`
  }

  return result
}

// ── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Discard any pending notifications for a tab.
 * Called when a tab is closed or generation is stopped.
 */
export function cleanupBgTaskNotifications(tabId: string): void {
  pendingByTab.delete(tabId)
  const timer = flushTimers.get(tabId)
  if (timer) {
    clearTimeout(timer)
    flushTimers.delete(tabId)
  }
  waitingForIdle.delete(tabId)
  const unsub = idleWaitUnsub.get(tabId)
  if (unsub) {
    unsub()
    idleWaitUnsub.delete(tabId)
  }
}
