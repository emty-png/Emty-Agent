import type { JSONValue, ModelMessage, ToolResultPart } from 'ai'
import type { ChatTab, Message, ToolEvent } from './types'
import { isImageMime } from './attachment-types'
import { SESSION_COMPACTED_DIVIDER, SESSION_COMPACTING_DIVIDER } from './constants'

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
    agentStatus: { type: 'idle' },
    todos: [],
    modelUid: null,
    draft: createEmptyDraft(),
    estimator: createEmptyEstimatorState(),
    isCompacting: false,
    pendingQuestions: null,
    pendingPermissions: [],
    readRegistry: new Map(),
    mode: 'build',
  }
}

export function newDesignTab(): ChatTab {
  return {
    id: makeId(),
    title: 'New Design',
    messages: [],
    conversationId: null,
    workspacePath: null,
    workspaceMeta: null,
    workspaceLocked: false,
    agentStatus: { type: 'idle' },
    todos: [],
    modelUid: null,
    draft: createEmptyDraft(),
    estimator: createEmptyEstimatorState(),
    isCompacting: false,
    pendingQuestions: null,
    pendingPermissions: [],
    readRegistry: new Map(),
    mode: 'design',
    isDesignTab: true,
    designs: [],
    activeDesignId: null,
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
 * Smartly compresses previous turn tool results to save maximum tokens without losing knowledge of the tool call.
 */
const MAX_TOOL_ARG_CHARS = 50_000

function truncateArgField(value: string, max: number): string {
  if (value.length <= max)
    return value
  const half = Math.floor(max / 2)
  return `${value.slice(0, half).trimEnd()}

[... truncated ${Math.round((value.length - max) / 1024)} KB — head and tail shown ...]

${value.slice(-half).trimStart()}`
}

function compressToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName === 'write_file') {
    const content = typeof args.content === 'string' ? args.content : null
    if (content && content.length > MAX_TOOL_ARG_CHARS)
      return { ...args, content: truncateArgField(content, MAX_TOOL_ARG_CHARS) }
    return args
  }

  if (toolName === 'edit_files') {
    let changed = false
    const next = { ...args } as Record<string, unknown>
    if (Array.isArray(next.edits)) {
      next.edits = next.edits.map((edit: unknown) => {
        if (typeof edit !== 'object' || edit === null)
          return edit
        const e = { ...edit } as Record<string, unknown>
        for (const key of ['old_string', 'new_string'] as const) {
          if (typeof e[key] === 'string' && (e[key] as string).length > MAX_TOOL_ARG_CHARS) {
            e[key] = truncateArgField(e[key] as string, MAX_TOOL_ARG_CHARS)
            changed = true
          }
        }
        return e
      })
    }
    return changed ? next : args
  }

  if (toolName === 'create_design_files' || toolName === 'edit_design_files') {
    // Truncate large file contents to avoid context bloat
    const next = { ...args } as Record<string, unknown>
    if (Array.isArray(next.files)) {
      next.files = next.files.map((file: { path: string; content: string }) => {
        if (file.content && file.content.length > MAX_TOOL_ARG_CHARS) {
          return { ...file, content: truncateArgField(file.content, MAX_TOOL_ARG_CHARS) }
        }
        return file
      })
    }
    return next
  }

  // Global ceiling: if any tool produces unexpectedly large args
  const serialized = JSON.stringify(args)
  if (serialized && serialized.length > MAX_TOOL_ARG_CHARS * 2)
    return { _compressed: true, summary: `Args were ${Math.round(serialized.length / 1024)} KB — truncated to avoid context bloat. Re-read files if needed.` }

  return args
}

function smartCompressToolResult(toolName: string, result: unknown): unknown {
  // Preserve full file read / edit results so the model can reference prior
  // content on subsequent turns without re-reading the file.
  if (toolName === 'read_files' || toolName === 'read_file' || toolName === 'edit_files')
    return result

  if (typeof result !== 'object' || result === null) {
    if (typeof result === 'string' && result.length > 2500)
      return `...[truncated]...\n${result.slice(-2500)}`
    return result
  }

  const cloned = { ...result } as Record<string, unknown>

  // Drop large payloads from file reading / viewing tools
  if (toolName === 'read_file' || toolName === 'view_file' || toolName === 'browser' || toolName === 'list_dir') {
    if ('content' in cloned && typeof cloned.content === 'string')
      cloned.content = '[Content omitted to save context length. File read successfully. Use tool again if needed.]'
    if ('text' in cloned && typeof cloned.text === 'string')
      cloned.text = '[Content omitted to save context length. File read successfully. Use tool again if needed.]'
    if ('output' in cloned && typeof cloned.output === 'string')
      cloned.output = '[Content omitted to save context length. File read successfully. Use tool again if needed.]'
  }

  // Truncate massive command outputs
  if (toolName === 'run_command' || toolName === 'execute_command') {
    if ('stdout' in cloned && typeof cloned.stdout === 'string' && cloned.stdout.length > 2000)
      cloned.stdout = `...[truncated]...\n${cloned.stdout.slice(-2000)}`
    if ('stderr' in cloned && typeof cloned.stderr === 'string' && cloned.stderr.length > 2000)
      cloned.stderr = `...[truncated]...\n${cloned.stderr.slice(-2000)}`
    if ('output' in cloned && typeof cloned.output === 'string' && cloned.output.length > 2000)
      cloned.output = `...[truncated]...\n${cloned.output.slice(-2000)}`
  }

  if ('diff' in cloned && typeof cloned.diff === 'string' && cloned.diff.length > 4000)
    cloned.diff = `${cloned.diff.slice(0, 2000)}\n...[diff truncated]...\n${cloned.diff.slice(-2000)}`
  if ('files' in cloned && Array.isArray(cloned.files)) {
    cloned.files = cloned.files.map(file => {
      if (typeof file !== 'object' || file === null)
        return file
      const nextFile = { ...file } as Record<string, unknown>
      if (typeof nextFile.diff === 'string' && nextFile.diff.length > 4000)
        nextFile.diff = `${nextFile.diff.slice(0, 2000)}\n...[diff truncated]...\n${nextFile.diff.slice(-2000)}`
      return nextFile
    })
  }

  return cloned
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

    const compactDivider = m.content.trim()
    if (m.role === 'assistant' && (compactDivider === SESSION_COMPACTED_DIVIDER || compactDivider === SESSION_COMPACTING_DIVIDER))
      continue

    // Skip completely empty messages unless they have tool data or an error note.
    const hasToolData = persistedToolEvents(m.toolEvents).length > 0
    const errorText = typeof m.error === 'string'
      ? m.error.trim()
      : m.error
        ? String(m.error).trim()
        : ''
    if (!hasToolData && !m.content.trim() && !m.mentionContext?.trim() && !m.attachments?.length && !errorText)
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
    const messageText = baseText

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
          const combinedText = messageText ? `${messageText}\n\n${fileContext}` : fileContext
          content.push({ type: 'text', text: combinedText })
        }
        else {
          content.push({ type: 'text', text: messageText })
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

      result.push({ role: 'user' as const, content: messageText })
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

    if (messageText) {
      assistantContent.push({ type: 'text', text: messageText })
    }

    for (const event of toolEvents) {
      assistantContent.push({
        type: 'tool-call',
        toolCallId: event.id,
        toolName: event.toolName,
        input: event.args ? compressToolArgs(event.toolName, event.args) : {},
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
          ? smartCompressToolResult(event.toolName, event.result)
          : event.status === 'error'
            ? 'Tool execution failed'
            : 'Success',
      ),
    }))

    result.push({ role: 'tool' as const, content: toolContent })
  }

  return result
}
