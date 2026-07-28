import type { Message } from '@/stores/chat/core/types'
import type { ToolCallEvent, ToolResultEvent } from '@/utils/ai'
import { dbUpdateMessage } from '@/db/database'

const MAX_LIVE_OUTPUT_CHARS = 96_000

function appendBoundedOutput(current: string | undefined, chunk: string): string {
  const next = `${current ?? ''}${chunk}`
  if (next.length <= MAX_LIVE_OUTPUT_CHARS)
    return next
  const tail = next.slice(-MAX_LIVE_OUTPUT_CHARS)
  return `[Earlier output trimmed; showing last ${Math.round(MAX_LIVE_OUTPUT_CHARS / 1024)} KB]\n${tail}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamStatusHint
  = | 'streaming'
    | 'tool-running'
    | 'sleeping'
    | 'waiting-questions'
    | 'waiting-permission'

export interface StreamHandlersOptions {
  liveMsg: Message
  getToolLabel: (name: string, args: Record<string, unknown>) => string
  persistThrottleMs?: number
  onStatusChange?: (status: StreamStatusHint, meta?: { toolName?: string }) => void
  getTabStatus?: () => { type: string }
}

// ── Stream handlers factory ───────────────────────────────────────────────────

export function createStreamHandlers({
  liveMsg,
  getToolLabel,
  persistThrottleMs = 1500,
  onStatusChange,
  getTabStatus,
}: StreamHandlersOptions) {
  let _lastPersistAt = 0
  let _firstDelta = true

  const persistLive = (force = false) => {
    const now = Date.now()
    if (!force && now - _lastPersistAt < persistThrottleMs)
      return
    _lastPersistAt = now
    dbUpdateMessage(liveMsg.id, {
      content: liveMsg.content,
      parts: liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null,
      tool_events: liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null,
    }).catch(() => {})
  }

  let pendingDeltas: { type: 'text' | 'reasoning'; text: string }[] = []
  let flushRafId: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  const flushLive = () => {
    if (flushRafId !== null) {
      cancelAnimationFrame(flushRafId)
      flushRafId = null
    }
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    if (pendingDeltas.length === 0)
      return

    for (const delta of pendingDeltas) {
      liveMsg.parts ??= []
      const last = liveMsg.parts.at(-1)
      if (last?.type === delta.type) {
        last.text += delta.text
      }
      else {
        liveMsg.parts.push({ type: delta.type, text: delta.text })
      }
      if (delta.type === 'text')
        liveMsg.content += delta.text
    }

    pendingDeltas = []
    persistLive()
  }

  const scheduleFlush = () => {
    if (flushRafId === null && fallbackTimer === null) {
      flushRafId = requestAnimationFrame(flushLive)
      fallbackTimer = setTimeout(flushLive, 500)
    }
  }

  const onDelta = (delta: string) => {
    if (_firstDelta) {
      _firstDelta = false
      const currentStatus = getTabStatus?.()
      if (currentStatus?.type !== 'waiting-permission')
        onStatusChange?.('streaming')
    }
    pendingDeltas.push({ type: 'text', text: delta })
    scheduleFlush()
  }

  const onReasoningDelta = (delta: string) => {
    pendingDeltas.push({ type: 'reasoning', text: delta })
    scheduleFlush()
  }

  const handleToolCall = (event: ToolCallEvent) => {
    flushLive()
    liveMsg.toolEvents ??= []
    liveMsg.toolEvents.push({
      id: event.id,
      name: event.name,
      label: getToolLabel(event.name, event.args),
      status: 'running',
      toolName: event.name,
      startedAt: Date.now(),
      args: event.args,
    })
    liveMsg.parts ??= []
    liveMsg.parts.push({ type: 'tool', toolCallId: event.id })
    const currentStatus = getTabStatus?.()
    if (currentStatus?.type !== 'waiting-permission')
      onStatusChange?.('tool-running', { toolName: event.name })
    persistLive(true)
  }

  const handleToolResult = (event: ToolResultEvent) => {
    flushLive()
    const te = liveMsg.toolEvents?.find(e => e.id === event.id)
    if (te) {
      te.status = event.ok ? 'done' : 'error'
      te.finishedAt = Date.now()
      te.result = event.result

      if (event.ok) {
        const result = (event as unknown as { result?: Record<string, unknown> }).result

        // write_file / edit_files: annotate with +added / -removed
        const added = typeof result?.added === 'number' ? result.added : null
        const removed = typeof result?.removed === 'number' ? result.removed : null
        if (added !== null || removed !== null) {
          const parts: string[] = []
          if ((added ?? 0) > 0)
            parts.push(`+${added}`)
          if ((removed ?? 0) > 0)
            parts.push(`-${removed}`)
          if (parts.length > 0)
            te.label = `${te.label} ${parts.join(' ')}`
        }

        // read_files: per-file line ranges
        if (te.toolName === 'read_files') {
          const raw = event.result as unknown
          if (typeof raw === 'string') {
            const fileSections = raw.split(/^=== .+ ===$/m).filter(s => s.trim())
            if (fileSections.length > 1) {
              const ranges = fileSections.flatMap(section => {
                const lines = [...section.matchAll(/^(\d+)\t/gm)]
                if (!lines.length)
                  return []
                return [`#${lines[0]![1]}\u2013${lines[lines.length - 1]![1]}`]
              })
              if (ranges.length)
                te.label = `${te.label} ${ranges.join(' ')}`
            }
            else {
              const lineMatches = [...raw.matchAll(/^(\d+)\t/gm)]
              if (lineMatches.length)
                te.label = `${te.label} #${lineMatches[0]![1]}\u2013${lineMatches[lineMatches.length - 1]![1]}`
            }
          }
        }

        // glob: #numFiles
        if (te.toolName === 'glob') {
          const raw = event.result as unknown
          if (typeof raw === 'object' && raw !== null && 'numFiles' in raw)
            te.label = `${te.label} #${(raw as { numFiles: number }).numFiles}`
        }

        // grep: #numMatches
        if (te.toolName === 'grep') {
          const raw = event.result as unknown
          if (typeof raw === 'object' && raw !== null && 'numMatches' in raw)
            te.label = `${te.label} #${(raw as { numMatches: number }).numMatches}`
        }

        // create_image: provider/model
        if (te.toolName === 'create_image') {
          const raw = event.result as unknown
          if (typeof raw === 'object' && raw !== null && 'provider' in raw && 'model' in raw) {
            const prov = (raw as { provider: string }).provider
            const model = (raw as { model: string }).model
            if (prov && model)
              te.label = `${te.label} \u2014 ${prov}/${model}`
          }
        }
      }
    }
    // Don't overwrite status if we're still waiting on a queued permission request
    const currentStatus = getTabStatus?.()
    if (currentStatus?.type !== 'waiting-permission')
      onStatusChange?.('streaming')
    persistLive(true)
  }

  const handleToolExecutionStart = (event: { toolName: string; toolCallId?: string }) => {
    flushLive()
    const te = liveMsg.toolEvents?.find(e =>
      event.toolCallId ? e.id === event.toolCallId : e.toolName === event.toolName && e.status === 'running',
    )
    if (te) {
      te.metadata = { ...(te.metadata ?? {}), executionStartedAt: Date.now() }
      persistLive(true)
    }
  }

  const handleToolOutput = (event: { toolName: string; toolCallId?: string; stream: 'stdout' | 'stderr'; chunk: string }) => {
    flushLive()
    if (!event.chunk)
      return
    const te = liveMsg.toolEvents?.find(e =>
      event.toolCallId ? e.id === event.toolCallId : e.toolName === event.toolName && e.status === 'running',
    )
    if (!te)
      return
    te.liveOutput = {
      ...(te.liveOutput ?? {}),
      [event.stream]: appendBoundedOutput(te.liveOutput?.[event.stream], event.chunk),
    }
    persistLive()
  }

  return {
    onDelta,
    onReasoningDelta,
    onToolCall: handleToolCall,
    onToolResult: handleToolResult,
    onToolExecutionStart: handleToolExecutionStart,
    onToolOutput: handleToolOutput,
    persistLive,
    flushLive,
  }
}
