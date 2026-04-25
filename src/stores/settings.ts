import type { MDevData } from '@/utils/modelsdev'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  CORE_MDEV_IDS,
  getContextLimit,
  getCost,
  getKnowledgeCutoff,
  getModalities,
  getModelFamily,
  getModelsDevData,
  isChatModel,
  modelDisplayName,
  PRESET_MDEV_IDS,
  supportsAttachments,
  supportsReasoning,
  supportsStructuredOutput,
  supportsTemperature,
  supportsToolCalls,
} from '@/utils/modelsdev'
import { platformFetch } from '@/utils/platformFetch'

// ── types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error'
export type ThinkingEffort = 'low' | 'medium' | 'high'

export interface OpenAIConfig {
  apiKey: string
  organizationId: string
  baseURL: string
  status: ConnectionStatus
  statusMessage: string
}
export interface AnthropicConfig {
  apiKey: string
  baseURL: string
  status: ConnectionStatus
  statusMessage: string
}
export interface GoogleConfig {
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}
export interface TavilyConfig {
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}
export interface CompatibleProvider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  mdevId?: string
  status: ConnectionStatus
  statusMessage: string
}

export interface DiscoveredModel {
  uid: string // `${providerId}::${rawId}`
  id: string // raw API id
  name: string // formatted display name
  providerId: string // 'openai' | 'anthropic' | 'google' | compat.id
  providerName: string
  mdevProviderId?: string
  enabled: boolean

  // ── capabilities ──────────────────────────────────────────────────
  supportsThinking: boolean
  thinkingEffort: ThinkingEffort
  supportsToolCalls: boolean
  supportsAttachments: boolean
  supportsStructuredOutput: boolean
  supportsTemperature: boolean

  // ── metadata ──────────────────────────────────────────────────────
  family: string | null
  inputModalities: string[]
  outputModalities: string[]
  contextLimit: number | null
  costInput: number | null
  costOutput: number | null
  knowledgeCutoff: string | null
}

// ── default presets ───────────────────────────────────────────────────────────

export interface ProviderPreset {
  name: string
  baseURL: string
  requiresKey: boolean
  description: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    requiresKey: false,
    description: 'Local models on your machine',
  },
  {
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    requiresKey: false,
    description: 'Local model server with a UI',
  },
  {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    description: 'Ultra-fast LPU inference',
  },
  {
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    requiresKey: true,
    description: 'European frontier models',
  },
  {
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    requiresKey: true,
    description: 'Open-source model catalogue',
  },
  {
    name: 'Deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    requiresKey: true,
    description: 'Powerful reasoning models',
  },
  {
    name: 'Perplexity',
    baseURL: 'https://api.perplexity.ai',
    requiresKey: true,
    description: 'Search-augmented generation',
  },
  {
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    requiresKey: true,
    description: 'Fast serverless inference',
  },
  {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    description: '300+ models, one API key',
  },
  {
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    requiresKey: true,
    description: 'Wafer-scale AI chips',
  },
  {
    name: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    requiresKey: true,
    description: 'Grok models by xAI',
  },
  {
    name: 'Novita AI',
    baseURL: 'https://api.novita.ai/v3/openai',
    requiresKey: true,
    description: 'Affordable open-model hosting',
  },
  {
    name: 'Anyscale',
    baseURL: 'https://api.endpoints.anyscale.com/v1',
    requiresKey: true,
    description: 'Scalable model endpoints',
  },
]

// ── model helpers ─────────────────────────────────────────────────────────────

function resolveMdevId(providerId: string, providerName: string): string {
  return CORE_MDEV_IDS[providerId]
    ?? PRESET_MDEV_IDS[providerName]
    ?? providerId
}

function mergeProviderModels(
  existing: DiscoveredModel[],
  providerId: string,
  providerName: string,
  rawModels: { id: string }[],
  mdevData: MDevData,
  mdevId: string,
): DiscoveredModel[] {
  const prevMap = new Map(existing.filter(m => m.providerId === providerId).map(m => [m.id, m]))
  const updated: DiscoveredModel[] = rawModels
    .filter(raw => isChatModel(mdevData, mdevId, raw.id))
    .map(raw => {
      const prev = prevMap.get(raw.id)
      return {
        uid: `${providerId}::${raw.id}`,
        id: raw.id,
        name: modelDisplayName(mdevData, mdevId, raw.id),
        providerId,
        providerName,
        mdevProviderId: mdevId,
        enabled: prev?.enabled ?? true,
        supportsThinking: supportsReasoning(mdevData, mdevId, raw.id),
        thinkingEffort: prev?.thinkingEffort ?? 'medium',
        supportsToolCalls: supportsToolCalls(mdevData, mdevId, raw.id),
        supportsAttachments: supportsAttachments(mdevData, mdevId, raw.id),
        supportsStructuredOutput: supportsStructuredOutput(mdevData, mdevId, raw.id),
        supportsTemperature: supportsTemperature(mdevData, mdevId, raw.id),
        family: getModelFamily(mdevData, mdevId, raw.id),
        inputModalities: getModalities(mdevData, mdevId, raw.id).input,
        outputModalities: getModalities(mdevData, mdevId, raw.id).output,
        contextLimit: getContextLimit(mdevData, mdevId, raw.id),
        costInput: getCost(mdevData, mdevId, raw.id).input,
        costOutput: getCost(mdevData, mdevId, raw.id).output,
        knowledgeCutoff: getKnowledgeCutoff(mdevData, mdevId, raw.id),
      }
    })
  return [...existing.filter(m => m.providerId !== providerId), ...updated]
}

// ── shared test result ────────────────────────────────────────────────────────

interface TestResult {
  ok: boolean
  message: string
  rawModels: { id: string }[]
}

// ── test + discover helpers ───────────────────────────────────────────────────

async function fetchOpenAI(baseURL: string, apiKey: string): Promise<TestResult> {
  const url = `${baseURL.replace(/\/$/, '')}/models`
  try {
    const res = await platformFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string }[] }
      const rawModels = data?.data ?? []
      return { ok: true, message: `Connected — ${rawModels.length} models available`, rawModels }
    }
    if (res.status === 401)
      return { ok: false, message: 'Invalid API key', rawModels: [] }
    if (res.status === 403) {
      return {
        ok: false,
        message: 'Access forbidden — check org/project permissions',
        rawModels: [],
      }
    }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}`, rawModels: [] }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach endpoint — check URL and network'
    return { ok: false, message: msg, rawModels: [] }
  }
}

async function fetchAnthropic(baseURL: string, apiKey: string): Promise<TestResult> {
  const url = `${baseURL.replace(/\/$/, '')}/models`
  try {
    const res = await platformFetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string }[] }
      const rawModels = data?.data ?? []
      return { ok: true, message: `Connected — ${rawModels.length} models available`, rawModels }
    }
    if (res.status === 401)
      return { ok: false, message: 'Invalid API key', rawModels: [] }
    if (res.status === 403)
      return { ok: false, message: 'Access denied — check key permissions', rawModels: [] }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}`, rawModels: [] }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach Anthropic'
    return { ok: false, message: msg, rawModels: [] }
  }
}

async function fetchGoogle(apiKey: string): Promise<TestResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
  try {
    const res = await platformFetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = (await res.json()) as {
        models?: {
          name: string
          supportedGenerationMethods?: string[]
        }[]
      }
      // Flatten to { id } shape; keep only generateContent-capable models
      const rawModels = (data?.models ?? [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({ id: m.name.replace(/^models\//, '') }))
      return { ok: true, message: `Connected — ${rawModels.length} models available`, rawModels }
    }
    if (res.status === 400)
      return { ok: false, message: 'Invalid API key format', rawModels: [] }
    if (res.status === 403)
      return { ok: false, message: 'API key invalid or Gemini API not enabled', rawModels: [] }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}`, rawModels: [] }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach Google'
    return { ok: false, message: msg, rawModels: [] }
  }
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = defineStore(
  'settings',
  () => {
    // ── provider configs ──────────────────────────────────────────────────────
    const openai = ref<OpenAIConfig>({
      apiKey: '',
      organizationId: '',
      baseURL: 'https://api.openai.com/v1',
      status: 'idle',
      statusMessage: '',
    })
    const anthropic = ref<AnthropicConfig>({
      apiKey: '',
      baseURL: 'https://api.anthropic.com/v1',
      status: 'idle',
      statusMessage: '',
    })
    const google = ref<GoogleConfig>({ apiKey: '', status: 'idle', statusMessage: '' })
    const tavily = ref<TavilyConfig>({ apiKey: '', status: 'idle', statusMessage: '' })
    const compatibleProviders = ref<CompatibleProvider[]>([])

    // ── discovered models + active selection ──────────────────────────────────
    const discoveredModels = ref<DiscoveredModel[]>([])
    const activeModelUid = ref<string | null>(null)

    const enabledModels = computed(() => discoveredModels.value.filter(m => m.enabled))

    const activeModel = computed(
      () =>
        discoveredModels.value.find(m => m.uid === activeModelUid.value)
        ?? enabledModels.value[0]
        ?? null,
    )

    // ── model actions ─────────────────────────────────────────────────────────
    function toggleModel(uid: string): void {
      const m = discoveredModels.value.find(x => x.uid === uid)
      if (!m)
        return
      m.enabled = !m.enabled
      // if we just disabled the active model, clear selection
      if (!m.enabled && activeModelUid.value === uid)
        activeModelUid.value = null
    }

    function setModelThinking(uid: string, effort: ThinkingEffort): void {
      const m = discoveredModels.value.find(x => x.uid === uid)
      if (m)
        m.thinkingEffort = effort
    }

    // `forceModelThinking` removed: feature deprecated. Auto-detected thinking remains.

    function setActiveModel(uid: string): void {
      activeModelUid.value = uid
    }

    function removeProviderModels(providerId: string): void {
      discoveredModels.value = discoveredModels.value.filter(m => m.providerId !== providerId)
      if (activeModel.value?.providerId === providerId)
        activeModelUid.value = null
    }

    // ── test + discover: OpenAI ───────────────────────────────────────────────
    async function testOpenAI(): Promise<void> {
      if (!openai.value.apiKey.trim()) {
        openai.value.status = 'error'
        openai.value.statusMessage = 'API key is required'
        return
      }
      const mdevData = await getModelsDevData()
      openai.value.status = 'testing'
      openai.value.statusMessage = ''
      const r = await fetchOpenAI(openai.value.baseURL, openai.value.apiKey)
      openai.value.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        const mdevId = resolveMdevId('openai', 'OpenAI')
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'openai',
          'OpenAI',
          r.rawModels,
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'openai').length
        openai.value.statusMessage = `Connected — ${count} chat models`
      }
      else {
        openai.value.statusMessage = r.message
      }
    }
    function resetOpenAIStatus(): void {
      openai.value.status = 'idle'
      openai.value.statusMessage = ''
    }

    // ── test + discover: Anthropic ────────────────────────────────────────────
    async function testAnthropic(): Promise<void> {
      if (!anthropic.value.apiKey.trim()) {
        anthropic.value.status = 'error'
        anthropic.value.statusMessage = 'API key is required'
        return
      }
      const mdevData = await getModelsDevData()
      anthropic.value.status = 'testing'
      anthropic.value.statusMessage = ''
      const r = await fetchAnthropic(anthropic.value.baseURL, anthropic.value.apiKey)
      anthropic.value.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        const mdevId = resolveMdevId('anthropic', 'Anthropic')
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'anthropic',
          'Anthropic',
          r.rawModels,
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'anthropic').length
        anthropic.value.statusMessage = `Connected — ${count} chat models`
      }
      else {
        anthropic.value.statusMessage = r.message
      }
    }
    function resetAnthropicStatus(): void {
      anthropic.value.status = 'idle'
      anthropic.value.statusMessage = ''
    }

    // ── test + discover: Google ───────────────────────────────────────────────
    async function testGoogle(): Promise<void> {
      if (!google.value.apiKey.trim()) {
        google.value.status = 'error'
        google.value.statusMessage = 'API key is required'
        return
      }
      const mdevData = await getModelsDevData()
      google.value.status = 'testing'
      google.value.statusMessage = ''
      const r = await fetchGoogle(google.value.apiKey)
      google.value.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        const mdevId = resolveMdevId('google', 'Google Gemini')
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'google',
          'Google Gemini',
          r.rawModels,
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'google').length
        google.value.statusMessage = `Connected — ${count} chat models`
      }
      else {
        google.value.statusMessage = r.message
      }
    }
    function resetGoogleStatus(): void {
      google.value.status = 'idle'
      google.value.statusMessage = ''
    }

    // ── test: Tavily ──────────────────────────────────────────────────────────
    /**
     * Validate the Tavily API key by issuing a minimal search request.
     * Tavily doesn't have a dedicated /ping or /validate endpoint, so we
     * send a real search with max_results: 1 and treat any 2xx as success.
     * A 429 (rate-limited) is also treated as "key is valid" since the key
     * itself was accepted — the user just needs to wait.
     */
    async function testTavily(): Promise<void> {
      if (!tavily.value.apiKey.trim()) {
        tavily.value.status = 'error'
        tavily.value.statusMessage = 'API key is required'
        return
      }
      tavily.value.status = 'testing'
      tavily.value.statusMessage = ''
      try {
        const res = await platformFetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tavily.value.apiKey.trim()}`,
          },
          body: JSON.stringify({ query: 'test', max_results: 1, search_depth: 'basic' }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok || res.status === 429) {
          tavily.value.status = 'ok'
          tavily.value.statusMessage = 'Connected — web search ready'
        }
        else if (res.status === 401) {
          tavily.value.status = 'error'
          tavily.value.statusMessage = 'Invalid API key'
        }
        else {
          tavily.value.status = 'error'
          tavily.value.statusMessage = `HTTP ${res.status}: ${res.statusText}`
        }
      }
      catch (e: unknown) {
        tavily.value.status = 'error'
        tavily.value.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (8s)'
            : 'Could not reach Tavily'
      }
    }
    function resetTavilyStatus(): void {
      tavily.value.status = 'idle'
      tavily.value.statusMessage = ''
    }

    // ── compatible providers ──────────────────────────────────────────────────
    function addProvider(partial: Pick<CompatibleProvider, 'name' | 'baseURL' | 'apiKey' | 'mdevId'>): void {
      compatibleProviders.value.push({
        id: makeId(),
        ...partial,
        status: 'idle',
        statusMessage: '',
      })
    }
    function updateProvider(id: string, patch: Partial<Omit<CompatibleProvider, 'id'>>): void {
      const p = compatibleProviders.value.find(x => x.id === id)
      if (p)
        Object.assign(p, patch)
    }
    function removeProvider(id: string): void {
      compatibleProviders.value = compatibleProviders.value.filter(x => x.id !== id)
      removeProviderModels(id)
    }
    async function testProvider(id: string): Promise<void> {
      const p = compatibleProviders.value.find(x => x.id === id)
      if (!p || !p.baseURL.trim()) {
        if (p) {
          p.status = 'error'
          p.statusMessage = 'Base URL is required'
        }
        return
      }
      const mdevData = await getModelsDevData()
      p.status = 'testing'
      p.statusMessage = ''
      const r = await fetchOpenAI(p.baseURL, p.apiKey)
      p.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        const mdevId = p.mdevId ?? resolveMdevId(p.id, p.name)
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          p.id,
          p.name,
          r.rawModels,
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === p.id).length
        p.statusMessage = `Connected — ${count} chat models`
      }
      else {
        p.statusMessage = r.message
      }
    }
    function resetProviderStatus(id: string): void {
      const p = compatibleProviders.value.find(x => x.id === id)
      if (p) {
        p.status = 'idle'
        p.statusMessage = ''
      }
    }

    return {
      openai,
      testOpenAI,
      resetOpenAIStatus,
      anthropic,
      testAnthropic,
      resetAnthropicStatus,
      google,
      testGoogle,
      resetGoogleStatus,
      tavily,
      testTavily,
      resetTavilyStatus,
      compatibleProviders,
      addProvider,
      updateProvider,
      removeProvider,
      testProvider,
      resetProviderStatus,
      discoveredModels,
      activeModelUid,
      activeModel,
      enabledModels,
      toggleModel,
      setModelThinking,
      setActiveModel,
      removeProviderModels,
    }
  },
  {
    persist: {
      pick: [
        'openai.apiKey',
        'openai.organizationId',
        'openai.baseURL',
        'anthropic.apiKey',
        'anthropic.baseURL',
        'google.apiKey',
        'tavily.apiKey',
        'compatibleProviders',
        'discoveredModels',
        'activeModelUid',
      ],
    },
  },
)
