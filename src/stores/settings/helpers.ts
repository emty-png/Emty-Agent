import type { DiscoveredModel } from './types'
import type { MDevData } from '@/utils/modelsdev'
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
  getReleaseDate,
  isChatModel,
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
    .filter(rawModelId => isChatModel(mdevData, mdevId, rawModelId))
    .map(rawModelId => toDiscoveredModel(prevMap, providerId, providerName, mdevData, mdevId, rawModelId))
    .filter((model): model is DiscoveredModel => model !== null)

  return [...existing.filter(m => m.providerId !== providerId), ...updated]
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
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
    knowledgeCutoff: getKnowledgeCutoff(mdevData, mdevId, rawModelId),
    releaseDate: getReleaseDate(mdevData, mdevId, rawModelId),
    lastUpdated: getLastUpdated(mdevData, mdevId, rawModelId),
    status: getModelStatus(mdevData, mdevId, rawModelId),
  }
}
