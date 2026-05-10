import type { MDevData, MDevModel, MDevProvider } from './types'
import { ModelsDevClient } from './client'

let _cache: MDevData | null = null
let _promise: Promise<MDevData> | null = null

const _client = new ModelsDevClient()
const OLLAMA_LATEST_SUFFIX_RE = /:latest$/i
const OLLAMA_CLOUD_SUFFIX_RE = /[:\-]cloud$/i

function normalizeModel(rawModelId: string, model: MDevModel): MDevModel {
  return {
    ...model,
    id: model.id || rawModelId,
  }
}

function pushLookupTarget(
  targets: Array<{ providerId: string; modelId: string }>,
  providerId: string,
  modelId: string,
): void {
  if (!targets.some(target => target.providerId === providerId && target.modelId === modelId))
    targets.push({ providerId, modelId })
}

function getLookupTargets(
  mdevId: string,
  rawModelId: string,
): Array<{ providerId: string; modelId: string }> {
  const targets: Array<{ providerId: string; modelId: string }> = []
  const baseIds = [rawModelId]
  const withoutLatest = rawModelId.replace(OLLAMA_LATEST_SUFFIX_RE, '')

  if (withoutLatest !== rawModelId)
    baseIds.push(withoutLatest)

  for (const baseId of baseIds) {
    if (mdevId === 'ollama' && OLLAMA_CLOUD_SUFFIX_RE.test(baseId)) {
      pushLookupTarget(targets, 'ollama-cloud', baseId.replace(OLLAMA_CLOUD_SUFFIX_RE, ''))
    }

    pushLookupTarget(targets, mdevId, baseId)
  }

  return targets
}

/**
 * Loads models.dev data through the Emty Models client and caches it for the
 * current renderer session.
 */
export async function getModelsDevData(): Promise<MDevData> {
  if (_cache)
    return _cache
  if (_promise)
    return _promise

  _promise = _client
    .fetch()
    .then(data => {
      _cache = data
      return _cache
    })
    .catch(error => {
      console.warn('Failed to load models.dev metadata', error)
      _promise = null
      return {}
    })

  return _promise
}

export function clearModelsDevCache(): void {
  _cache = null
  _promise = null
}

export function getProvider(data: MDevData, mdevId: string): MDevProvider | null {
  return data[mdevId] ?? null
}

export function getProviderModels(data: MDevData, mdevId: string): MDevModel[] {
  const provider = getProvider(data, mdevId)
  if (!provider)
    return []

  return Object.entries(provider.models).map(([rawModelId, model]) =>
    normalizeModel(rawModelId, model),
  )
}

export function resolveModelMetadata(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): { providerId: string; modelId: string; model: MDevModel } | null {
  for (const target of getLookupTargets(mdevId, rawModelId)) {
    const model = data[target.providerId]?.models?.[target.modelId]
    if (model) {
      return {
        providerId: target.providerId,
        modelId: target.modelId,
        model: normalizeModel(target.modelId, model),
      }
    }
  }

  return null
}

export function lookupModel(data: MDevData, mdevId: string, rawModelId: string): MDevModel | null {
  return resolveModelMetadata(data, mdevId, rawModelId)?.model ?? null
}
