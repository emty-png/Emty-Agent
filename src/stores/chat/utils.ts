import type { JSONValue, ModelMessage, ToolResultPart } from 'ai'
import type { ChatTab, Message, ToolEvent } from './types'
import { isImageMime } from './attachment-types'

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function createEmptyDraft() {
  return {
    text: '',
    attachments: [],
  }
}

export function createEmptyEstimatorState() {
  return {
    estimate: null,
    error: '',
    estimating: false,
  }
}

export function newTab(): ChatTab {
  return {
    id: makeId(),
    title: 'New chat',
    messages: [],
    conversationId: null,
    workspacePath: null,
    workspaceMeta: null,
    workspaceLocked: false,
    isStreaming: false,
    todos: [],
    modelUid: null,
    draft: createEmptyDraft(),
    estimator: createEmptyEstimatorState(),
    pendingQuestions: null,
    pendingPermissions: [],
  }
}

// ── tool result helpers ─────────────────────────────────────────────────────

/**
 * Wrap a raw tool result value into the discriminated-union `output` format
 * required by AI SDK v6 (`ToolResultOutput`).
 *
 * - Strings  → `{ type: 'text', value }`
 * - Other    → `{ type: 'json', value }`
 */
function wrapToolOutput(value: unknown): { type: 'text'; value: string } | { type: 'json'; value: JSONValue } {
  if (typeof value === 'string')
    return { type: 'text', value }
  return { type: 'json', value: (value ?? null) as JSONValue }
}

/**
 * Return only the tool events that carry persisted `args` (and therefore can
 * be reconstructed as proper tool-call / tool-result message pairs).
 */
function persistedToolEvents(events: ToolEvent[] | undefined): ToolEvent[] {
  if (!events?.length)
    return []
  return events.filter(e => e.args !== undefined)
}

// ── toModelMessages ─────────────────────────────────────────────────────────

/**
 * Convert internal Message[] to AI SDK ModelMessage[].
 *
 * For assistant messages that contain persisted tool events (with `args` and
 * `result`), the function emits the correct AI SDK v6 multi-message sequence:
 *
 *   1. An `assistant` message whose `content` array includes both text parts
 *      and `{ type: 'tool-call', toolCallId, toolName, input }` parts.
 *   2. A `tool` message whose `content` array includes the corresponding
 *      `{ type: 'tool-result', toolCallId, toolName, output }` parts.
 *
 * This allows the model to see the full tool interaction history on subsequent
 * turns, exactly as the AI SDK expects.
 *
 * User messages with image attachments are converted to multimodal content
 * arrays containing TextPart + ImagePart entries so vision-capable models
 * receive the image data inline.
 */
export function toModelMessages(
  messages: Message[],
  options?: {
    skipLastMessageMentionContext?: boolean
  },
): ModelMessage[] {
  const lastMessageIndex = messages.length - 1
  const result: ModelMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!

    // Skip messages with errors or completely empty content (unless they have tool data)
    const hasToolData = persistedToolEvents(m.toolEvents).length > 0
    if (!hasToolData && !m.content.trim() && !m.mentionContext?.trim() && !m.attachments?.length)
      continue
    if (m.error)
      continue

    const text = m.content.trim()
    const mentionContext = options?.skipLastMessageMentionContext && i === lastMessageIndex
      ? ''
      : m.mentionContext?.trim() ?? ''
    const baseText = mentionContext
      ? text
        ? `${mentionContext}\n\n${text}`
        : mentionContext
      : text

    // ── User messages ─────────────────────────────────────────────────
    if (m.role === 'user') {
      if (m.attachments?.length) {
        const imageAttachments = m.attachments.filter(a => isImageMime(a.mimeType))
        const fileAttachments = m.attachments.filter(a => !isImageMime(a.mimeType))

        // Build multimodal content parts
        const content: Array<
          | { type: 'text'; text: string }
          | { type: 'image'; image: URL | string; mimeType?: string }
        > = []

        // Prepend file contents as text context (non-image attachments)
        if (fileAttachments.length > 0) {
          const fileContext = fileAttachments
            .map(f => `--- ${f.name} ---\n${f.dataUrl}`)
            .join('\n\n')
          const combinedText = baseText ? `${baseText}\n\n${fileContext}` : fileContext
          content.push({ type: 'text', text: combinedText })
        }
        else {
          content.push({ type: 'text', text: baseText })
        }

        // Append image parts
        for (const img of imageAttachments) {
          content.push({
            type: 'image',
            image: img.dataUrl,
            ...(img.mimeType ? { mimeType: img.mimeType } : {}),
          })
        }

        result.push({ role: 'user' as const, content })
        continue
      }

      result.push({ role: 'user' as const, content: baseText })
      continue
    }

    // ── Assistant messages ─────────────────────────────────────────────
    const toolEvents = persistedToolEvents(m.toolEvents)

    if (toolEvents.length === 0) {
      // Simple text-only assistant turn
      if (text) {
        result.push({ role: 'assistant' as const, content: text })
      }
      continue
    }

    // Build the assistant message content array: text + tool-call parts
    const assistantContent: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    > = []

    if (text) {
      assistantContent.push({ type: 'text', text })
    }

    for (const event of toolEvents) {
      assistantContent.push({
        type: 'tool-call',
        toolCallId: event.id,
        toolName: event.toolName,
        input: event.args ?? {},
      })
    }

    result.push({ role: 'assistant' as const, content: assistantContent })

    // Build the tool message with corresponding tool-result parts
    const toolContent: ToolResultPart[] = toolEvents.map(event => ({
      type: 'tool-result' as const,
      toolCallId: event.id,
      toolName: event.toolName,
      output: wrapToolOutput(
        event.result !== undefined
          ? event.result
          : event.status === 'error'
            ? 'Tool execution failed'
            : 'Success',
      ),
    }))

    result.push({ role: 'tool' as const, content: toolContent })
  }

  return result
}
