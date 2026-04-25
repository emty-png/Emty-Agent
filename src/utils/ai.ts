/**
 * src/utils/ai.ts
 *
 * Central AI execution layer for Emty Agent.
 * Compatible with: ai ^6.x (AI SDK v5 published as v6 on npm)
 *
 * AI SDK v6 fullStream events use:
 *   text-delta -> part.text
 *   tool-call  -> part.input
 *   tool-result -> part.output
 *   error      -> part.error
 *
 * Tool looping uses stopWhen: isLoopFinished() — runs until the model stops
 * calling tools naturally, with no arbitrary step cap.
 */

import type { LanguageModel, ToolSet } from 'ai'
import type { OsInfo } from '@/utils/os'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { isLoopFinished, streamText } from 'ai'
import { buildPrompt } from '@/prompts/build'
import { planPrompt } from '@/prompts/plan'

export type { LanguageModel, ToolSet }
export type ChatMode = 'build' | 'plan'
export type ThinkingEffort = 'low' | 'medium' | 'high'

// ── provider credentials ─────────────────────────────────────────────────────-

export interface ProviderCredentials {
  type: 'openai' | 'anthropic' | 'google' | 'compatible'
  apiKey?: string | undefined
  baseURL?: string | undefined
  organizationId?: string | undefined
  name?: string | undefined
}

// ── model factory ─────────────────────────────────────────────────────────────

export function buildLanguageModel(
  credentials: ProviderCredentials,
  modelId: string,
): LanguageModel {
  switch (credentials.type) {
    case 'openai': {
      const provider = createOpenAI({
        apiKey: credentials.apiKey ?? '',
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
        ...(credentials.organizationId ? { organization: credentials.organizationId } : {}),
      })
      return provider(modelId)
    }
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: credentials.apiKey ?? '',
        ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
      })
      return provider(modelId)
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({
        apiKey: credentials.apiKey ?? '',
      })
      return provider(modelId)
    }
    case 'compatible': {
      const provider = createOpenAICompatible({
        name: credentials.name ?? 'custom',
        apiKey: credentials.apiKey ?? '',
        baseURL: credentials.baseURL ?? '',
      })
      return provider(modelId)
    }
    default:
      throw new Error(`Unknown provider type: ${(credentials as { type: string }).type}`)
  }
}

// ── thinking budget helper ────────────────────────────────────────────────────

export function thinkingBudgetTokens(effort: ThinkingEffort): number {
  switch (effort) {
    case 'low': return 2048
    case 'high': return 32000
    default: return 16000
  }
}

// ── provider options builder ──────────────────────────────────────────────────

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue | undefined }

export interface ThinkingConfig {
  providerId: string
  modelId: string
  supportsThinking: boolean
  thinkingEffort: ThinkingEffort
}

/**
 * Build provider-specific options for streamText based on thinking config.
 * These are passed as `providerOptions` to the AI SDK.
 */
export function buildProviderOptions(config: ThinkingConfig): Record<string, Record<string, JSONValue>> | undefined {
  if (!config.supportsThinking)
    return undefined

  const id = config.modelId.toLowerCase()

  // Anthropic Claude thinking
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

  // OpenAI o-series reasoning
  const isOSeries = /^o[1-9]/.test(id) || id.startsWith('o3') || id.startsWith('o4')
  if (config.providerId === 'openai' && isOSeries) {
    return {
      openai: {
        reasoningEffort: config.thinkingEffort,
      },
    }
  }

  return undefined
}

// ── tool event types ──────────────────────────────────────────────────────────

export interface ToolCallEvent {
  /** Tool call ID from the model (matches the subsequent result event) */
  id: string
  name: string
  /** Parsed input args from the model */
  args: Record<string, unknown>
}

export interface ToolResultEvent {
  id: string
  name: string
  /** true = execute() returned normally; false = execute() threw or stream errored */
  ok: boolean
}

// ── stream options ────────────────────────────────────────────────────────────

export interface StreamChatOptions {
  model: LanguageModel
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  systemPrompt?: string
  tools?: ToolSet | undefined
  supportsToolCalls: boolean
  providerOptions?: Record<string, Record<string, JSONValue>>
  onDelta: (delta: string) => void
  onToolCall?: (event: ToolCallEvent) => void
  onToolResult?: (event: ToolResultEvent) => void
  onFinish?: (fullText: string) => void
  onError?: (error: Error) => void
  signal?: AbortSignal
  maxOutputTokens?: number
  debugRaw?: boolean
}

/**
 * Stream a chat response.
 *
 * When tools are provided AND the model supports them, uses stopWhen:
 * isLoopFinished() which lets the agent call tools as many times as it needs
 * and stops only when the model produces a final response with no tool calls.
 *
 * Stream part mapping:
 *   text-delta -> part.text
 *   tool-call  -> part.toolCallId / part.toolName / part.input
 *   tool-result -> part.toolCallId / part.toolName / part.output
 *   error      -> part.error
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
    onToolCall,
    onToolResult,
    onFinish,
    onError,
    signal,
    maxOutputTokens = 4096,
    debugRaw = false,
  } = opts

  const hasTools = supportsToolCalls && tools != null && Object.keys(tools).length > 0

  try {
    const result = streamText({
      model,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
      ...(hasTools ? { tools } : {}),
      // isLoopFinished() stops when the model returns a response without any
      // tool calls — i.e., the agent decides it is done. No step cap.
      ...(hasTools ? { stopWhen: isLoopFinished() } : {}),
      maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    })

    let fullText = ''

    for await (const part of result.fullStream) {
      if (debugRaw)
        console.warn('[ai] raw stream part:', part)
      switch (part.type) {
        // Text chunk arriving
        case 'text-delta':
          fullText += part.text
          onDelta(part.text)
          break

        // Model finished writing tool input.
        case 'tool-call':
          onToolCall?.({
            id: part.toolCallId,
            name: part.toolName,
            args: part.input as Record<string, unknown>,
          })
          break

        // Tool execute() finished — result has been sent back to the model.
        case 'tool-result':
          onToolResult?.({
            id: part.toolCallId,
            name: part.toolName,
            ok: true,
          })
          break

        // Stream-level error
        case 'error':
          throw new Error(part.error instanceof Error ? part.error.message : String(part.error))
      }
    }

    onFinish?.(fullText)
  }
  catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError')
      return
    const err = error instanceof Error ? error : new Error(String(error))
    onError?.(err)
    throw err
  }
}

// ── system prompt builder ─────────────────────────────────────────────────────

/**
 * Build the full system prompt.
 *
 * @param projectPath - Absolute path to the open project, or null if none.
 * @param mode        - 'build' (implement) | 'plan' (design only).
 * @param osInfo      - OS information from getOsInfo(). When provided, a
 *                      platform-specific "Operating Environment" section is
 *                      injected so the agent uses correct shell syntax and
 *                      path conventions for the user's OS.
 */
export function buildSystemPrompt(
  projectPath: string | null,
  mode: ChatMode = 'build',
  osInfo?: OsInfo,
): string {
  return mode === 'plan'
    ? planPrompt(projectPath, osInfo)
    : buildPrompt(projectPath, osInfo)
}
