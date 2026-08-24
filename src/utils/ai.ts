import type {
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  SystemModelMessage,
  ToolSet,
} from 'ai'
import type { OsInfo } from '@/utils/os'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, isLoopFinished, RetryError, streamText } from 'ai'
import { buildPrompt, buildPromptWithBase } from '@/prompts/build'
import { buildDesignPrompt } from '@/prompts/design'
import { planPrompt, planPromptWithBase } from '@/prompts/plan'
import { platformFetch } from '@/utils/platformFetch'
import { repairJson } from '@/utils/repairJson'

export type { LanguageModel, ToolSet }
export type ChatMode = 'build' | 'plan' | 'chat' | 'design'
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// ── Provider credentials ──────────────────────────────────────────────────────

export interface ProviderCredentials {
  type: 'openai' | 'anthropic' | 'google' | 'compatible'
  apiKey?: string | undefined
  baseURL?: string | undefined
  organizationId?: string | undefined
  name?: string | undefined
  headers?: Record<string, string> | undefined
}

// ── Model factory ─────────────────────────────────────────────────────────────

export function buildLanguageModel(credentials: ProviderCredentials, modelId: string): LanguageModel {
  if (!modelId?.trim())
    throw new Error('buildLanguageModel: modelId is required')

  switch (credentials.type) {
    case 'openai': {
      if (!credentials.apiKey?.trim())
        throw new Error('OpenAI provider requires an API key')
      return createOpenAI({
        apiKey: credentials.apiKey,
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
        ...(credentials.organizationId ? { organization: credentials.organizationId } : {}),
        fetch: platformFetch,
      })(modelId)
    }

    case 'anthropic': {
      if (!credentials.apiKey?.trim())
        throw new Error('Anthropic provider requires an API key')
      return createAnthropic({
        apiKey: credentials.apiKey,
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
        fetch: platformFetch,
      })(modelId)
    }

    case 'google': {
      if (!credentials.apiKey?.trim())
        throw new Error('Google provider requires an API key')
      return createGoogleGenerativeAI({
        apiKey: credentials.apiKey,
        fetch: platformFetch,
      })(modelId)
    }

    case 'compatible': {
      if (!credentials.baseURL?.trim())
        throw new Error('Compatible provider requires a baseURL')
      return createOpenAICompatible({
        name: credentials.name ?? 'custom',
        apiKey: credentials.apiKey ?? '',
        baseURL: credentials.baseURL,
        includeUsage: true,
        fetch: platformFetch,
        ...(credentials.headers && Object.keys(credentials.headers).length > 0
          ? { headers: credentials.headers }
          : {}),
      })(modelId)
    }

    default: {
      const exhaustive: never = credentials.type
      throw new Error(`Unknown provider type: ${exhaustive}`)
    }
  }
}

// ── Thinking budget ───────────────────────────────────────────────────────────

export function thinkingBudgetTokens(effort: ThinkingEffort): number {
  switch (effort) {
    case 'off': return 0
    case 'low': return 2048
    case 'medium': return 16_000
    case 'high': return 32_000
    case 'xhigh': return 48_000
    case 'max': return 100_000
    default: return 16_000
  }
}

// ── Provider options ──────────────────────────────────────────────────────────

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue | undefined }

export interface ThinkingConfig {
  providerId: string
  modelId: string
  supportsThinking: boolean
  thinkingEffort: ThinkingEffort
}

export function buildProviderOptions(
  config: ThinkingConfig,
): Record<string, Record<string, JSONValue>> | undefined {
  if (!config.supportsThinking)
    return undefined
  if (config.thinkingEffort === 'off')
    return undefined

  const id = config.modelId.toLowerCase()

  // Anthropic: Claude 4.6+ adaptive, earlier budget-based, Opus 4.7+ needs display:summarized
  if (config.providerId === 'anthropic' && /claude-3-7|opus-4|sonnet-4|haiku-4/.test(id)) {
    const isAdaptive = /claude-(?:opus|sonnet)-4-(?:[6-9]|\d{2,})/.test(id)
    const needsDisplay = /claude-opus-4-(?:[7-9]|\d{2,})/.test(id)

    if (isAdaptive) {
      const effortMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max' }
      const anthropicOpts: Record<string, JSONValue> = {
        thinking: needsDisplay ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' },
        effort: effortMap[config.thinkingEffort] ?? config.thinkingEffort,
      }
      return { anthropic: anthropicOpts }
    }

    return { anthropic: { thinking: { type: 'enabled', budgetTokens: thinkingBudgetTokens(config.thinkingEffort) } } }
  }

  // Google: Gemini 3+ uses level-based, Gemini 2.5 uses budget-based
  if (config.providerId === 'google') {
    if (/gemini-3/.test(id)) {
      const levelMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' }
      return {
        google: {
          thinkingConfig: {
            thinkingLevel: levelMap[config.thinkingEffort] ?? 'medium',
            includeThoughts: true,
          },
        },
      }
    }
    const budgetMap: Record<ThinkingEffort, number> = { off: 0, low: 2048, medium: 8192, high: 32_768, xhigh: 48_000, max: 100_000 }
    return { google: { thinkingConfig: { thinkingBudget: budgetMap[config.thinkingEffort], includeThoughts: true } } }
  }

  // OpenAI: o-series and GPT-5 codex reasoning models - also support xhigh/max directly
  const isReasoningModel = /^o[1-9]/.test(id) || id.startsWith('o3') || id.startsWith('o4') || /gpt-5[\d.]*-codex/.test(id) || /thinking|reasoning/i.test(id)
  if (config.providerId === 'openai' && isReasoningModel) {
    return { openai: { reasoningEffort: config.thinkingEffort, reasoningSummary: 'auto' } }
  }
  // Fallback for any provider that supports thinking - pass through effort
  return { openai: { reasoningEffort: config.thinkingEffort } } as unknown as Record<string, Record<string, JSONValue>>
}

export function mergeProviderOptions(
  ...options: Array<Record<string, Record<string, JSONValue>> | undefined>
): Record<string, Record<string, JSONValue>> | undefined {
  const merged: Record<string, Record<string, JSONValue>> = {}
  for (const option of options) {
    if (!option)
      continue
    for (const [providerId, providerValues] of Object.entries(option))
      merged[providerId] = { ...(merged[providerId] ?? {}), ...providerValues }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

// ── Tool event types ──────────────────────────────────────────────────────────

export interface ToolCallEvent {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResultEvent {
  id: string
  name: string
  ok: boolean
  result?: Record<string, unknown>
}

// ── Stream options ────────────────────────────────────────────────────────────

export interface StreamChatOptions {
  model: LanguageModel
  messages: ModelMessage[]
  systemPrompt?: string | SystemModelMessage[]
  tools?: ToolSet | undefined
  supportsToolCalls: boolean
  providerOptions?: Record<string, Record<string, JSONValue>>
  prepareStep?: (event: {
    stepNumber: number
    messages: ModelMessage[]
  }) => PromiseLike<{ messages?: ModelMessage[] } | undefined> | { messages?: ModelMessage[] } | undefined
  onDelta: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
  onToolCall?: (event: ToolCallEvent) => void
  onToolResult?: (event: ToolResultEvent) => void
  onFinish?: (event: StreamChatFinishEvent) => void
  onError?: (error: Error) => void
  signal?: AbortSignal
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  stopSequences?: string[]
  debugRaw?: boolean
}

export interface StreamChatFinishEvent {
  fullText: string
  providerMetadata?: ProviderMetadata
  usage: LanguageModelUsage
}

// ── Tool failure guard ────────────────────────────────────────────────────────

class ToolFailureGuard {
  private counts = new Map<string, number>()

  constructor(private readonly threshold = 3) {}

  record(toolName: string): void {
    const next = (this.counts.get(toolName) ?? 0) + 1
    this.counts.set(toolName, next)
    if (next >= this.threshold) {
      throw new Error(
        `Repeated tool call failure detected for "${toolName}". Please provide further instructions.`,
      )
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function describeAPICallError(err: APICallError): string {
  const parts: string[] = []
  if (err.url)
    parts.push(`url=${err.url}`)
  if (err.statusCode != null)
    parts.push(`status=${err.statusCode}`)
  if (err.responseBody) {
    // Truncate very long bodies (e.g. HTML error pages)
    const body = String(err.responseBody).slice(0, 500)
    parts.push(`body=${body}`)
  }
  if (err.cause instanceof Error)
    parts.push(`cause=${err.cause.message}`)
  const detail = parts.length ? ` (${parts.join(', ')})` : ''
  return `${err.message}${detail}`
}

function extractErrorMessage(error: unknown): string {
  if (RetryError.isInstance(error)) {
    const allErrors = (error.errors ?? []).map((e: unknown) => {
      if (APICallError.isInstance(e))
        return describeAPICallError(e)
      if (e instanceof Error)
        return e.message
      return String(e)
    })
    const suffix = allErrors.length
      ? `\n  Attempts:\n${allErrors.map((m, i) => `    [${i + 1}] ${m}`).join('\n')}`
      : ''
    return `${error.message}${suffix}`
  }
  if (APICallError.isInstance(error))
    return describeAPICallError(error)
  if (error instanceof Error) {
    // Unwrap generic .cause chains
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error)
      return `${error.message} → ${extractErrorMessage(cause)}`
    return error.message
  }
  if (typeof error === 'string')
    return error
  try { return JSON.stringify(error) }
  catch { return 'An unknown error occurred' }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error)
    return error.name === 'AbortError' || error.message.includes('aborted')
  return false
}

// ── streamChat ────────────────────────────────────────────────────────────────

// AI SDK v6 field names (differ from older docs):
//   tool-call  → part.input   (not args)
//   tool-result → part.output  (not result/content)

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const {
    model,
    messages,
    systemPrompt,
    tools,
    supportsToolCalls,
    providerOptions,
    prepareStep,
    onDelta,
    onReasoningDelta,
    onToolCall,
    onToolResult,
    onFinish,
    onError,
    signal,
    maxOutputTokens = 16_384,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    seed,
    stopSequences,
    debugRaw = false,
  } = opts

  if (signal?.aborted)
    return
  if (!messages.length)
    throw new Error('streamChat: messages array is empty')

  const hasTools = supportsToolCalls && tools != null && Object.keys(tools).length > 0

  try {
    const result = streamText({
      model,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
      ...(hasTools
        ? {
            tools,
            stopWhen: isLoopFinished(),
            experimental_repairToolCall: async ({ toolCall }) => {
              const raw = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input)
              const repaired = repairJson(raw)
              if (repaired === null || repaired === raw)
                return null
              try {
                const parsed = JSON.parse(repaired)
                return { ...toolCall, input: parsed }
              }
              catch {
                return null
              }
            },
          }
        : {}),
      maxOutputTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(topK !== undefined ? { topK } : {}),
      ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
      ...(presencePenalty !== undefined ? { presencePenalty } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(stopSequences !== undefined ? { stopSequences } : {}),
      ...(prepareStep ? { prepareStep } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    })

    let fullText = ''
    const failureGuard = new ToolFailureGuard()

    for await (const part of result.fullStream) {
      if (signal?.aborted)
        return
      if (debugRaw)
        console.warn('[ai] stream part:', part)

      switch (part.type) {
        case 'text-delta':
          fullText += part.text
          onDelta(part.text)
          break

        case 'reasoning-delta':
          onReasoningDelta?.(part.text)
          break

        case 'reasoning-start':
        case 'reasoning-end':
          break

        case 'tool-call':
          onToolCall?.({ id: part.toolCallId, name: part.toolName, args: (part.input ?? {}) as Record<string, unknown> })
          break

        case 'tool-result':
          onToolResult?.({ id: part.toolCallId, name: part.toolName, ok: true, result: (part.output ?? {}) as Record<string, unknown> })
          break

        case 'tool-error': {
          const errorMessage = extractErrorMessage(part.error)
          onToolResult?.({ id: part.toolCallId, name: part.toolName, ok: false, result: { error: errorMessage } })
          failureGuard.record(part.toolName)
          break
        }

        case 'error':
          throw new Error(extractErrorMessage(part.error))
      }
    }

    const [usage, providerMetadata] = await Promise.all([result.usage, result.providerMetadata])
    // Await onFinish so callers' turn-finalization (e.g. design version snapshot)
    // completes before post-stream cleanup (e.g. discardPending) can run.
    await onFinish?.({ fullText, usage, ...(providerMetadata ? { providerMetadata } : {}) })
  }
  catch (error: unknown) {
    if (isAbortError(error)) {
      console.warn('[streamChat] aborted:', extractErrorMessage(error))
      return
    }
    // Preserve the original AI SDK error object (RetryError, APICallError, etc.)
    // so callers receive full context (status codes, response bodies, attempt list).
    const err = error instanceof Error ? error : new Error(extractErrorMessage(error))
    console.error('[streamChat] error:', extractErrorMessage(error))
    onError?.(err)
    throw err
  }
}

// ── System prompt builder ─────────────────────────────────────────────────────

export function buildSystemPrompt(
  projectPath: string | null,
  _mode: ChatMode = 'build',
  osInfo?: OsInfo,
  coAuthor?: boolean,
  promptOverrides?: Record<string, string>,
): string {
  if (_mode === 'design') {
    const override = promptOverrides?.['prompt-design']
    return override ?? buildDesignPrompt()
  }
  if (_mode === 'plan') {
    const planOverride = promptOverrides?.['prompt-plan']
    return planOverride
      ? planPromptWithBase(planOverride, projectPath, osInfo)
      : planPrompt(projectPath, osInfo)
  }
  const buildOverride = promptOverrides?.['prompt-build']
  if (buildOverride) {
    return buildPromptWithBase(buildOverride, projectPath, osInfo, coAuthor)
  }
  return buildPrompt(projectPath, osInfo, coAuthor)
}
