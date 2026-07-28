import type { LanguageModel } from 'ai'
import type { ProviderCredentials } from '@/utils/ai'

/**
 * Minimal interface of the Settings Store needed for model initialization.
 * This decoupled interface prevents circular dependencies while allowing
 * both `sendMessage.ts` and `subagent.ts` to share logic.
 */
export interface ModelSettingsSnapshot {
  activeModel: {
    id: string
    providerId: string
    supportsThinking: boolean
    thinkingEffort: 'low' | 'medium' | 'high'
    sdkType?: 'openai' | 'anthropic' | 'google' | null
  } | null
  openai: { apiKey: string; baseURL?: string; organizationId?: string }
  anthropic: { apiKey: string; baseURL?: string }
  google: { apiKey: string }
  compatibleProviders?: Array<{
    id: string
    apiKey: string
    baseURL: string
    name: string
    headers?: Record<string, string>
  }>
}

/**
 * Given a generic model definition from settings, resolves and builds the actual
 * AI SDK LanguageModel instance using the correct provider credentials.
 */
export function resolveLanguageModel(
  activeModel: NonNullable<ModelSettingsSnapshot['activeModel']>,
  settings: ModelSettingsSnapshot,
  buildLanguageModel: (creds: ProviderCredentials, modelId: string) => LanguageModel,
): LanguageModel {
  const pid = activeModel.providerId

  if (pid === 'openai') {
    return buildLanguageModel(
      {
        type: 'openai',
        apiKey: settings.openai.apiKey,
        ...(settings.openai.baseURL ? { baseURL: settings.openai.baseURL } : {}),
        ...(settings.openai.organizationId ? { organizationId: settings.openai.organizationId } : {}),
      },
      activeModel.id,
    )
  }

  if (pid === 'anthropic') {
    return buildLanguageModel(
      {
        type: 'anthropic',
        apiKey: settings.anthropic.apiKey,
        ...(settings.anthropic.baseURL ? { baseURL: settings.anthropic.baseURL } : {}),
      },
      activeModel.id,
    )
  }

  if (pid === 'google') {
    return buildLanguageModel(
      { type: 'google', apiKey: settings.google.apiKey },
      activeModel.id,
    )
  }

  // Fallback to compatible providers
  const compat = settings.compatibleProviders?.find(p => p.id === pid)
  if (!compat)
    throw new Error(`Provider "${pid}" not found`)

  const sdkType = activeModel.sdkType ?? 'compatible'
  return buildLanguageModel(
    {
      type: sdkType,
      apiKey: compat.apiKey,
      baseURL: compat.baseURL,
      name: compat.name,
      headers: compat.headers,
    },
    activeModel.id,
  )
}

/**
 * Resolves the maximum output tokens based on the model's thinking effort
 * and base capabilities. Sub-agents may override the default limit.
 */
export function resolveMaxTokens(
  activeModel: NonNullable<ModelSettingsSnapshot['activeModel']>,
  defaultMax = 16_384,
): number {
  if (activeModel.supportsThinking) {
    if (activeModel.thinkingEffort === 'high')
      return 16_000
    if (activeModel.thinkingEffort === 'low')
      return 2048
    return 8000
  }
  return defaultMax
}
