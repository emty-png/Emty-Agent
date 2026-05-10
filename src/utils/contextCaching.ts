import type {
  LanguageModelUsage,
  ModelMessage,
  SystemModelMessage,
  UserModelMessage,
} from 'ai'

export interface ContextCachingSettings {
  enabled: boolean
  anthropicTtl: '5m' | '1h'
  openaiPromptCacheRetention: 'in_memory' | '24h'
  googleCachedContent: string
}

export interface ContextCachingRuntime {
  settings: ContextCachingSettings
  providerId: string
  modelId: string
  projectPath: string | null
  scope: string
  promptFingerprint?: string
}

export interface UsageStats {
  providerId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  readTokens?: number
  writeTokens?: number
  reasoningTokens?: number
}

interface MentionProviderOptions {
  anthropic?: {
    cacheControl?: ReturnType<typeof buildAnthropicCacheControl>
  }
}

function buildAnthropicCacheControl(runtime: ContextCachingRuntime) {
  return runtime.settings.anthropicTtl === '1h'
    ? { type: 'ephemeral' as const, ttl: '1h' as const }
    : { type: 'ephemeral' as const }
}

function hashKey(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

function supportsExtendedOpenAICache(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id.startsWith('gpt-5') || id.startsWith('gpt-4.1')
}

export function buildContextCachingProviderOptions(
  runtime: ContextCachingRuntime,
): Record<string, Record<string, string>> | undefined {
  if (!runtime.settings.enabled)
    return undefined

  if (runtime.providerId === 'openai') {
    const promptCacheKey = [
      'emty-agent',
      runtime.scope,
      runtime.modelId,
      hashKey(runtime.projectPath ?? 'no-project'),
      hashKey(runtime.promptFingerprint ?? 'default-prompt'),
    ].join(':')

    return {
      openai: {
        promptCacheKey,
        promptCacheRetention: supportsExtendedOpenAICache(runtime.modelId)
          ? runtime.settings.openaiPromptCacheRetention
          : 'in_memory',
      },
    }
  }

  if (runtime.providerId === 'google' && runtime.settings.googleCachedContent.trim()) {
    return {
      google: {
        cachedContent: runtime.settings.googleCachedContent.trim(),
      },
    }
  }

  return undefined
}

export function buildCachedSystemPrompt(
  systemPrompt: string,
  runtime: ContextCachingRuntime,
): string | SystemModelMessage[] {
  if (!runtime.settings.enabled || runtime.providerId !== 'anthropic')
    return systemPrompt

  return [
    {
      role: 'system',
      content: systemPrompt,
      providerOptions: {
        anthropic: {
          cacheControl: buildAnthropicCacheControl(runtime),
        },
      },
    },
  ]
}

export function applyMentionContextToMessages(
  messages: ModelMessage[],
  mentionContext: string,
  runtime: ContextCachingRuntime,
): ModelMessage[] {
  if (!mentionContext.trim() || messages.length === 0)
    return messages

  const updated = messages.slice()
  const lastMessage = updated.at(-1)
  if (!lastMessage || lastMessage.role !== 'user')
    return messages

  if (!runtime.settings.enabled || runtime.providerId !== 'anthropic') {
    updated[updated.length - 1] = prependTextToUserMessage(lastMessage, `${mentionContext}\n\n`)
    return updated
  }

  updated[updated.length - 1] = prependTextToUserMessage(
    lastMessage,
    `${mentionContext}\n\n`,
    {
      anthropic: {
        cacheControl: buildAnthropicCacheControl(runtime),
      },
    },
  )

  return updated
}

function prependTextToUserMessage(
  message: UserModelMessage,
  text: string,
  providerOptions?: MentionProviderOptions,
): UserModelMessage {
  const prefix = providerOptions
    ? {
        type: 'text' as const,
        text,
        providerOptions: providerOptions as never,
      }
    : {
        type: 'text' as const,
        text,
      }

  if (typeof message.content === 'string') {
    if (!providerOptions)
      return { ...message, content: `${text}${message.content}` }

    return {
      ...message,
      content: [
        prefix,
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ],
    }
  }

  return {
    ...message,
    content: [prefix, ...message.content],
  }
}

export function extractUsageStats(
  usage: LanguageModelUsage,
  providerId: string,
): UsageStats {
  const stats: UsageStats = {
    providerId,
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  }

  const readTokens = usage.inputTokenDetails.cacheReadTokens ?? usage.cachedInputTokens ?? 0
  const writeTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0
  const reasoningTokens = usage.outputTokenDetails.reasoningTokens ?? 0

  if (readTokens > 0)
    stats.readTokens = readTokens
  if (writeTokens > 0)
    stats.writeTokens = writeTokens
  if (reasoningTokens > 0)
    stats.reasoningTokens = reasoningTokens

  return stats
}
