import type { ChatTab, Message, ToolEvent } from './types'
import type { AgentConfig, CompatibleProvider } from '@/stores/settings/types'
import type { LanguageModel } from '@/utils/ai'
import { generateText } from 'ai'
import { countTokens as countTextTokens } from 'gpt-tokenizer'
import { dbInsertMessage } from '@/db/database'
import { buildLanguageModel, buildProviderOptions } from '@/utils/ai'
import { BG_TASK_COMPLETED_DIVIDER, SESSION_COMPACTED_DIVIDER, SESSION_COMPACTING_DIVIDER } from './constants'
import { makeId } from './utils'

const MAX_MESSAGE_TEXT_CHARS = 2800
const MAX_TOOL_RESULT_CHARS = 100
const MAX_SUMMARY_OUTPUT_TOKENS = 1600
const HEAD_PROTECT_COUNT = 3

interface ProviderSnapshot {
  id: string
  apiKey: string
  baseURL: string
  name: string
  headers?: Record<string, string>
}

interface ActiveModelSnapshot {
  id: string
  providerId: string
  supportsThinking: boolean
  thinkingEffort: 'low' | 'medium' | 'high'
  sdkType?: 'openai' | 'anthropic' | 'google' | null
}

export interface SettingsSnapshot {
  activeModel: ActiveModelSnapshot | null
  activeModelUid: string | null
  enabledModels: Array<ActiveModelSnapshot & { uid: string }>
  openai: { apiKey: string; baseURL: string; organizationId: string }
  anthropic: { apiKey: string; baseURL: string }
  google: { apiKey: string }
  compatibleProviders: CompatibleProvider[] | ProviderSnapshot[]
  agent: AgentConfig
}

interface CompactionSummaryResult {
  summary: string
  compactedCount: number
}

type ProviderJsonValue = string
  | number
  | boolean
  | null
  | ProviderJsonValue[]
  | { [key: string]: ProviderJsonValue | undefined }

function clampPercent(value: number): number {
  return Math.min(95, Math.max(50, Math.round(value)))
}

function truncateText(value: string, maxChars: number): string {
  const compact = value.replace(/\r\n?/g, '\n').trim()
  if (compact.length <= maxChars)
    return compact
  const head = Math.floor(maxChars * 0.72)
  const tail = maxChars - head
  return `${compact.slice(0, head).trimEnd()}\n\n[... trimmed ...]\n\n${compact.slice(-tail).trimStart()}`
}

function previewToolResult(result: unknown): string {
  if (result == null)
    return ''
  const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  return truncateText(raw, MAX_TOOL_RESULT_CHARS) // Aggressive pruning for Phase 1
}

function renderToolEvent(event: ToolEvent): string {
  const lines = [`Tool: ${event.toolName}`, `Label: ${event.label}`, `Status: ${event.status}`]
  const resultPreview = previewToolResult(event.result)
  if (resultPreview)
    lines.push(`Result preview:\n${resultPreview}`)
  return lines.join('\n')
}

// Phase 1: Cheap Pre-pass
function prePassMessages(messages: Message[]): Message[] {
  return messages
    .filter(m => {
      // Strip blank platform-echo user rows
      if (m.role === 'user' && !m.content.trim() && !m.attachments?.length && !m.parts?.length) {
        return false
      }
      return true
    })
    .map(m => {
      // Deep copy to avoid mutating state before assembly
      const copy: Message = { ...m }
      if (m.attachments)
        copy.attachments = [...m.attachments]
      if (m.toolEvents)
        copy.toolEvents = [...m.toolEvents]

      // Strip historical media
      if (copy.attachments) {
        copy.attachments = copy.attachments.map(att => {
          if (att.mimeType?.startsWith('image/') && att.dataUrl?.startsWith('data:')) {
            return { ...att, dataUrl: '', name: `[Image stripped during compaction: ${att.name}]` }
          }
          return att
        })
      }

      // Prune old tool results
      if (copy.toolEvents) {
        copy.toolEvents = copy.toolEvents.map(te => {
          return { ...te, result: previewToolResult(te.result) }
        })
      }
      return copy
    })
}

function renderMessageForCompaction(message: Message): string {
  const blocks: string[] = []
  const prefix = message.role === 'user' ? 'User' : 'Assistant'
  const content = message.content.trim()

  if (content && content !== SESSION_COMPACTED_DIVIDER && content !== SESSION_COMPACTING_DIVIDER && content !== BG_TASK_COMPLETED_DIVIDER) {
    blocks.push(`${prefix}:\n${truncateText(message.content, MAX_MESSAGE_TEXT_CHARS)}`)
  }
  if (message.mentionContext?.trim())
    blocks.push(`Mention context:\n${truncateText(message.mentionContext, 1200)}`)
  if (message.attachments?.length)
    blocks.push(`Attachments: ${message.attachments.map(item => item.name).join(', ')}`)
  if (message.toolEvents?.length) {
    const renderedEvents = message.toolEvents.map(renderToolEvent).join('\n\n')
    if (renderedEvents.trim())
      blocks.push(renderedEvents)
  }
  return blocks.join('\n\n').trim()
}

function estimateTokens(text: string): number {
  try {
    return countTextTokens(text)
  }
  catch {
    return text.length / 4 // Fallback
  }
}

// Phase 2: Determine Boundaries
function calculateCompactionBoundaries(messages: Message[], budgetTokens: number): { head: Message[]; toCompact: Message[]; tail: Message[] } {
  const realMessages = messages.filter(m => m.content !== SESSION_COMPACTED_DIVIDER && m.content !== SESSION_COMPACTING_DIVIDER && m.content !== BG_TASK_COMPLETED_DIVIDER)

  // Head protection
  const systemMessages = realMessages.filter(m => (m.role as string) === 'system')
  const nonSystem = realMessages.filter(m => (m.role as string) !== 'system')

  const hasPreviouslyCompacted = messages.some(m => m.content.includes('## Compacted Session Summary'))
  const protectCount = hasPreviouslyCompacted ? 1 : HEAD_PROTECT_COUNT

  const headProtected = [...systemMessages, ...nonSystem.slice(0, protectCount)]
  const remaining = nonSystem.slice(protectCount)

  // Tail protection
  const tailProtected: Message[] = []
  let currentTokens = 0
  let i = remaining.length - 1

  while (i >= 0) {
    const msgTokens = estimateTokens(renderMessageForCompaction(remaining[i]!))
    if (currentTokens + msgTokens > budgetTokens) {
      break
    }
    currentTokens += msgTokens
    tailProtected.unshift(remaining[i]!)
    i--
  }

  const toCompact = remaining.slice(0, i + 1)

  // Alignment: ensures boundaries don't split tool_call/tool_result groups
  while (toCompact.length > 0 && toCompact[toCompact.length - 1]!.role === 'user') {
    tailProtected.unshift(toCompact.pop()!)
  }

  return { head: headProtected, toCompact, tail: tailProtected }
}

function resolveActiveModel(tab: ChatTab, settings: SettingsSnapshot): ActiveModelSnapshot | null {
  const resolvedUid = tab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid
  return settings.enabledModels.find(model => model.uid === resolvedUid) ?? settings.activeModel
}

function buildCompactionModel(activeModel: ActiveModelSnapshot, settings: SettingsSnapshot): LanguageModel {
  if (activeModel.providerId === 'openai') {
    return buildLanguageModel({ type: 'openai', apiKey: settings.openai.apiKey, baseURL: settings.openai.baseURL, organizationId: settings.openai.organizationId }, activeModel.id)
  }
  if (activeModel.providerId === 'anthropic') {
    return buildLanguageModel({ type: 'anthropic', apiKey: settings.anthropic.apiKey, baseURL: settings.anthropic.baseURL }, activeModel.id)
  }
  if (activeModel.providerId === 'google') {
    return buildLanguageModel({ type: 'google', apiKey: settings.google.apiKey }, activeModel.id)
  }
  const compatible = settings.compatibleProviders.find(provider => provider.id === activeModel.providerId)
  if (!compatible)
    throw new Error(`Provider "${activeModel.providerId}" not found`)
  return buildLanguageModel({ type: activeModel.sdkType ?? 'compatible', apiKey: compatible.apiKey, baseURL: compatible.baseURL, name: compatible.name, headers: compatible.headers }, activeModel.id)
}

// Phase 3: Summary Generation
async function summarizeChunk(options: { model: LanguageModel; providerOptions?: Record<string, Record<string, ProviderJsonValue>>; request: string; previousSummary?: string; focusTopic?: string }): Promise<string> {
  let prompt = options.request
  if (options.previousSummary) {
    prompt = `Update this previous summary with the new chunk information:\n\n${options.previousSummary}\n\nNew chunk:\n${prompt}`
  }
  if (options.focusTopic) {
    prompt = `IMPORTANT: Focus especially on preserving information related to: ${options.focusTopic}\n\n${prompt}`
  }

  const result = await generateText({
    model: options.model,
    system: `You are compressing earlier turns from a coding-agent session into durable working context.
Produce a compact, loss-aware summary for later continuation.
Use this exact template:
## Active Task
[User's most recent unfulfilled request verbatim]
## Goal
[What the user was trying to accomplish]
## Progress
[What has been completed]
## Decisions
[Key decisions made]
## Resolved / Pending Questions
[List questions]
## Files
[Files referenced or modified]
## Remaining Work
[What is left to do]

Keep only facts needed to continue the task correctly. Preserve repository facts, files read or changed.`,
    prompt,
    maxOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
  })

  let text = result.text.trim()
  if (options.request.includes('[SKILL_PRUNED:')) {
    text += '\n\n[SKILL_PRUNED: Retained historical ghost-skill markers]'
  }

  return text
}

async function buildSessionSummary(messagesToCompact: Message[], tab: ChatTab, settings: SettingsSnapshot, previousSummary?: string, focusTopic?: string): Promise<CompactionSummaryResult> {
  const activeModel = resolveActiveModel(tab, settings)
  if (!activeModel)
    throw new Error('No active model selected for session compaction')
  const model = buildCompactionModel(activeModel, settings)
  const providerOptions = buildProviderOptions({ providerId: activeModel.providerId, modelId: activeModel.id, supportsThinking: activeModel.supportsThinking, thinkingEffort: activeModel.thinkingEffort }) as Record<string, Record<string, ProviderJsonValue>> | undefined

  const chunks = messagesToCompact.map(renderMessageForCompaction).filter(Boolean)
  const fullText = chunks.join('\n\n---\n\n')

  const merged = await summarizeChunk({
    model,
    ...(providerOptions ? { providerOptions } : {}),
    request: `Session to compact:\n\n${fullText}`,
    ...(previousSummary ? { previousSummary } : {}),
    ...(focusTopic ? { focusTopic } : {}),
  })

  return { summary: merged, compactedCount: messagesToCompact.length }
}

export function shouldCompactSession(tab: ChatTab, thresholdPercent: number): boolean {
  if (tab.isCompacting)
    return false
  const ratio = tab.estimator.estimate?.contextUsageRatio
  if (ratio == null)
    return false
  return ratio * 100 >= clampPercent(thresholdPercent)
}

function extractPreviousSummary(messages: Message[]): string | undefined {
  const summaryMsg = messages.find(m => m.content.includes('## Compacted Session Summary'))
  return summaryMsg ? summaryMsg.content : undefined
}

export async function compactConversationSession(options: {
  tab: ChatTab
  settings: SettingsSnapshot
  source: 'auto' | 'manual'
  focusTopic?: string
  onPersist: (payload: { deletedMessageIds: string[]; insertedMessages: Message[] }) => Promise<void>
}): Promise<CompactionSummaryResult> {
  const budgetTokens = (options.tab.estimator.estimate?.contextLimit ?? 20000) * 0.2
  const { head, toCompact, tail } = calculateCompactionBoundaries(options.tab.messages, budgetTokens)

  if (toCompact.length === 0)
    throw new Error('Not enough conversation history to compact')

  const previousSummary = extractPreviousSummary(head)
  const prePassed = prePassMessages(toCompact)

  const summaryResult = await buildSessionSummary(prePassed, options.tab, options.settings, previousSummary, options.focusTopic)

  const firstTimestamp = toCompact[0]?.timestamp.getTime() ?? Date.now()
  const summaryHeader = ['## Compacted Session Summary', `Compacted ${options.source === 'auto' ? 'automatically' : 'manually'} to reclaim context budget. Date: ${new Date().toISOString()}`].join('\n\n')

  const summaryMessage: Message = {
    id: makeId(),
    role: 'assistant',
    content: `${summaryHeader}\n\n${summaryResult.summary}\n---\n[CONTEXT COMPACTION — REFERENCE ONLY] End of compaction summary...`.trim(),
    timestamp: new Date(firstTimestamp),
  }

  const tailCleaned = tail.map(m => {
    if (m.parts) {
      return { ...m, parts: m.parts.filter(p => p.type !== 'tool' || ('toolCallId' in p && p.toolCallId)) }
    }
    return m
  })

  const headCleaned = head.map(m => {
    const copy = { ...m }
    delete copy.cacheStats
    return copy
  })

  const newMessages = [...headCleaned, summaryMessage, ...tailCleaned]

  const origTokens = options.tab.messages.reduce((acc, m) => acc + estimateTokens(m.content), 0)
  const newTokens = newMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0)
  const savingsPct = origTokens > 0 ? ((origTokens - newTokens) / origTokens) * 100 : 0

  if (!options.tab.compactionStats)
    options.tab.compactionStats = { lastSavingsPct: 0, lastCompactedAt: 0 }
  options.tab.compactionStats.lastSavingsPct = savingsPct
  options.tab.compactionStats.lastCompactedAt = Date.now()

  const staleDividerIds = options.tab.messages.filter(m => m.content === SESSION_COMPACTED_DIVIDER).map(m => m.id)

  await options.onPersist({
    deletedMessageIds: [...new Set([...toCompact.map(message => message.id), ...staleDividerIds])],
    insertedMessages: [summaryMessage],
  })

  options.tab.messages = newMessages

  return summaryResult
}

export async function persistCompactionMessages(payload: { conversationId: string; insertedMessages: Message[] }): Promise<void> {
  for (const message of payload.insertedMessages) {
    await dbInsertMessage({ id: message.id, conversation_id: payload.conversationId, role: message.role, content: message.content, created_at: message.timestamp.getTime() })
  }
}
