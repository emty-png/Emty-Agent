import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
export interface CompatibleProvider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}

export interface DiscoveredModel {
  uid: string // `${providerId}::${rawId}`
  id: string // raw API id
  name: string // formatted display name
  providerId: string // 'openai' | 'anthropic' | 'google' | compat.id
  providerName: string
  enabled: boolean
  supportsThinking: boolean
  thinkingEffort: ThinkingEffort
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

function formatModelName(rawId: string): string {
  return rawId
    .replace(/^models\//, '')
    .replace(/-(\d{8})$/, '') // strip date suffixes like -20250514
    .replace(/[-_]/g, ' ')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bai\b/gi, 'AI')
    .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase())
    .trim()
}

function detectSupportsThinking(providerId: string, modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^models\//, '')
  if (providerId === 'openai')
    return /^o[134]/.test(id) || id.startsWith('o1-') || id.startsWith('o3') || id.startsWith('o4')
  if (providerId === 'anthropic') {
    return (
      id.includes('3-7')
      || id.includes('opus-4')
      || id.includes('sonnet-4')
      || id.includes('haiku-4-5')
      || id.includes('haiku-4.5')
    )
  }
  if (providerId === 'google')
    return id.includes('2.5') || id.includes('gemini-3')
  return false
}

function mergeProviderModels(
  existing: DiscoveredModel[],
  providerId: string,
  providerName: string,
  rawModels: { id: string }[],
): DiscoveredModel[] {
  const prevMap = new Map(existing.filter(m => m.providerId === providerId).map(m => [m.id, m]))
  const updated: DiscoveredModel[] = rawModels.map(raw => {
    const prev = prevMap.get(raw.id)
    return {
      uid: `${providerId}::${raw.id}`,
      id: raw.id,
      name: formatModelName(raw.id),
      providerId,
      providerName,
      enabled: prev?.enabled ?? true,
      supportsThinking: detectSupportsThinking(providerId, raw.id),
      thinkingEffort: prev?.thinkingEffort ?? 'medium',
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
    const res = await fetch(url, {
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
    const res = await fetch(url, {
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
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] }
      // Flatten to { id } shape; keep only generateContent-capable models
      const rawModels = (data?.models ?? [])
        .filter(
          m =>
            !m.name.includes('embedding')
            && !m.name.includes('aqa')
            && !m.name.includes('tts')
            && !m.name.includes('vision'),
        )
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
      openai.value.status = 'testing'
      openai.value.statusMessage = ''
      const r = await fetchOpenAI(openai.value.baseURL, openai.value.apiKey)
      openai.value.status = r.ok ? 'ok' : 'error'
      openai.value.statusMessage = r.message
      if (r.ok) {
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'openai',
          'OpenAI',
          r.rawModels,
        )
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
      anthropic.value.status = 'testing'
      anthropic.value.statusMessage = ''
      const r = await fetchAnthropic(anthropic.value.baseURL, anthropic.value.apiKey)
      anthropic.value.status = r.ok ? 'ok' : 'error'
      anthropic.value.statusMessage = r.message
      if (r.ok) {
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'anthropic',
          'Anthropic',
          r.rawModels,
        )
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
      google.value.status = 'testing'
      google.value.statusMessage = ''
      const r = await fetchGoogle(google.value.apiKey)
      google.value.status = r.ok ? 'ok' : 'error'
      google.value.statusMessage = r.message
      if (r.ok) {
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          'google',
          'Google Gemini',
          r.rawModels,
        )
      }
    }
    function resetGoogleStatus(): void {
      google.value.status = 'idle'
      google.value.statusMessage = ''
    }

    // ── compatible providers ──────────────────────────────────────────────────
    function addProvider(partial: Pick<CompatibleProvider, 'name' | 'baseURL' | 'apiKey'>): void {
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
      p.status = 'testing'
      p.statusMessage = ''
      const r = await fetchOpenAI(p.baseURL, p.apiKey)
      p.status = r.ok ? 'ok' : 'error'
      p.statusMessage = r.message
      if (r.ok) {
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          p.id,
          p.name,
          r.rawModels,
        )
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
        'compatibleProviders',
        'discoveredModels',
        'activeModelUid',
      ],
    },
  },
)
