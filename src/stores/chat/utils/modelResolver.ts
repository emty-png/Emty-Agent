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
    thinkingEffort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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

function thinkingBudgetForResolver(effort: NonNullable<ModelSettingsSnapshot['activeModel']>['thinkingEffort']): number {
  switch (effort) {
    case 'low': return 2048
    case 'medium': return 16_000
    case 'high': return 32_000
    case 'xhigh': return 48_000
    case 'max': return 100_000
    default: return 0
  }
}

/**
 * Resolves the maximum output tokens based on the model's thinking effort
 * and base capabilities. Sub-agents may override the default limit.
 *
 * IMPORTANT: For thinking models, maxOutputTokens must be **strictly larger**
 * than the thinking budget (Anthropic requires budget < max_tokens). Previous
 * values had budget > max (e.g. medium budget 16k but max 8k) which caused
 * 400/500 invalid_param errors and silent stops after a single thinking step.
 */
export function resolveMaxTokens(
  activeModel: NonNullable<ModelSettingsSnapshot['activeModel']>,
  defaultMax = 16_384,
): number {
  if (activeModel.supportsThinking && activeModel.thinkingEffort !== 'off') {
    const budget = thinkingBudgetForResolver(activeModel.thinkingEffort)
    // Ensure max comfortably exceeds budget + room for actual output.
    // Claude/Gemini need at least budget + 4k. Keep a floor of defaultMax.
    const required = budget + 8192
    if (activeModel.thinkingEffort === 'low')
      return Math.max(defaultMax, required)
    if (activeModel.thinkingEffort === 'medium')
      return Math.max(defaultMax, required)
    if (activeModel.thinkingEffort === 'high')
      return Math.max(32_000, required)
    if (activeModel.thinkingEffort === 'xhigh')
      return Math.max(48_000, required)
    if (activeModel.thinkingEffort === 'max')
      return Math.max(64_000, required)
    return Math.max(defaultMax, required)
  }
  return defaultMax
}
