import type { CompatibleProviderModel, DiscoveredModel } from './types'
import type { MDevData, MDevModel } from '@/utils/modelsdev'
import {
  CORE_MDEV_IDS,
  getContextLimit,
  getCost,
  getKnowledgeCutoff,
  getLastUpdated,
  getModalities,
  getModelFamily,
  getModelStatus,
  getProviderModels,
  getReasoningOptions,
  getReleaseDate,
  isChatModel,
  lookupModel,
  modelDisplayName,
  PRESET_MDEV_IDS,
  resolveModelMetadata,
  supportsAttachments,
  supportsReasoning,
  supportsStructuredOutput,
  supportsTemperature,
  supportsToolCalls,
} from '@/utils/modelsdev'

export function resolveMdevId(providerId: string, providerName: string): string {
  return CORE_MDEV_IDS[providerId]
    ?? PRESET_MDEV_IDS[providerName]
    ?? providerId
}

export function mergeProviderModels(
  existing: DiscoveredModel[],
  providerId: string,
  providerName: string,
  mdevData: MDevData,
  mdevId: string,
): DiscoveredModel[] {
  const prevMap = new Map(existing.filter(m => m.providerId === providerId).map(m => [m.id, m]))
  const updated: DiscoveredModel[] = getProviderModels(mdevData, mdevId)
    .filter(model => isChatModel(mdevData, mdevId, model.id))
    .map(model => toDiscoveredModel(prevMap, providerId, providerName, mdevData, mdevId, model.id))
    .filter((model): model is DiscoveredModel => model !== null)
  return [...existing.filter(m => m.providerId !== providerId), ...updated]
}

export function mergeExplicitProviderModels(
  existing: DiscoveredModel[],
  providerId: string,
  providerName: string,
  rawModelIds: string[],
  mdevData: MDevData,
  mdevId: string,
): DiscoveredModel[] {
  const prevMap = new Map(existing.filter(m => m.providerId === providerId).map(m => [m.id, m]))
  const updated = rawModelIds
    .map(rawModelId => {
      // Model exists in models.dev — use full metadata if it's a chat model
      if (lookupModel(mdevData, mdevId, rawModelId)) {
        if (!isChatModel(mdevData, mdevId, rawModelId))
          return null // in models.dev but not a chat model (e.g. embeddings) — skip
        return toDiscoveredModel(prevMap, providerId, providerName, mdevData, mdevId, rawModelId)
      }
      // Not in models.dev at all — create a fallback entry so it's still usable
      return createFallbackDiscoveredModel(prevMap, providerId, providerName, rawModelId)
    })
    .filter((model): model is DiscoveredModel => model !== null)

  return [...existing.filter(m => m.providerId !== providerId), ...updated]
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

/**
 * Apply display name and context limit overrides from manually defined models.
 */
export function applyManualModelOverrides(
  models: DiscoveredModel[],
  providerId: string,
  manualModels?: CompatibleProviderModel[],
): void {
  if (!manualModels?.length)
    return
  const overrideMap = new Map(
    manualModels
      .filter(m => m.id.trim())
      .map(m => [m.id.trim(), m]),
  )
  for (const model of models) {
    if (model.providerId !== providerId)
      continue
    const override = overrideMap.get(model.id)
    if (!override)
      continue
    if (override.name.trim())
      model.name = override.name.trim()
    if (override.contextLimit && override.contextLimit > 0)
      model.contextLimit = override.contextLimit
  }
}

function resolveSdkType(mdevData: MDevData, mdevId: string): 'openai' | 'anthropic' | 'google' | null {
  const provider = mdevData[mdevId]
  if (!provider?.npm)
    return null
  const npm = provider.npm
  if (npm === '@ai-sdk/anthropic')
    return 'anthropic'
  if (npm === '@ai-sdk/openai')
    return 'openai'
  if (npm === '@ai-sdk/google' || npm === '@ai-sdk/google-vertex')
    return 'google'
  return null
}

/**
 * Determines whether a model must use the OpenAI Responses API
 * instead of Chat Completions. For opencode, Muse Spark models
 * are currently only served on /responses and return 500 on
 * /chat/completions (see opencode issues #44847, #44627).
 * Detection is based on per-model provider.npm and id pattern.
 */
function shouldUseResponsesApi(
  mdevData: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  // Heuristic for user-typed ids that are not in models.dev
  if (/muse-spark/i.test(rawModelId) && (mdevId === 'opencode' || mdevId === 'opencode-go')) {
    return true
  }
  const model = lookupModel(mdevData, mdevId, rawModelId)
  if (!model)
    return false
  const perModelNpm = (model as MDevModel & { provider?: { npm?: string } }).provider?.npm
  // Opencode Muse Spark models are marked with per-model npm @ai-sdk/openai and must use /responses
  if (perModelNpm === '@ai-sdk/openai' && /muse-spark/i.test(rawModelId) && (mdevId === 'opencode' || mdevId === 'opencode-go')) {
    return true
  }
  return false
}

function toDiscoveredModel(
  prevMap: Map<string, DiscoveredModel>,
  providerId: string,
  providerName: string,
  mdevData: MDevData,
  mdevId: string,
  rawModelId: string,
): DiscoveredModel | null {
  const resolved = resolveModelMetadata(mdevData, mdevId, rawModelId)
  if (!resolved)
    return null

  const prev = prevMap.get(rawModelId)
  const modalities = getModalities(mdevData, mdevId, rawModelId)
  const cost = getCost(mdevData, mdevId, rawModelId)

  return {
    uid: `${providerId}::${rawModelId}`,
    id: rawModelId,
    name: modelDisplayName(mdevData, mdevId, rawModelId),
    providerId,
    providerName,
    mdevProviderId: resolved.providerId,
    enabled: prev?.enabled ?? true,
    supportsThinking: supportsReasoning(mdevData, mdevId, rawModelId),
    thinkingEffort: prev?.thinkingEffort ?? 'medium',
    supportsToolCalls: supportsToolCalls(mdevData, mdevId, rawModelId),
    supportsAttachments: supportsAttachments(mdevData, mdevId, rawModelId),
    supportsStructuredOutput: supportsStructuredOutput(mdevData, mdevId, rawModelId),
    supportsTemperature: supportsTemperature(mdevData, mdevId, rawModelId),
    family: getModelFamily(mdevData, mdevId, rawModelId),
    inputModalities: modalities.input,
    outputModalities: modalities.output,
    contextLimit: getContextLimit(mdevData, mdevId, rawModelId),
    costInput: cost.input,
    costOutput: cost.output,
    costReasoning: cost.reasoning,
    costTiers: cost.tiers,
    costContextOver200k: cost.context_over_200k,
    knowledgeCutoff: getKnowledgeCutoff(mdevData, mdevId, rawModelId),
    releaseDate: getReleaseDate(mdevData, mdevId, rawModelId),
    lastUpdated: getLastUpdated(mdevData, mdevId, rawModelId),
    status: getModelStatus(mdevData, mdevId, rawModelId),
    reasoningOptions: getReasoningOptions(mdevData, mdevId, rawModelId),
    sdkType: resolveSdkType(mdevData, mdevId),
    ...(shouldUseResponsesApi(mdevData, mdevId, rawModelId) ? { transport: 'responses' as const } : {}),
  }
}

function createFallbackDiscoveredModel(
  prevMap: Map<string, DiscoveredModel>,
  providerId: string,
  providerName: string,
  rawModelId: string,
): DiscoveredModel {
  const prev = prevMap.get(rawModelId)
  const mdevId = resolveMdevId(providerId, providerName)
  const useResponses = /muse-spark/i.test(rawModelId) && (mdevId === 'opencode' || mdevId === 'opencode-go')
  return {
    uid: `${providerId}::${rawModelId}`,
    id: rawModelId,
    name: rawModelId,
    providerId,
    providerName,
    enabled: prev?.enabled ?? true,
    supportsThinking: false,
    thinkingEffort: prev?.thinkingEffort ?? 'medium',
    supportsToolCalls: true,
    supportsAttachments: false,
    supportsStructuredOutput: false,
    supportsTemperature: true,
    family: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextLimit: null,
    costInput: null,
    costOutput: null,
    costReasoning: null,
    costTiers: null,
    costContextOver200k: null,
    knowledgeCutoff: null,
    releaseDate: null,
    lastUpdated: null,
    status: null,
    reasoningOptions: null,
    sdkType: null,
    ...(useResponses ? { transport: 'responses' as const } : {}),
  }
}
