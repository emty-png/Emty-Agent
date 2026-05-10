import type {
  AnthropicConfig,
  AutoContextConfig,
  CompatibleProvider,
  ConfiguredSkill,
  ConnectionStatus,
  ContextCachingConfig,
  DiscoveredModel,
  GoogleConfig,
  McpServerConfig,
  OpenAIConfig,
  TavilyConfig,
  ThinkingEffort,
} from './types'
import type { SkillMetadata } from '@/utils/skills'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { inspectMcpServer, invalidateMcpServerSession } from '@/utils/mcp'
import { getModelsDevData } from '@/utils/modelsdev'
import { platformFetch } from '@/utils/platformFetch'
import { BUILTIN_SKILL_METADATA, discoverProjectSkills } from '@/utils/skills'
import { useProjectStore } from '../project'
import { fetchAnthropic, fetchGoogle, fetchOllamaDownloadedModels, fetchOpenAI } from './api'
import { makeId, mergeExplicitProviderModels, mergeProviderModels, resolveMdevId } from './helpers'

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
    const compatibleProviders = ref<CompatibleProvider[]>([])
    const mcpServers = ref<McpServerConfig[]>([])
    const contextCaching = ref<ContextCachingConfig>({
      enabled: true,
      anthropicTtl: '5m',
      openaiPromptCacheRetention: 'in_memory',
      googleCachedContent: '',
    })
    const autoContext = ref<AutoContextConfig>({ enabled: true })
    const disabledSkillIds = ref<string[]>([])
    const projectSkills = ref<SkillMetadata[]>([])
    const projectSkillsStatus = ref<ConnectionStatus>('idle')
    const projectSkillsStatusMessage = ref('')

    const availableSkills = computed<ConfiguredSkill[]>(() =>
      [...BUILTIN_SKILL_METADATA, ...projectSkills.value].map(skill => ({
        ...skill,
        enabled: !disabledSkillIds.value.includes(skill.id),
      })),
    )

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

    async function refreshProjectSkills(projectPath: string | null): Promise<void> {
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
        projectSkillsStatusMessage.value = projectSkills.value.length > 0
          ? `${projectSkills.value.length} project skill${projectSkills.value.length === 1 ? '' : 's'} found`
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

    // ── compatible providers ──────────────────────────────────────────────────
    function addProvider(partial: Pick<CompatibleProvider, 'name' | 'baseURL' | 'apiKey' | 'mdevId'>): string {
      const id = makeId()
      compatibleProviders.value.push({
        id,
        ...partial,
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
        const r = await fetchOllamaDownloadedModels(p.baseURL, p.apiKey)
        p.status = r.ok ? 'ok' : 'error'
        if (r.ok) {
          discoveredModels.value = mergeExplicitProviderModels(
            discoveredModels.value,
            p.id,
            p.name,
            r.rawModels,
            mdevData,
            mdevId,
          )
          const count = discoveredModels.value.filter(m => m.providerId === p.id).length
          p.statusMessage = `Connected — ${count} downloaded text-output models`
        }
        else {
          p.statusMessage = r.message
        }
        return
      }

      const r = await fetchOpenAI(p.baseURL, p.apiKey)
      p.status = r.ok ? 'ok' : 'error'
      if (r.ok) {
        discoveredModels.value = mergeProviderModels(
          discoveredModels.value,
          p.id,
          p.name,
          mdevData,
          mdevId,
        )
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
      contextCaching,
      autoContext,
      disabledSkillIds,
      projectSkills,
      projectSkillsStatus,
      projectSkillsStatusMessage,
      availableSkills,
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
        'contextCaching',
        'autoContext',
        'disabledSkillIds',
        'compatibleProviders',
        'mcpServers',
        'discoveredModels',
        'activeModelUid',
      ],
    },
  },
)
