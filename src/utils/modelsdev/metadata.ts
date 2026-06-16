import type { MDevContextOver200k, MDevCostTier, MDevData, MDevReasoningOption, ModelCost, ModelModalities } from './types'
import { lookupModel } from './cache'

export function providerIconUrl(mdevId: string): string {
  return `https://models.dev/logos/${mdevId}.svg`
}

export function getContextLimit(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): number | null {
  return lookupModel(data, mdevId, rawModelId)?.limit?.context ?? null
}

export function getCost(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): ModelCost {
  const meta = lookupModel(data, mdevId, rawModelId)
  return {
    input: meta?.cost?.input ?? null,
    output: meta?.cost?.output ?? null,
    reasoning: meta?.cost?.reasoning ?? null,
    cache_read: meta?.cost?.cache_read ?? null,
    cache_write: meta?.cost?.cache_write ?? null,
    input_audio: meta?.cost?.input_audio ?? null,
    output_audio: meta?.cost?.output_audio ?? null,
    tiers: meta?.cost?.tiers ?? null,
    context_over_200k: meta?.cost?.context_over_200k ?? null,
  }
}

export function getCostTiers(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): MDevCostTier[] | null {
  return lookupModel(data, mdevId, rawModelId)?.cost?.tiers ?? null
}

export function getContextOver200k(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): MDevContextOver200k | null {
  return lookupModel(data, mdevId, rawModelId)?.cost?.context_over_200k ?? null
}

export function getReasoningOptions(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): MDevReasoningOption[] | null {
  return lookupModel(data, mdevId, rawModelId)?.reasoning_options ?? null
}

export function getModalities(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): ModelModalities {
  const meta = lookupModel(data, mdevId, rawModelId)
  return {
    input: meta?.modalities?.input ?? [],
    output: meta?.modalities?.output ?? [],
  }
}

export function getKnowledgeCutoff(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  return lookupModel(data, mdevId, rawModelId)?.knowledge ?? null
}

export function getReleaseDate(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  return lookupModel(data, mdevId, rawModelId)?.release_date ?? null
}

export function getLastUpdated(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  return lookupModel(data, mdevId, rawModelId)?.last_updated ?? null
}

export function getModelStatus(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): 'alpha' | 'beta' | 'deprecated' | null {
  return lookupModel(data, mdevId, rawModelId)?.status ?? null
}

export function getModelFamily(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  return lookupModel(data, mdevId, rawModelId)?.family ?? null
}

export function modelDisplayName(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string {
  return lookupModel(data, mdevId, rawModelId)?.name ?? rawModelId
}

export function getProviderNpm(
  data: MDevData,
  mdevId: string,
): string | null {
  return data[mdevId]?.npm ?? null
}
