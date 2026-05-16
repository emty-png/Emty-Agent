/**
 * src/utils/ai.ts
 *
 * Central AI execution layer for Emty Agent.
 * Compatible with: ai ^6.x (AI SDK v5 published as v6 on npm)
 *
 * AI SDK v6 fullStream events:
 *   text-delta      → part.text
 *   tool-call       → part.input   (NOT args)
 *   tool-result     → part.output  (NOT result/content)
 *   error           → part.error
 *
 * Tool looping uses stopWhen: isLoopFinished() so the agent runs until the
 * model stops calling tools naturally — no arbitrary step cap.
 */

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
import { isLoopFinished, streamText } from 'ai'
import { buildPrompt } from '@/prompts/build'

import { platformFetch } from '@/utils/platformFetch'

export type { LanguageModel, ToolSet }
export type ChatMode = 'build' | 'plan'
export type ThinkingEffort = 'low' | 'medium' | 'high'

// ── provider credentials ──────────────────────────────────────────────────────

export interface ProviderCredentials {
  type: 'openai' | 'anthropic' | 'google' | 'compatible'
  apiKey?: string | undefined
  baseURL?: string | undefined
  organizationId?: string | undefined
  name?: string | undefined
}

// ── model factory ─────────────────────────────────────────────────────────────

/**
 * Instantiate a LanguageModel from provider credentials.
 * Throws a descriptive Error when required fields are missing.
 */
export function buildLanguageModel(
  credentials: ProviderCredentials,
  modelId: string,
): LanguageModel {
  if (!modelId?.trim())
    throw new Error('buildLanguageModel: modelId is required')

  switch (credentials.type) {
    case 'openai': {
      if (!credentials.apiKey?.trim())
        throw new Error('OpenAI provider requires an API key')
      const provider = createOpenAI({
        apiKey: credentials.apiKey,
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
        ...(credentials.organizationId ? { organization: credentials.organizationId } : {}),
        fetch: platformFetch,
      })
      return provider(modelId)
    }

    case 'anthropic': {
      if (!credentials.apiKey?.trim())
        throw new Error('Anthropic provider requires an API key')
      const provider = createAnthropic({
        apiKey: credentials.apiKey,
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
        fetch: platformFetch,
      })
      return provider(modelId)
    }

    case 'google': {
      if (!credentials.apiKey?.trim())
        throw new Error('Google provider requires an API key')
      const provider = createGoogleGenerativeAI({
        apiKey: credentials.apiKey,
        fetch: platformFetch,
      })
      return provider(modelId)
    }

    case 'compatible': {
      if (!credentials.baseURL?.trim())
        throw new Error('Compatible provider requires a baseURL')
      const provider = createOpenAICompatible({
        name: credentials.name ?? 'custom',
        apiKey: credentials.apiKey ?? '',
        baseURL: credentials.baseURL,
        includeUsage: true,
        fetch: platformFetch,
      })
      return provider(modelId)
    }

    default: {
      const exhaustive: never = credentials.type
      throw new Error(`Unknown provider type: ${exhaustive}`)
    }
  }
}

// ── thinking budget helper ────────────────────────────────────────────────────

export function thinkingBudgetTokens(effort: ThinkingEffort): number {
  switch (effort) {
    case 'low': return 2048
    case 'high': return 32_000
    default: return 16_000
  }
}

// ── provider options builder ──────────────────────────────────────────────────

type JSONValue = string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue | undefined }

export interface ThinkingConfig {
  providerId: string
  modelId: string
  supportsThinking: boolean
  thinkingEffort: ThinkingEffort
}

/**
 * Build provider-specific options for streamText based on thinking config.
 * Returns undefined when thinking is disabled so call sites can skip the key.
 */
export function buildProviderOptions(
  config: ThinkingConfig,
): Record<string, Record<string, JSONValue>> | undefined {
  if (!config.supportsThinking)
    return undefined

  const id = config.modelId.toLowerCase()

  // Anthropic extended thinking
  if (config.providerId === 'anthropic' && /claude-3-7|opus-4|sonnet-4|haiku-4/.test(id)) {
    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: thinkingBudgetTokens(config.thinkingEffort),
        },
      },
    }
  }

  // Google Gemini thought summaries
  if (config.providerId === 'google') {
    return {
      google: {
        thinkingConfig: { includeThoughts: true },
      },
    }
  }

  // OpenAI o-series reasoning
  const isOSeries = /^o[1-9]/.test(id) || id.startsWith('o3') || id.startsWith('o4')
  if (config.providerId === 'openai' && isOSeries) {
    return {
      openai: { reasoningEffort: config.thinkingEffort },
    }
  }

  return undefined
}

/**
 * Deep-merge multiple providerOptions objects.
 * Later entries override earlier ones at the key level within each provider.
 */
export function mergeProviderOptions(
  ...options: Array<Record<string, Record<string, JSONValue>> | undefined>
): Record<string, Record<string, JSONValue>> | undefined {
  const merged: Record<string, Record<string, JSONValue>> = {}

  for (const option of options) {
    if (!option)
      continue
    for (const [providerId, providerValues] of Object.entries(option)) {
      merged[providerId] = { ...(merged[providerId] ?? {}), ...providerValues }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

// ── tool event types ──────────────────────────────────────────────────────────

export interface ToolCallEvent {
  /** Tool call ID from the model (matches the subsequent result event). */
  id: string
  name: string
  /** Parsed input args from the model — always an object. */
  args: Record<string, unknown>
}

export interface ToolResultEvent {
  id: string
  name: string
  /** true = execute() returned normally; false = threw or stream errored. */
  ok: boolean
  /** The value returned by execute(). */
  result?: Record<string, unknown>
}

// ── stream options ────────────────────────────────────────────────────────────

export interface StreamChatOptions {
  model: LanguageModel
  messages: ModelMessage[]
  systemPrompt?: string | SystemModelMessage[]
  tools?: ToolSet | undefined
  supportsToolCalls: boolean
  providerOptions?: Record<string, Record<string, JSONValue>>
  onDelta: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
  onToolCall?: (event: ToolCallEvent) => void
  onToolResult?: (event: ToolResultEvent) => void
  onFinish?: (event: StreamChatFinishEvent) => void
  onError?: (error: Error) => void
  signal?: AbortSignal
  maxOutputTokens?: number
  debugRaw?: boolean
}

export interface StreamChatFinishEvent {
  fullText: string
  providerMetadata?: ProviderMetadata
  usage: LanguageModelUsage
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract a clean error message regardless of the thrown value's type. */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  try {
    return JSON.stringify(error)
  }
  catch {
    return 'An unknown error occurred'
  }
}

/** Return true if the error represents a user-initiated abort. */
function isAbortError(error: unknown): boolean {
  if (error instanceof Error)
    return error.name === 'AbortError' || error.message.includes('aborted')
  return false
}

// ── streamChat ────────────────────────────────────────────────────────────────

/**
 * Stream a chat response from the AI model.
 *
 * When tools are provided AND the model supports them, stopWhen:
 * isLoopFinished() lets the agent call tools as many times as needed,
 * stopping only when the model produces a final text response.
 *
 * Stream part mapping (AI SDK v5/v6):
 *   text-delta      → part.text
 *   reasoning-delta → part.text
 *   tool-call       → part.toolCallId / part.toolName / part.input
 *   tool-result     → part.toolCallId / part.toolName / part.output
 *   error           → part.error
 *
 * Error handling:
 *   - AbortError  → silently swallowed (user cancelled)
 *   - All others  → calls onError callback then re-throws
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const {
    model,
    messages,
    systemPrompt,
    tools,
    supportsToolCalls,
    providerOptions,
    onDelta,
    onReasoningDelta,
    onToolCall,
    onToolResult,
    onFinish,
    onError,
    signal,
    maxOutputTokens = 4096,
    debugRaw = false,
  } = opts

  // Guard: abort signal already fired before we even start
  if (signal?.aborted)
    return

  // Guard: empty message array will be rejected by every provider
  if (!messages.length)
    throw new Error('streamChat: messages array is empty')

  const hasTools = supportsToolCalls && tools != null && Object.keys(tools).length > 0

  try {
    const result = streamText({
      model,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
      ...(hasTools ? { tools } : {}),
      // isLoopFinished() stops when the model returns with no tool calls.
      ...(hasTools ? { stopWhen: isLoopFinished() } : {}),
      maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    })

    let fullText = ''

    for await (const part of result.fullStream) {
      // Check abort on every iteration to surface cancellation quickly
      if (signal?.aborted)
        return

      if (debugRaw)
        console.warn('[ai] raw stream part:', part)

      switch (part.type) {
        case 'text-delta':
          fullText += part.text
          onDelta(part.text)
          break

        case 'reasoning-delta':
          onReasoningDelta?.(part.text)
          break

        // Start/end markers — no action needed, reasoning text arrives via delta
        case 'reasoning-start':
        case 'reasoning-end':
          break

        case 'tool-call':
          onToolCall?.({
            id: part.toolCallId,
            name: part.toolName,
            // part.input is the correct field in AI SDK v5/v6
            args: (part.input ?? {}) as Record<string, unknown>,
          })
          break

        case 'tool-result':
          onToolResult?.({
            id: part.toolCallId,
            name: part.toolName,
            ok: true,
            // part.output is the correct field in AI SDK v5/v6
            result: (part.output ?? {}) as Record<string, unknown>,
          })
          break

        case 'error': {
          const msg = part.error instanceof Error
            ? part.error.message
            : String(part.error)
          throw new Error(msg)
        }
      }
    }

    const [usage, providerMetadata] = await Promise.all([
      result.usage,
      result.providerMetadata,
    ])

    onFinish?.({
      fullText,
      usage,
      ...(providerMetadata ? { providerMetadata } : {}),
    })
  }
  catch (error: unknown) {
    if (isAbortError(error))
      return

    const err = error instanceof Error ? error : new Error(extractErrorMessage(error))
    onError?.(err)
    throw err
  }
}

// ── system prompt builder ─────────────────────────────────────────────────────

/**
 * Build the full system prompt for the current session.
 *
 * @param projectPath - Absolute path to the open project, or null if none.
 * @param _mode       - 'build' (implement) | 'plan' (design only).
 * @param osInfo      - OS info from getOsInfo(). Injects platform-specific
 *                      shell/path conventions so the agent uses correct syntax.
 */
export function buildSystemPrompt(
  projectPath: string | null,
  _mode: ChatMode = 'build',
  osInfo?: OsInfo,
): string {
  return buildPrompt(projectPath, osInfo)
}
