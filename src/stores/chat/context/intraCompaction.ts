import type { ModelMessage } from 'ai'
import type { Message, ToolEvent } from '@/stores/chat/core/types'
import { countTokens as countTextTokens } from 'gpt-tokenizer'

const INTRA_KEEP_LAST = 2
const INTRA_TAIL_CHARS = 300
const INTRA_REASONING_KEEP_CHARS = 600
const INTRA_REASONING_COLLAPSED_LINE = 120

function estimateTokens(text: string): number {
  try {
    return countTextTokens(text)
  }
  catch {
    return Math.ceil(text.length / 4)
  }
}

function truncateTail(value: string, maxChars: number): string {
  if (value.length <= maxChars)
    return value
  return `${value.slice(0, Math.floor(maxChars * 0.72)).trimEnd()}\n\n[... trimmed ...]\n\n${value.slice(-Math.floor(maxChars * 0.28)).trimStart()}`
}

function stringifyResult(result: unknown): string {
  if (result == null)
    return ''
  if (typeof result === 'string')
    return result
  try {
    return JSON.stringify(result, null, 2)
  }
  catch {
    return String(result)
  }
}

function isAdaptiveKeepTail(toolName: string): boolean {
  // keep 300-char tail for read/grep/glob-style results (helpful for debugging)
  return toolName === 'read_files'
    || toolName === 'read_file'
    || toolName === 'view_file'
    || toolName === 'grep'
    || toolName === 'glob'
    || toolName === 'list_dir'
    || toolName === 'browser'
}

function makeResultStub(event: ToolEvent, keepTail: boolean): unknown {
  const raw = stringifyResult(event.result)
  const tokens = raw ? estimateTokens(raw) : 0

  if (!raw)
    return { __compacted: true, note: '[Compacted: no output]' }

  if (keepTail) {
    const preview = truncateTail(raw, INTRA_TAIL_CHARS)
    // keep label annotation (e.g., +added/-removed, #lines) in note
    return {
      __compacted: true,
      originalTokens: tokens,
      note: `[Compacted: kept ${Math.min(INTRA_TAIL_CHARS, raw.length)}-char tail — re-read if needed]`,
      preview,
    }
  }

  // hard stub
  const added = (event.result as Record<string, unknown> | null)?.added as number | undefined
  const removed = (event.result as Record<string, unknown> | null)?.removed as number | undefined
  const parts: string[] = []
  if (typeof added === 'number' && added > 0)
    parts.push(`+${added}`)
  if (typeof removed === 'number' && removed > 0)
    parts.push(`-${removed}`)
  const change = parts.length ? ` (${parts.join(' ')})` : ''
  return {
    __compacted: true,
    originalTokens: tokens,
    note: `[Pruned to reclaim ~${tokens} tokens${change} — tools succeeded. Re-run or re-read if needed.]`,
  }
}

export interface IntraCompactionResult {
  pruned: Message
  reclaimedTokens: number
  originalTokens: number
  prunedTokens: number
  keptIds: string[]
  prunedIds: string[]
  strategy: 'l1'
}

/**
 * L1 intra-message pruning — keep last K tool pairs intact, adaptive stubs for older,
 * collapse reasoning, drop liveOutput. Pure, does not mutate input.
 */
export function sanitizeLiveMessage(
  liveMsg: Message,
  opts?: { keepPairs?: number; tailChars?: number; reasoningKeepChars?: number },
): IntraCompactionResult | null {
  const keepPairs = opts?.keepPairs ?? INTRA_KEEP_LAST
  const events = liveMsg.toolEvents ?? []
  if (events.length === 0 && (!liveMsg.parts || liveMsg.parts.filter(p => p.type === 'reasoning').length === 0))
    return null

  const keepFrom = Math.max(0, events.length - keepPairs)
  const keptIds = events.slice(keepFrom).map(e => e.id)
  const prunedIds = events.slice(0, keepFrom).map(e => e.id)

  // If nothing to prune and reasoning small, skip
  const reasoningParts = (liveMsg.parts ?? []).filter(p => p.type === 'reasoning')
  const reasoningBig = reasoningParts.reduce((acc, p) => acc + (p.text.length || 0), 0) > 1500
  const needsPrune = prunedIds.length > 0 || reasoningBig
  if (!needsPrune)
    return null

  const originalTokens = estimateFullMessageTokensForIntra(liveMsg)

  // clone
  const sanitizedParts = sanitizeParts(liveMsg.parts, opts?.reasoningKeepChars ?? INTRA_REASONING_KEEP_CHARS)
  const prunedBase: Message = {
    ...liveMsg,
    toolEvents: events.map((ev, idx) => {
      if (idx >= keepFrom)
        return { ...ev }
      // prune older — drop liveOutput (delete key rather than undefined for exactOptionalPropertyTypes)
      const keepTail = isAdaptiveKeepTail(ev.toolName)
      const stub = makeResultStub(ev, keepTail)
      const next: ToolEvent = {
        ...ev,
        result: stub,
        metadata: ev.metadata ? { ...ev.metadata, __compacted: true } : { __compacted: true },
      }
      // remove liveOutput key explicitly if present
      if ('liveOutput' in next)
        delete (next as unknown as Record<string, unknown>).liveOutput
      return next
    }),
  }
  const pruned: Message = sanitizedParts
    ? { ...prunedBase, parts: sanitizedParts }
    : (() => {
        const { parts: _omit, ...rest } = prunedBase as unknown as Record<string, unknown>
        void _omit
        return rest as unknown as Message
      })()

  // also drop liveOutput from kept ones to reclaim? keep for UI but clone without? we drop liveOutput from older only; kept liveOutput kept but we trim?
  // Drop liveOutput from all to be safe for outbound payload (liveOutput never serialized in toModelMessages, but saves DB)
  // Actually keep liveOutput on kept ones for UI expand; but for token calc it's irrelevant (liveOutput not sent). So keep as-is.

  const prunedTokens = estimateFullMessageTokensForIntra(pruned)
  const reclaimedTokens = Math.max(0, originalTokens - prunedTokens)

  // If reclaim < 5% skip to avoid churn
  if (reclaimedTokens > 0 && reclaimedTokens / Math.max(1, originalTokens) < 0.05)
    return null

  return {
    pruned,
    reclaimedTokens,
    originalTokens,
    prunedTokens,
    keptIds,
    prunedIds,
    strategy: 'l1',
  }
}

function sanitizeParts(
  parts: Message['parts'],
  keepChars: number,
): Message['parts'] {
  if (!parts || parts.length === 0)
    return parts

  const reasoningIndices: number[] = []
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.type === 'reasoning')
      reasoningIndices.push(i)
  }

  if (reasoningIndices.length === 0)
    return parts ? [...parts] : parts

  // Keep last reasoning block tail-truncated, collapse older
  const lastIdx = reasoningIndices[reasoningIndices.length - 1]!
  const newParts = [...parts]

  for (const idx of reasoningIndices) {
    const p = newParts[idx]!
    if (p.type !== 'reasoning')
      continue
    if (idx === lastIdx) {
      // keep tail of last reasoning
      if (p.text.length > keepChars) {
        const tail = p.text.slice(-keepChars)
        newParts[idx] = {
          type: 'reasoning',
          text: `[Earlier thinking trimmed; showing last ${keepChars} chars]\n${tail}`,
        }
      }
    }
    else {
      // collapse older reasoning to one line
      const preview = p.text.trim().slice(0, INTRA_REASONING_COLLAPSED_LINE)
      const totalLen = p.text.length
      newParts[idx] = {
        type: 'reasoning',
        text: `↳ Thinking: ${preview}${totalLen > INTRA_REASONING_COLLAPSED_LINE ? '…' : ''} (${totalLen} chars compressed)`,
      }
    }
  }

  return newParts
}

function estimateFullMessageTokensForIntra(message: Message): number {
  let tokens = estimateTokens(message.content || '')
  if (message.mentionContext)
    tokens += estimateTokens(message.mentionContext)
  if (message.attachments?.length)
    tokens += message.attachments.length * 100
  if (message.toolEvents?.length) {
    for (const te of message.toolEvents) {
      if (te.result)
        tokens += estimateTokens(typeof te.result === 'string' ? te.result : JSON.stringify(te.result))
      // include label overhead
      if (te.label)
        tokens += estimateTokens(te.label)
    }
  }
  if (message.parts?.length) {
    for (const p of message.parts) {
      if (p.type === 'reasoning')
        tokens += estimateTokens(p.text)
    }
  }
  return tokens
}

export function estimateIntraMessageTokens(message: Message): number {
  return estimateFullMessageTokensForIntra(message)
}

/** Decide if live message is heavy enough to warrant intra compaction even when history empty. */
export function isLiveHeavy(message: Message, effectiveLimit: number | null | undefined, fraction = 0.30): boolean {
  if (!message.toolEvents?.length && !message.parts?.some(p => p.type === 'reasoning'))
    return false
  const liveTokens = estimateFullMessageTokensForIntra(message)
  const limit = effectiveLimit ?? 200000 // fallback
  return liveTokens > limit * fraction
}

// ── ModelMessage-level sanitization (mid-stream prepareStep) ───────────────

function stringifyModelOutput(output: unknown): string {
  if (output == null)
    return ''
  if (typeof output === 'string')
    return output
  try { return JSON.stringify(output) }
  catch { return String(output) }
}

function estimateToolResultTokens(text: string): number {
  return estimateTokens(text)
}

/**
 * Sanitize outbound ModelMessage[] for next API call.
 * Keeps last K tool-result pairs intact, older pruned to stubs.
 * Pure - does not mutate input.
 */
export function sanitizeModelMessages(
  messages: ModelMessage[],
  opts?: { keepPairs?: number },
): { sanitized: ModelMessage[]; reclaimedTokens: number; didCompact: boolean } {
  const keepPairs = opts?.keepPairs ?? INTRA_KEEP_LAST

  // Gather indices of tool messages
  const toolIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === 'tool')
      toolIndices.push(i)
  }
  if (toolIndices.length === 0)
    return { sanitized: messages, reclaimedTokens: 0, didCompact: false }

  // Count total tool-result entries across all tool messages
  let totalResults = 0
  for (const idx of toolIndices) {
    const m = messages[idx]! as Extract<ModelMessage, { role: 'tool' }>
    const content = m.content as unknown[]
    totalResults += Array.isArray(content) ? content.length : 0
  }
  if (totalResults <= keepPairs)
    return { sanitized: messages, reclaimedTokens: 0, didCompact: false }

  const keepFromGlobal = Math.max(0, totalResults - keepPairs)
  let globalCounter = 0
  let reclaimed = 0
  let didCompact = false

  const sanitized = messages.map(msg => {
    if (msg.role !== 'tool')
      return msg

    // eslint-disable-next-line ts/no-explicit-any
    const toolMsg = msg as any
    const content = toolMsg.content as Array<{ toolCallId: string; toolName: string; output: unknown }>
    if (!Array.isArray(content) || content.length === 0)
      return msg

    const newContent = content.map(part => {
      const shouldKeep = globalCounter >= keepFromGlobal
      globalCounter++
      if (shouldKeep)
        return part

      // prune older
      const raw = stringifyModelOutput((part as { output?: unknown }).output)
      if (raw.startsWith('[Pruned') || raw.startsWith('[Compacted') || raw.includes('__compacted')) {
        // already pruned
        return part
      }
      const origTokens = raw ? estimateToolResultTokens(raw) : 0
      const prunedText = isAdaptiveKeepTail(part.toolName)
        ? truncateTail(raw, INTRA_TAIL_CHARS)
        : `[Pruned to reclaim ~${origTokens} tokens — tools succeeded. Re-run if needed.]`
      const prunedTokens = estimateToolResultTokens(prunedText)
      reclaimed += Math.max(0, origTokens - prunedTokens)
      didCompact = true
      // wrap as text output as expected by AI SDK — do NOT add extra top-level fields
      // (previous __compacted flag leaked into the wire payload as unknown property and
      // caused provider validation 500s for strict schemas)
      return {
        ...part,
        output: { type: 'text', value: prunedText } as unknown,
      }
    })

    return { ...toolMsg, content: newContent }
  }) as ModelMessage[]

  return { sanitized, reclaimedTokens: reclaimed, didCompact }
}

/**
 * Estimate total tokens for ModelMessage[] using same estimator as chatEstimate countSerializedPayloadTokens.
 * Lightweight fallback for mid-stream trigger.
 */
export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  let tokens = 0
  for (const m of messages) {
    const content = (m as unknown as { content?: unknown }).content
    if (typeof content === 'string') {
      tokens += estimateTokens(content)
    }
    else if (Array.isArray(content)) {
      for (const part of content as unknown[]) {
        if (typeof part === 'object' && part !== null && 'text' in (part as Record<string, unknown>)) {
          tokens += estimateTokens(String((part as Record<string, unknown>).text ?? ''))
        }
        else if (typeof part === 'object' && part !== null && 'output' in (part as Record<string, unknown>)) {
          const out = (part as Record<string, unknown>).output
          tokens += estimateTokens(stringifyModelOutput(out))
        }
        else {
          tokens += estimateTokens(JSON.stringify(part))
        }
      }
    }
    else if (content != null) {
      tokens += estimateTokens(String(content))
    }
    tokens += 4 // per-message overhead
  }
  return tokens
}
