import type { ChatTab, Message, ToolEvent } from './types'
import type { AgentConfig, CompatibleProvider } from '@/stores/settings/types'
import type { LanguageModel } from '@/utils/ai'
import { generateText } from 'ai'
import { dbInsertMessage } from '@/db/database'
import { buildLanguageModel, buildProviderOptions } from '@/utils/ai'
import { BG_TASK_COMPLETED_DIVIDER, SESSION_COMPACTED_DIVIDER, SESSION_COMPACTING_DIVIDER } from './constants'
import { makeId } from './utils'

const DEFAULT_RECENT_MESSAGES_TO_KEEP = 8
const MAX_MESSAGE_TEXT_CHARS = 2800
const MAX_TOOL_RESULT_CHARS = 800
const MAX_CHUNK_CHARS = 16_000
const MAX_SUMMARY_OUTPUT_TOKENS = 1600

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

interface SettingsSnapshot {
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

function logCompaction(stage: string, details?: Record<string, unknown>): void {
  if (details)
    console.warn(`[compaction] ${stage}`, details)
  else
    console.warn(`[compaction] ${stage}`)
}

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

  const raw = typeof result === 'string'
    ? result
    : JSON.stringify(result, null, 2)

  return truncateText(raw, MAX_TOOL_RESULT_CHARS)
}

function renderToolEvent(event: ToolEvent): string {
  const lines = [
    `Tool: ${event.toolName}`,
    `Label: ${event.label}`,
    `Status: ${event.status}`,
  ]

  const resultPreview = previewToolResult(event.result)
  if (resultPreview)
    lines.push(`Result preview:\n${resultPreview}`)

  return lines.join('\n')
}

function renderMessageForCompaction(message: Message): string {
  const blocks: string[] = []
  const prefix = message.role === 'user' ? 'User' : 'Assistant'

  const content = message.content.trim()
  if (content && content !== SESSION_COMPACTED_DIVIDER && content !== SESSION_COMPACTING_DIVIDER && content !== BG_TASK_COMPLETED_DIVIDER) {
    blocks.push(`${prefix}:\n${truncateText(message.content, MAX_MESSAGE_TEXT_CHARS)}`)
  }

  if (message.mentionContext?.trim()) {
    blocks.push(`Mention context:\n${truncateText(message.mentionContext, 1200)}`)
  }

  if (message.attachments?.length) {
    blocks.push(`Attachments: ${message.attachments.map(item => item.name).join(', ')}`)
  }

  if (message.toolEvents?.length) {
    const renderedEvents = message.toolEvents
      .map(renderToolEvent)
      .join('\n\n')
    if (renderedEvents.trim())
      blocks.push(renderedEvents)
  }

  return blocks.join('\n\n').trim()
}

function splitTranscriptChunks(messages: Message[]): string[] {
  const chunks: string[] = []
  let current = ''

  for (const message of messages) {
    const rendered = renderMessageForCompaction(message)
    if (!rendered)
      continue

    const nextBlock = current ? `${current}\n\n---\n\n${rendered}` : rendered
    if (nextBlock.length <= MAX_CHUNK_CHARS) {
      current = nextBlock
      continue
    }

    if (current)
      chunks.push(current)

    current = rendered.length <= MAX_CHUNK_CHARS
      ? rendered
      : truncateText(rendered, MAX_CHUNK_CHARS)
  }

  if (current)
    chunks.push(current)

  return chunks
}

function resolveActiveModel(
  tab: ChatTab,
  settings: SettingsSnapshot,
): ActiveModelSnapshot | null {
  const resolvedUid = tab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid
  return settings.enabledModels.find(model => model.uid === resolvedUid) ?? settings.activeModel
}

function buildCompactionModel(
  activeModel: ActiveModelSnapshot,
  settings: SettingsSnapshot,
): LanguageModel {
  if (activeModel.providerId === 'openai') {
    return buildLanguageModel({
      type: 'openai',
      apiKey: settings.openai.apiKey,
      baseURL: settings.openai.baseURL,
      organizationId: settings.openai.organizationId,
    }, activeModel.id)
  }

  if (activeModel.providerId === 'anthropic') {
    return buildLanguageModel({
      type: 'anthropic',
      apiKey: settings.anthropic.apiKey,
      baseURL: settings.anthropic.baseURL,
    }, activeModel.id)
  }

  if (activeModel.providerId === 'google') {
    return buildLanguageModel({
      type: 'google',
      apiKey: settings.google.apiKey,
    }, activeModel.id)
  }

  const compatible = settings.compatibleProviders.find(provider => provider.id === activeModel.providerId)
  if (!compatible)
    throw new Error(`Provider "${activeModel.providerId}" not found`)

  return buildLanguageModel({
    type: activeModel.sdkType ?? 'compatible',
    apiKey: compatible.apiKey,
    baseURL: compatible.baseURL,
    name: compatible.name,
    headers: compatible.headers,
  }, activeModel.id)
}

async function summarizeChunk(options: {
  model: LanguageModel
  providerOptions?: Record<string, Record<string, ProviderJsonValue>>
  request: string
}): Promise<string> {
  const result = await generateText({
    model: options.model,
    system: `You are compressing earlier turns from a coding-agent session into durable working context.

Produce a compact, loss-aware summary for later continuation.
- Keep only facts needed to continue the task correctly.
- Preserve repository facts, files read or changed, commands run, outputs that mattered, bugs found, decisions made, and unresolved risks.
- Drop filler, repetition, and transient narration.
- Do not invent work that did not happen.
- Use concise markdown bullets under short headings.
- Never include code fences unless absolutely necessary.`,
    prompt: options.request,
    maxOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
  })

  return result.text.trim()
}

async function buildSessionSummary(
  messagesToCompact: Message[],
  tab: ChatTab,
  settings: SettingsSnapshot,
): Promise<CompactionSummaryResult> {
  const activeModel = resolveActiveModel(tab, settings)
  if (!activeModel)
    throw new Error('No active model selected for session compaction')

  const model = buildCompactionModel(activeModel, settings)
  const providerOptions = buildProviderOptions({
    providerId: activeModel.providerId,
    modelId: activeModel.id,
    supportsThinking: activeModel.supportsThinking,
    thinkingEffort: activeModel.thinkingEffort,
  }) as Record<string, Record<string, ProviderJsonValue>> | undefined

  const chunks = splitTranscriptChunks(messagesToCompact)
  if (chunks.length === 0)
    throw new Error('There is not enough earlier session content to compact')

  logCompaction('Prepared compaction chunks', {
    tabId: tab.id,
    messageCount: messagesToCompact.length,
    chunkCount: chunks.length,
    chunkSizes: chunks.map(chunk => chunk.length),
  })

  const chunkSummaries: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const summary = await summarizeChunk({
      model,
      ...(providerOptions ? { providerOptions } : {}),
      request: `Chunk ${i + 1} of ${chunks.length} from the earlier session:\n\n${chunks[i]!}`,
    })
    if (summary) {
      chunkSummaries.push(summary)
      logCompaction('Summarized chunk', {
        tabId: tab.id,
        chunkIndex: i + 1,
        chunkCount: chunks.length,
        inputChars: chunks[i]!.length,
        summaryChars: summary.length,
      })
    }
  }

  const merged = chunkSummaries.length === 1
    ? chunkSummaries[0]!
    : await summarizeChunk({
        model,
        ...(providerOptions ? { providerOptions } : {}),
        request: `Merge these partial summaries into one authoritative continuation summary.\n\n${chunkSummaries.map((summary, index) => `## Partial ${index + 1}\n${summary}`).join('\n\n')}`,
      })

  logCompaction('Merged compaction summary', {
    tabId: tab.id,
    partialCount: chunkSummaries.length,
    mergedChars: merged.length,
  })

  return {
    summary: merged,
    compactedCount: messagesToCompact.length,
  }
}

export function shouldCompactSession(tab: ChatTab, thresholdPercent: number): boolean {
  if (tab.isCompacting)
    return false
  const ratio = tab.estimator.estimate?.contextUsageRatio
  if (ratio == null)
    return false
  return ratio * 100 >= clampPercent(thresholdPercent)
}

function isCompactionDivider(message: Message): boolean {
  const content = message.content.trim()
  return message.role === 'assistant'
    && (content === SESSION_COMPACTED_DIVIDER || content === SESSION_COMPACTING_DIVIDER || content === BG_TASK_COMPLETED_DIVIDER)
}

function findLiveAssistantIndex(tab: ChatTab): number {
  if (tab.agentStatus.type === 'idle' || tab.agentStatus.type === 'error')
    return -1

  for (let i = tab.messages.length - 1; i >= 0; i--) {
    const message = tab.messages[i]!
    if (message.role === 'assistant' && !isCompactionDivider(message))
      return i
  }

  return -1
}

function selectMessagesForCompaction(tab: ChatTab): {
  messagesToCompact: Message[]
  recentMessages: Message[]
  staleDividerIds: string[]
} {
  const staleDividerIds = tab.messages
    .filter(message => message.content.trim() === SESSION_COMPACTED_DIVIDER)
    .map(message => message.id)

  const liveAssistantIndex = findLiveAssistantIndex(tab)
  if (liveAssistantIndex > 0) {
    return {
      messagesToCompact: tab.messages
        .slice(0, liveAssistantIndex)
        .filter(message => !isCompactionDivider(message)),
      recentMessages: tab.messages
        .slice(liveAssistantIndex)
        .filter(message => !isCompactionDivider(message)),
      staleDividerIds,
    }
  }

  const realMessageIndexes = tab.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => !isCompactionDivider(message))
    .map(({ index }) => index)

  const keepRecent = realMessageIndexes.length <= DEFAULT_RECENT_MESSAGES_TO_KEEP
    ? 0
    : DEFAULT_RECENT_MESSAGES_TO_KEEP
  const splitIndex = keepRecent === 0
    ? tab.messages.length
    : realMessageIndexes[Math.max(0, realMessageIndexes.length - keepRecent)] ?? tab.messages.length

  return {
    messagesToCompact: tab.messages
      .slice(0, splitIndex)
      .filter(message => !isCompactionDivider(message)),
    recentMessages: tab.messages
      .slice(splitIndex)
      .filter(message => !isCompactionDivider(message)),
    staleDividerIds,
  }
}

export async function compactConversationSession(options: {
  tab: ChatTab
  settings: SettingsSnapshot
  source: 'auto' | 'manual'
  onPersist: (payload: {
    deletedMessageIds: string[]
    insertedMessages: Message[]
  }) => Promise<void>
}): Promise<CompactionSummaryResult> {
  const { messagesToCompact, recentMessages, staleDividerIds } = selectMessagesForCompaction(options.tab)

  if (messagesToCompact.length === 0)
    throw new Error('Not enough conversation history to compact')

  logCompaction('Starting session compaction', {
    tabId: options.tab.id,
    source: options.source,
    totalMessages: options.tab.messages.length,
    compactedMessages: messagesToCompact.length,
    keptMessages: recentMessages.length,
    contextUsageRatio: options.tab.estimator.estimate?.contextUsageRatio ?? null,
  })

  const summaryResult = await buildSessionSummary(messagesToCompact, options.tab, options.settings)
  const firstTimestamp = messagesToCompact[0]?.timestamp.getTime() ?? Date.now()
  const summaryHeader = [
    '## Compacted Session Summary',
    `Compacted ${options.source === 'auto' ? 'automatically' : 'manually'} to reclaim context budget.`,
  ].join('\n\n')

  const summaryMessage: Message = {
    id: makeId(),
    role: 'assistant',
    content: `${summaryHeader}\n\n${summaryResult.summary}`.trim(),
    timestamp: new Date(firstTimestamp),
  }

  const dividerMessage: Message = {
    id: makeId(),
    role: 'assistant',
    content: SESSION_COMPACTED_DIVIDER,
    timestamp: new Date(firstTimestamp + 1),
  }

  await options.onPersist({
    deletedMessageIds: [...new Set([...messagesToCompact.map(message => message.id), ...staleDividerIds])],
    insertedMessages: [summaryMessage, dividerMessage],
  })

  logCompaction('Persisted compaction messages', {
    tabId: options.tab.id,
    source: options.source,
    deletedMessageCount: messagesToCompact.length,
    insertedMessageCount: 2,
    summaryChars: summaryMessage.content.length,
  })

  options.tab.messages = [summaryMessage, dividerMessage, ...recentMessages]

  logCompaction('Applied compacted session state', {
    tabId: options.tab.id,
    source: options.source,
    nextMessageCount: options.tab.messages.length,
    dividerInserted: true,
  })

  return summaryResult
}

export async function persistCompactionMessages(payload: {
  conversationId: string
  insertedMessages: Message[]
}): Promise<void> {
  for (const message of payload.insertedMessages) {
    await dbInsertMessage({
      id: message.id,
      conversation_id: payload.conversationId,
      role: message.role,
      content: message.content,
      created_at: message.timestamp.getTime(),
    })
  }
}
