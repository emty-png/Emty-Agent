import type {
  AgentConfig,
  AnthropicConfig,
  AutoContextConfig,
  BraveConfig,
  CompatibleProvider,
  ConfiguredSkill,
  ConnectionStatus,
  ContextCachingConfig,
  DiscoveredModel,
  DuckDuckGoConfig,
  ExaConfig,
  GoogleConfig,
  ImageGenProvider,
  ImageGenProviderConfig,
  McpServerConfig,
  MemoryConfig,
  OpenAIConfig,
  SerperConfig,
  TavilyConfig,
  ThinkingEffort,
  WebSearchProvider,
} from './types'
import type { SkillMetadata } from '@/utils/skills'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { inspectMcpServer, invalidateMcpServerSession } from '@/utils/mcp'
import { getModelsDevData } from '@/utils/modelsdev'
import { platformFetch } from '@/utils/platformFetch'
import { BUILTIN_SKILL_METADATA, discoverGlobalSkills, discoverProjectSkills } from '@/utils/skills'
import { buildToolCatalogGroups } from '@/utils/tools/catalog'
import { useProjectStore } from '../project'
import { fetchAnthropic, fetchGoogle, fetchOllamaDownloadedModels, fetchOpenAI } from './api'
import { applyManualModelOverrides, makeId, mergeExplicitProviderModels, mergeProviderModels, resolveMdevId } from './helpers'

export const useSettingsStore = defineStore(
  'settings',
  () => {
    const project = useProjectStore()

    function isOllamaProvider(provider: Pick<CompatibleProvider, 'mdevId' | 'name'>): boolean {
      return (provider.mdevId ?? resolveMdevId('', provider.name)) === 'ollama'
    }

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
    const duckduckgo = ref<DuckDuckGoConfig>({ status: 'idle', statusMessage: '' })
    const exa = ref<ExaConfig>({ apiKey: '', status: 'idle', statusMessage: '' })
    const brave = ref<BraveConfig>({ apiKey: '', status: 'idle', statusMessage: '' })
    const serper = ref<SerperConfig>({ apiKey: '', status: 'idle', statusMessage: '' })
    const webSearchProvider = ref<WebSearchProvider>('duckduckgo')

    // ── image generation providers ─────────────────────────────────────────
    const imageGenProvider = ref<ImageGenProvider>('openai')
    const imageGen = ref<Record<ImageGenProvider, ImageGenProviderConfig>>({
      google: { apiKey: '', model: 'imagen-4.0-generate-001', status: 'idle', statusMessage: '', discoveredModels: [] },
      openai: { apiKey: '', model: 'gpt-image-1', status: 'idle', statusMessage: '', discoveredModels: [] },
      stability: { apiKey: '', model: 'stable-diffusion-xl-1024-v1-0', status: 'idle', statusMessage: '', discoveredModels: [] },
      fal: { apiKey: '', model: 'fal-ai/flux/dev', status: 'idle', statusMessage: '', discoveredModels: [] },
      replicate: { apiKey: '', model: 'black-forest-labs/flux-1.1-pro', status: 'idle', statusMessage: '', discoveredModels: [] },
      together: { apiKey: '', model: 'black-forest-labs/FLUX.1-dev-free', status: 'idle', statusMessage: '', discoveredModels: [] },
      fireworks: { apiKey: '', model: 'accounts/fireworks/models/flux-1-dev', status: 'idle', statusMessage: '', discoveredModels: [] },
      custom: { apiKey: '', baseURL: '', model: '', status: 'idle', statusMessage: '', discoveredModels: [] },
    })

    const compatibleProviders = ref<CompatibleProvider[]>([])
    const mcpServers = ref<McpServerConfig[]>([])
    const contextCaching = ref<ContextCachingConfig>({
      enabled: true,
      anthropicTtl: '5m',
      openaiPromptCacheRetention: 'in_memory',
      googleCachedContent: '',
    })
    const autoContext = ref<AutoContextConfig>({ enabled: true })
    const memory = ref<MemoryConfig>({ enabled: true })
    const agent = ref<AgentConfig>({
      permissionMode: 'ask',
      subagents: {
        isolation: 'worktree',
      },
      sessionCompaction: {
        auto: true,
        thresholdPercent: 85,
        showManualButton: true,
      },
      gitCoAuthor: true,
    })
    const disabledToolIds = ref<string[]>([])
    const disabledSkillIds = ref<string[]>([])
    const globalSkills = ref<SkillMetadata[]>([])
    const projectSkills = ref<SkillMetadata[]>([])
    const projectSkillsStatus = ref<ConnectionStatus>('idle')
    const projectSkillsStatusMessage = ref('')

    const availableSkills = computed<ConfiguredSkill[]>(() =>
      [...BUILTIN_SKILL_METADATA, ...globalSkills.value, ...projectSkills.value].map(skill => ({
        ...skill,
        enabled: !disabledSkillIds.value.includes(skill.id),
      })),
    )
    const availableToolGroups = computed(() => buildToolCatalogGroups(mcpServers.value))

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

    function setSkillEnabled(id: string, enabled: boolean): void {
      if (enabled)
        disabledSkillIds.value = disabledSkillIds.value.filter(skillId => skillId !== id)
      else if (!disabledSkillIds.value.includes(id))
        disabledSkillIds.value = [...disabledSkillIds.value, id]
    }

    function isToolEnabled(id: string): boolean {
      return !disabledToolIds.value.includes(id)
    }

    function setToolEnabled(id: string, enabled: boolean): void {
      if (enabled)
        disabledToolIds.value = disabledToolIds.value.filter(toolId => toolId !== id)
      else if (!disabledToolIds.value.includes(id))
        disabledToolIds.value = [...disabledToolIds.value, id]
    }

    function setToolsEnabled(ids: string[], enabled: boolean): void {
      const uniqueIds = [...new Set(ids)]
      if (enabled) {
        const disabled = new Set(disabledToolIds.value)
        uniqueIds.forEach(id => disabled.delete(id))
        disabledToolIds.value = [...disabled]
        return
      }

      const next = new Set(disabledToolIds.value)
      uniqueIds.forEach(id => next.add(id))
      disabledToolIds.value = [...next]
    }

    async function refreshProjectSkills(projectPath: string | null): Promise<void> {
      // Always load global skills regardless of project path
      try {
        globalSkills.value = await discoverGlobalSkills()
      }
      catch {
        globalSkills.value = []
      }

      if (!projectPath) {
        projectSkills.value = []
        projectSkillsStatus.value = 'idle'
        projectSkillsStatusMessage.value = ''
        return
      }

      projectSkillsStatus.value = 'testing'
      projectSkillsStatusMessage.value = ''

      try {
        projectSkills.value = await discoverProjectSkills(projectPath)
        projectSkillsStatus.value = 'ok'
        const parts: string[] = []
        if (globalSkills.value.length > 0)
          parts.push(`${globalSkills.value.length} global`)
        if (projectSkills.value.length > 0)
          parts.push(`${projectSkills.value.length} project`)
        projectSkillsStatusMessage.value = parts.length > 0
          ? `${parts.join(', ')} skill${(globalSkills.value.length + projectSkills.value.length) === 1 ? '' : 's'} found`
          : 'No project skills found yet'
      }
      catch (error) {
        projectSkills.value = []
        projectSkillsStatus.value = 'error'
        projectSkillsStatusMessage.value = error instanceof Error
          ? error.message
          : 'Failed to load project skills'
      }
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
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'openai').length
        openai.value.statusMessage = `Connected — ${count} text models from models.dev`
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
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'anthropic').length
        anthropic.value.statusMessage = `Connected — ${count} text models from models.dev`
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
          mdevData,
          mdevId,
        )
        const count = discoveredModels.value.filter(m => m.providerId === 'google').length
        google.value.statusMessage = `Connected — ${count} text models from models.dev`
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

    // ── test: DuckDuckGo ──────────────────────────────────────────────────
    async function testDuckDuckGo(): Promise<void> {
      duckduckgo.value.status = 'testing'
      duckduckgo.value.statusMessage = ''
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<{ results: unknown[] }>('ddg_search', {
          query: 'test',
          maxResults: 1,
        })
        if (result.results.length > 0) {
          duckduckgo.value.status = 'ok'
          duckduckgo.value.statusMessage = 'Connected — web search ready'
        }
        else {
          duckduckgo.value.status = 'error'
          duckduckgo.value.statusMessage = 'No results returned from DuckDuckGo'
        }
      }
      catch (e: unknown) {
        duckduckgo.value.status = 'error'
        duckduckgo.value.statusMessage
          = e instanceof Error
            ? e.message
            : 'Could not reach DuckDuckGo'
      }
    }
    function resetDuckDuckGoStatus(): void {
      duckduckgo.value.status = 'idle'
      duckduckgo.value.statusMessage = ''
    }

    // ── test: Exa ────────────────────────────────────────────────────────────
    async function testExa(): Promise<void> {
      exa.value.status = 'testing'
      exa.value.statusMessage = ''
      try {
        const res = await platformFetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': exa.value.apiKey,
          },
          body: JSON.stringify({ query: 'test', numResults: 1 }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          exa.value.status = 'ok'
          exa.value.statusMessage = 'Connected — web search ready'
        }
        else {
          exa.value.status = 'error'
          const body = await res.text().catch(() => '')
          exa.value.statusMessage = res.status === 401
            ? 'Invalid API key'
            : `HTTP ${res.status}: ${body.slice(0, 100)}`
        }
      }
      catch (e: unknown) {
        exa.value.status = 'error'
        exa.value.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (8s)'
            : 'Could not reach Exa'
      }
    }
    function resetExaStatus(): void {
      exa.value.status = 'idle'
      exa.value.statusMessage = ''
    }

    // ── test: Brave ──────────────────────────────────────────────────────────
    async function testBrave(): Promise<void> {
      brave.value.status = 'testing'
      brave.value.statusMessage = ''
      try {
        const res = await platformFetch('https://api.search.brave.com/res/v1/web/search?q=test', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': brave.value.apiKey,
          },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          brave.value.status = 'ok'
          brave.value.statusMessage = 'Connected — web search ready'
        }
        else {
          brave.value.status = 'error'
          const body = await res.text().catch(() => '')
          brave.value.statusMessage = res.status === 401
            ? 'Invalid API key'
            : `HTTP ${res.status}: ${body.slice(0, 100)}`
        }
      }
      catch (e: unknown) {
        brave.value.status = 'error'
        brave.value.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (8s)'
            : 'Could not reach Brave Search'
      }
    }
    function resetBraveStatus(): void {
      brave.value.status = 'idle'
      brave.value.statusMessage = ''
    }

    // ── test: Serper ─────────────────────────────────────────────────────────
    async function testSerper(): Promise<void> {
      serper.value.status = 'testing'
      serper.value.statusMessage = ''
      try {
        const res = await platformFetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': serper.value.apiKey,
          },
          body: JSON.stringify({ q: 'test', num: 1 }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          serper.value.status = 'ok'
          serper.value.statusMessage = 'Connected — web search ready'
        }
        else {
          serper.value.status = 'error'
          const body = await res.text().catch(() => '')
          serper.value.statusMessage = res.status === 401
            ? 'Invalid API key'
            : `HTTP ${res.status}: ${body.slice(0, 100)}`
        }
      }
      catch (e: unknown) {
        serper.value.status = 'error'
        serper.value.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (8s)'
            : 'Could not reach Serper'
      }
    }
    function resetSerperStatus(): void {
      serper.value.status = 'idle'
      serper.value.statusMessage = ''
    }

    // ── image generation providers ───────────────────────────────────────────

    async function fetchImageGenModels(provider: ImageGenProvider): Promise<void> {
      const config = imageGen.value[provider]
      const models: Array<{ id: string; name: string }> = []
      try {
        if (provider === 'openai') {
          const res = await platformFetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok)
            throw new Error(`HTTP ${res.status}`)
          const data = await res.json() as { data?: Array<{ id: string }> }
          for (const m of data.data ?? []) {
            if (/^(?:dall-e|gpt-image)/.test(m.id))
              models.push({ id: m.id, name: m.id })
          }
        }
        else if (provider === 'google') {
          const res = await platformFetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`,
            { method: 'GET', signal: AbortSignal.timeout(10000) },
          )
          if (!res.ok)
            throw new Error(`HTTP ${res.status}`)
          const data = await res.json() as { models?: Array<{ name: string; displayName?: string }> }
          for (const m of data.models ?? []) {
            const id = m.name.replace(/^models\//, '')
            models.push({ id, name: m.displayName ?? id })
          }
        }
        else if (provider === 'stability') {
          const res = await platformFetch('https://api.stability.ai/v2beta/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: AbortSignal.timeout(10000),
          })
          if (res.ok) {
            const data = await res.json() as { results?: Array<{ id: string; name?: string }> }
            for (const m of data.results ?? []) {
              if (/image|stable-diffusion|sdxl/i.test(m.id))
                models.push({ id: m.id, name: m.name ?? m.id })
            }
          }
        }
        else if (['fal', 'replicate', 'together', 'fireworks', 'custom'].includes(provider)) {
          const baseURL = provider === 'custom' ? config.baseURL : getProviderBaseURL(provider)
          if (baseURL) {
            const res = await platformFetch(`${baseURL}/v1/models`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${config.apiKey}` },
              signal: AbortSignal.timeout(10000),
            })
            if (res.ok) {
              const data = await res.json() as { data?: Array<{ id: string }> }
              for (const m of data.data ?? []) {
                if (isImageModel(m.id))
                  models.push({ id: m.id, name: m.id })
              }
            }
          }
        }
      }
      catch {
        // Model discovery is best-effort; don't fail the connection test
      }
      config.discoveredModels = models
    }

    function getProviderBaseURL(provider: ImageGenProvider): string | null {
      const map: Record<string, string> = {
        fal: 'https://fal.run',
        replicate: 'https://api.replicate.com',
        together: 'https://api.together.xyz',
        fireworks: 'https://api.fireworks.ai/inference',
      }
      return map[provider] ?? null
    }

    function isImageModel(id: string): boolean {
      const lower = id.toLowerCase()
      return /image|dall|flux|stable.?diffusion|sdxl|sdv|playground|midjourney|ideogram|kandinsky|firefly/.test(lower)
    }

    async function testImageGenProvider(provider: ImageGenProvider): Promise<void> {
      const config = imageGen.value[provider]
      if (!config.apiKey.trim() && provider !== 'custom') {
        config.status = 'error'
        config.statusMessage = 'API key is required'
        return
      }
      config.status = 'testing'
      config.statusMessage = ''
      try {
        if (provider === 'google') {
          const res = await platformFetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`,
            { method: 'GET', signal: AbortSignal.timeout(8000) },
          )
          if (!res.ok)
            throw new Error(`HTTP ${res.status}`)
        }
        else if (provider === 'openai') {
          const res = await platformFetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok)
            throw new Error(`HTTP ${res.status}`)
        }
        else if (!config.apiKey.trim()) {
          throw new Error('API key is required')
        }
        config.status = 'ok'
        config.statusMessage = 'Connected \u2014 image generation ready'
        await fetchImageGenModels(provider)
      }
      catch (e: unknown) {
        config.status = 'error'
        config.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (8s)'
            : e instanceof Error ? e.message : String(e)
      }
    }

    function resetImageGenStatus(provider: ImageGenProvider): void {
      imageGen.value[provider].status = 'idle'
      imageGen.value[provider].statusMessage = ''
    }

    function setImageGenProvider(provider: ImageGenProvider): void {
      imageGenProvider.value = provider
    }

    // ── compatible providers ──────────────────────────────────────────────────
    function addProvider(partial: Pick<CompatibleProvider, 'name' | 'baseURL' | 'apiKey' | 'mdevId'> & {
      headers?: Record<string, string>
      models?: CompatibleProvider['models']
    }): string {
      const id = makeId()
      compatibleProviders.value.push({
        id,
        ...partial,
        headers: partial.headers ?? {},
        models: partial.models ?? [],
        status: 'idle',
        statusMessage: '',
      })
      return id
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
      const mdevId = p.mdevId ?? resolveMdevId(p.id, p.name)

      if (isOllamaProvider(p)) {
        const r = await fetchOllamaDownloadedModels(p.baseURL, p.apiKey, p.headers)
        p.status = r.ok ? 'ok' : 'error'
        if (r.ok) {
          const manualIds = (p.models ?? []).map(m => m.id)
          const allRawModels = [...new Set([...r.rawModels, ...manualIds])]
          discoveredModels.value = mergeExplicitProviderModels(
            discoveredModels.value,
            p.id,
            p.name,
            allRawModels,
            mdevData,
            mdevId,
          )
          // Apply display name overrides from manual models
          applyManualModelOverrides(discoveredModels.value, p.id, p.models)
          const count = discoveredModels.value.filter(m => m.providerId === p.id).length
          p.statusMessage = `Connected — ${count} downloaded text-output models`
        }
        else {
          p.statusMessage = r.message
        }
        return
      }

      const r = await fetchOpenAI(p.baseURL, p.apiKey, p.headers)
      p.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        const manualIds = (p.models ?? []).map(m => m.id)
        if (manualIds.length) {
          const allKnownModels = [...new Set(manualIds)]
          discoveredModels.value = mergeExplicitProviderModels(
            discoveredModels.value,
            p.id,
            p.name,
            allKnownModels,
            mdevData,
            mdevId,
          )
        }
        else {
          discoveredModels.value = mergeProviderModels(
            discoveredModels.value,
            p.id,
            p.name,
            mdevData,
            mdevId,
          )
        }
        // Apply display name overrides from manual models
        applyManualModelOverrides(discoveredModels.value, p.id, p.models)
        const count = discoveredModels.value.filter(m => m.providerId === p.id).length
        p.statusMessage = `Connected — ${count} text models from models.dev`
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

    function addMcpServer(): void {
      mcpServers.value.push({
        id: makeId(),
        name: `MCP Server ${mcpServers.value.length + 1}`,
        transport: 'stdio',
        enabled: true,
        command: '',
        argsText: '',
        cwd: '',
        envText: '',
        toolCount: 0,
        tools: [],
        status: 'idle',
        statusMessage: '',
      })
    }

    function updateMcpServer(id: string, patch: Partial<Omit<McpServerConfig, 'id'>>): void {
      const server = mcpServers.value.find(item => item.id === id)
      if (!server)
        return

      Object.assign(server, patch)
      server.status = 'idle'
      server.statusMessage = ''
      server.toolCount = 0
      server.tools = []
      invalidateMcpServerSession(id)
    }

    function removeMcpServer(id: string): void {
      mcpServers.value = mcpServers.value.filter(server => server.id !== id)
      invalidateMcpServerSession(id)
    }

    function resetMcpServerStatus(id: string): void {
      const server = mcpServers.value.find(item => item.id === id)
      if (!server)
        return

      server.status = 'idle'
      server.statusMessage = ''
      server.toolCount = 0
      server.tools = []
      invalidateMcpServerSession(id)
    }

    async function testMcpServer(id: string): Promise<void> {
      const server = mcpServers.value.find(item => item.id === id)
      if (!server) {
        return
      }

      if (!server.command.trim()) {
        server.status = 'error'
        server.statusMessage = 'Command is required'
        return
      }

      server.status = 'testing'
      server.statusMessage = ''
      server.toolCount = 0
      server.tools = []
      invalidateMcpServerSession(id)

      try {
        const result = await inspectMcpServer(server)
        server.tools = result.tools
        server.toolCount = result.tools.length
        server.status = 'ok'
        server.statusMessage = `Connected - ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} ready`
      }
      catch (error) {
        server.status = 'error'
        server.statusMessage = error instanceof Error
          ? error.message
          : 'Failed to connect to MCP server'
      }
    }

    watch(
      () => project.projectPath,
      path => refreshProjectSkills(path),
      { immediate: true },
    )

    function normalizeAgentConfig() {
      agent.value = {
        permissionMode: agent.value.permissionMode === 'auto' ? 'auto' : 'ask',
        subagents: {
          isolation: agent.value.subagents?.isolation === 'inherit' ? 'inherit' : 'worktree',
        },
        sessionCompaction: {
          auto: agent.value.sessionCompaction?.auto !== false,
          thresholdPercent: Math.min(
            95,
            Math.max(50, agent.value.sessionCompaction?.thresholdPercent ?? 85),
          ),
          showManualButton: agent.value.sessionCompaction?.showManualButton !== false,
        },
        gitCoAuthor: agent.value.gitCoAuthor !== false,
      }
    }

    normalizeAgentConfig()

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
      duckduckgo,
      webSearchProvider,
      testDuckDuckGo,
      resetDuckDuckGoStatus,
      exa,
      testExa,
      resetExaStatus,
      brave,
      testBrave,
      resetBraveStatus,
      serper,
      testSerper,
      resetSerperStatus,
      imageGenProvider,
      imageGen,
      testImageGenProvider,
      fetchImageGenModels,
      resetImageGenStatus,
      setImageGenProvider,
      contextCaching,
      autoContext,
      memory,
      agent,
      disabledToolIds,
      disabledSkillIds,
      globalSkills,
      projectSkills,
      projectSkillsStatus,
      projectSkillsStatusMessage,
      availableSkills,
      availableToolGroups,
      isToolEnabled,
      setToolEnabled,
      setToolsEnabled,
      setSkillEnabled,
      refreshProjectSkills,
      compatibleProviders,
      addProvider,
      updateProvider,
      removeProvider,
      testProvider,
      resetProviderStatus,
      mcpServers,
      addMcpServer,
      updateMcpServer,
      removeMcpServer,
      resetMcpServerStatus,
      testMcpServer,
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
        'exa.apiKey',
        'brave.apiKey',
        'serper.apiKey',
        'webSearchProvider',
        'imageGenProvider',
        'imageGen',
        'contextCaching',
        'autoContext',
        'memory',
        'agent',
        'disabledToolIds',
        'disabledSkillIds',
        'compatibleProviders',
        'mcpServers',
        'discoveredModels',
        'activeModelUid',
      ],
    },
  },
)
