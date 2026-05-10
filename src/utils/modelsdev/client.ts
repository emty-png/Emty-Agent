import type { FilterCriteria, MDevData, MDevInterleaved, MDevModel, MDevProvider } from './types'

const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const DEFAULT_FETCH_TIMEOUT_MS = 15000

export interface ModelsDevClientOptions {
  apiUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface ModelsDevFetchOptions {
  signal?: AbortSignal
}

export class ModelsDevClient {
  private data: MDevData | null = null
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: ModelsDevClientOptions = {}) {
    const fetchImpl = options.fetchImpl ?? bindGlobalFetch()

    this.apiUrl = options.apiUrl ?? MODELS_DEV_API_URL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS

    if (typeof fetchImpl !== 'function')
      throw new Error('Fetch API is unavailable in the current runtime.')

    this.fetchImpl = fetchImpl
  }

  async fetch(options: ModelsDevFetchOptions = {}): Promise<MDevData> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const cleanupAbortRelay = relayAbort(options.signal, controller)

    try {
      const response = await this.fetchImpl(this.apiUrl, {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch models.dev data (${response.status} ${response.statusText})`,
        )
      }

      const json = await response.json()
      const data = normalizeModelsDevData(json)
      this.data = data
      return data
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out fetching models.dev data after ${this.timeoutMs}ms`)
      }
      throw error
    }
    finally {
      clearTimeout(timeoutId)
      cleanupAbortRelay()
    }
  }

  getProviders(): MDevProvider[] {
    return Object.values(this.ensureData())
  }

  getProvider(id: string): MDevProvider | undefined {
    return this.ensureData()[id]
  }

  getModels(providerId?: string): MDevModel[] {
    const data = this.ensureData()

    if (providerId) {
      const provider = data[providerId]
      return provider
        ? Object.entries(provider.models).map(([modelId, model]) => normalizeModel(modelId, model))
        : []
    }

    return Object.values(data).flatMap(provider =>
      Object.entries(provider.models).map(([modelId, model]) => normalizeModel(modelId, model)),
    )
  }

  getModel(modelId: string, providerId?: string): MDevModel | undefined {
    const data = this.ensureData()

    if (providerId) {
      const model = data[providerId]?.models[modelId]
      return model ? normalizeModel(modelId, model) : undefined
    }

    for (const provider of Object.values(data)) {
      const model = provider.models[modelId]
      if (model)
        return normalizeModel(modelId, model)
    }

    return undefined
  }

  filterModels(criteria: FilterCriteria): MDevModel[] {
    return this.getModels().filter(model => {
      if (criteria.toolCall !== undefined && model.tool_call !== criteria.toolCall)
        return false

      if (
        criteria.structuredOutput !== undefined
        && model.structured_output !== criteria.structuredOutput
      ) {
        return false
      }

      if (criteria.reasoning !== undefined && model.reasoning !== criteria.reasoning)
        return false

      if (criteria.vision && !model.modalities?.input?.includes('image'))
        return false

      if (criteria.minContext !== undefined) {
        const contextLimit = model.limit?.context
        if (contextLimit === undefined || contextLimit < criteria.minContext)
          return false
      }

      if (criteria.maxInputCost !== undefined) {
        const inputCost = model.cost?.input
        if (inputCost === undefined || inputCost > criteria.maxInputCost)
          return false
      }

      if (criteria.family && model.family !== criteria.family)
        return false

      return true
    })
  }

  private ensureData(): MDevData {
    if (!this.data)
      throw new Error('Models.dev data has not been fetched yet.')

    return this.data
  }
}

export function normalizeModelsDevData(value: unknown): MDevData {
  if (!isRecord(value))
    return {}

  const data: MDevData = {}

  for (const [providerId, providerValue] of Object.entries(value)) {
    const provider = normalizeProvider(providerId, providerValue)
    if (provider)
      data[providerId] = provider
  }

  return data
}

function normalizeProvider(providerId: string, value: unknown): MDevProvider | null {
  if (!isRecord(value))
    return null

  const rawModels = isRecord(value.models) ? value.models : {}
  const models: Record<string, MDevModel> = {}

  for (const [modelId, modelValue] of Object.entries(rawModels)) {
    const model = normalizeModelEntry(modelId, modelValue)
    if (model)
      models[modelId] = model
  }

  return {
    id: asNonEmptyString(value.id) ?? providerId,
    name: asNonEmptyString(value.name) ?? providerId,
    api: asNonEmptyString(value.api) ?? '',
    env: asStringArray(value.env),
    ...withOptional('doc', asNonEmptyString(value.doc)),
    ...withOptional('npm', asNonEmptyString(value.npm)),
    models,
  }
}

function normalizeModelEntry(modelId: string, value: unknown): MDevModel | null {
  if (!isRecord(value))
    return null

  const cost = normalizeCost(value.cost)
  const limit = normalizeLimit(value.limit)
  const modalities = normalizeModalities(value.modalities)
  const interleaved = normalizeInterleaved(value.interleaved)
  const status = normalizeStatus(value.status)

  return {
    id: asNonEmptyString(value.id) ?? modelId,
    name: asNonEmptyString(value.name) ?? modelId,
    ...withOptional('family', asNonEmptyString(value.family)),
    ...withOptional('release_date', asNonEmptyString(value.release_date)),
    ...withOptional('last_updated', asNonEmptyString(value.last_updated)),
    ...withOptional('tool_call', asBoolean(value.tool_call)),
    ...withOptional('structured_output', asBoolean(value.structured_output)),
    ...withOptional('attachment', asBoolean(value.attachment)),
    ...withOptional('temperature', asBoolean(value.temperature)),
    ...withOptional('knowledge', asNonEmptyString(value.knowledge)),
    ...withOptional('open_weights', asBoolean(value.open_weights)),
    ...withOptional('modalities', modalities),
    ...withOptional('cost', cost),
    ...withOptional('limit', limit),
    ...withOptional('reasoning', asBoolean(value.reasoning)),
    ...withOptional('interleaved', interleaved),
    ...withOptional('status', status),
  }
}

function normalizeModel(modelId: string, model: MDevModel): MDevModel {
  return {
    ...model,
    id: model.id || modelId,
  }
}

function normalizeCost(value: unknown): MDevModel['cost'] {
  if (!isRecord(value))
    return undefined

  const cost = {
    ...withOptional('input', asFiniteNumber(value.input)),
    ...withOptional('output', asFiniteNumber(value.output)),
    ...withOptional('cache_read', asFiniteNumber(value.cache_read)),
    ...withOptional('cache_write', asFiniteNumber(value.cache_write)),
    ...withOptional('reasoning', asFiniteNumber(value.reasoning)),
  }

  return hasDefinedValue(cost) ? cost : undefined
}

function normalizeLimit(value: unknown): MDevModel['limit'] {
  if (!isRecord(value))
    return undefined

  const limit = {
    ...withOptional('context', asFiniteNumber(value.context)),
    ...withOptional('output', asFiniteNumber(value.output)),
    ...withOptional('input', asFiniteNumber(value.input)),
  }

  return hasDefinedValue(limit) ? limit : undefined
}

function normalizeModalities(value: unknown): MDevModel['modalities'] {
  if (!isRecord(value))
    return undefined

  const modalities = {
    input: asStringArray(value.input),
    output: asStringArray(value.output),
  }

  return modalities.input.length > 0 || modalities.output.length > 0 ? modalities : undefined
}

function normalizeInterleaved(value: unknown): boolean | MDevInterleaved | undefined {
  if (typeof value === 'boolean')
    return value

  if (!isRecord(value))
    return undefined

  const field = asNonEmptyString(value.field)
  return field ? { field } : undefined
}

function normalizeStatus(value: unknown): MDevModel['status'] {
  return value === 'alpha' || value === 'beta' || value === 'deprecated' ? value : undefined
}

function relayAbort(source: AbortSignal | undefined, controller: AbortController): () => void {
  if (!source)
    return () => {}

  if (source.aborted) {
    controller.abort()
    return () => {}
  }

  const onAbort = () => controller.abort()
  source.addEventListener('abort', onAbort, { once: true })
  return () => source.removeEventListener('abort', onAbort)
}

function hasDefinedValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some(entry => entry !== undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

function bindGlobalFetch(): typeof fetch | undefined {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined
}

function withOptional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>)
}
