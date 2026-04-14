import { defineStore } from 'pinia'
import { ref } from 'vue'

// ── types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error'

export interface OpenAIConfig {
  apiKey: string
  organizationId: string
  baseURL: string // override for Azure / proxies
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

export interface SettingsState {
  openai: OpenAIConfig
  compatibleProviders: CompatibleProvider[]
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

async function testOpenAIEndpoint(
  baseURL: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  const url = `${baseURL.replace(/\/$/, '')}/models`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (res.ok) {
      const data = await res.json() as { data?: unknown[] }
      const count = data?.data?.length ?? '?'
      return { ok: true, message: `Connected — ${count} models available` }
    }

    if (res.status === 401)
      return { ok: false, message: 'Invalid API key' }
    if (res.status === 403)
      return { ok: false, message: 'Access forbidden — check org/project permissions' }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` }
  }
  catch (e: unknown) {
    if (e instanceof Error) {
      if (e.name === 'TimeoutError')
        return { ok: false, message: 'Request timed out (8s)' }
      if (e.message.includes('fetch'))
        return { ok: false, message: 'Could not reach endpoint — check URL and network' }
    }
    return { ok: false, message: 'Unknown error' }
  }
}

// ── store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = defineStore(
  'settings',
  () => {
    // ── openai ───────────────────────────────────────────────────────────────
    const openai = ref<OpenAIConfig>({
      apiKey: '',
      organizationId: '',
      baseURL: 'https://api.openai.com/v1',
      status: 'idle',
      statusMessage: '',
    })

    async function testOpenAI(): Promise<void> {
      if (!openai.value.apiKey.trim()) {
        openai.value.status = 'error'
        openai.value.statusMessage = 'API key is required'
        return
      }
      openai.value.status = 'testing'
      openai.value.statusMessage = ''
      const result = await testOpenAIEndpoint(openai.value.baseURL, openai.value.apiKey)
      openai.value.status = result.ok ? 'ok' : 'error'
      openai.value.statusMessage = result.message
    }

    function resetOpenAIStatus(): void {
      openai.value.status = 'idle'
      openai.value.statusMessage = ''
    }

    // ── compatible providers ──────────────────────────────────────────────────
    const compatibleProviders = ref<CompatibleProvider[]>([])

    function addProvider(partial: Pick<CompatibleProvider, 'name' | 'baseURL' | 'apiKey'>): void {
      compatibleProviders.value.push({
        id: makeId(),
        name: partial.name,
        baseURL: partial.baseURL,
        apiKey: partial.apiKey,
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
    }

    async function testProvider(id: string): Promise<void> {
      const p = compatibleProviders.value.find(x => x.id === id)
      if (!p)
        return
      if (!p.apiKey.trim() && !p.baseURL.trim()) {
        p.status = 'error'
        p.statusMessage = 'Base URL and API key are required'
        return
      }
      p.status = 'testing'
      p.statusMessage = ''
      const result = await testOpenAIEndpoint(p.baseURL, p.apiKey)
      p.status = result.ok ? 'ok' : 'error'
      p.statusMessage = result.message
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
      compatibleProviders,
      testOpenAI,
      resetOpenAIStatus,
      addProvider,
      updateProvider,
      removeProvider,
      testProvider,
      resetProviderStatus,
    }
  },
  {
    // persist everything EXCEPT transient status fields
    persist: {
      pick: ['openai.apiKey', 'openai.organizationId', 'openai.baseURL', 'compatibleProviders'],
    },
  },
)
