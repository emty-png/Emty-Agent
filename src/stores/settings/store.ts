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
  ModelSamplingConfig,
  ModelSamplingOverride,
  OpenAIConfig,
  ProviderAppearanceConfig,
  ProviderContextConfig,
  ProviderReasoningConfig,
  ProviderSamplingConfig,
  SerperConfig,
  SoundConfig,
  TavilyConfig,
  ThinkingEffort,
  TruncationStrategy,
  WebSearchProvider,
} from './types'
import type { SttProvider, SttProviderConfig, TtsProvider, TtsProviderConfig, VoiceDictionaryEntry, VoiceProcessingConfig, VoiceSnippet } from './voiceTypes'
import type { SkillMetadata } from '@/utils/skills'
import { defineStore } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { inspectMcpServer, invalidateMcpServerSession } from '@/utils/mcp'
import { getModelsDevData } from '@/utils/modelsdev'
import { platformFetch } from '@/utils/platformFetch'
import { BUILTIN_SKILL_METADATA, discoverGlobalSkills, discoverProjectSkills } from '@/utils/skills'
import { buildToolCatalogGroups } from '@/utils/tools/catalog'
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

    // ── voice providers ──────────────────────────────────────────────────────
    const sttProvider = ref<SttProvider>('openai')
    const ttsProvider = ref<TtsProvider>('openai')
    const stt = ref<Record<SttProvider, SttProviderConfig>>({
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', language: 'en', status: 'idle', statusMessage: '' },
      deepgram: { apiKey: '', baseUrl: 'https://api.deepgram.com', model: 'nova-3', language: 'en', status: 'idle', statusMessage: '' },
      assemblyai: { apiKey: '', baseUrl: 'https://api.assemblyai.com/v2', model: 'universal', language: 'en', status: 'idle', statusMessage: '' },
      google: { apiKey: '', baseUrl: 'https://speech.googleapis.com', model: 'latest_long', language: 'en-US', status: 'idle', statusMessage: '' },
      azure: { apiKey: '', baseUrl: '', model: 'en-US-Neural-Broadcast', language: 'en-US', status: 'idle', statusMessage: '' },
      custom: { apiKey: '', baseUrl: '', model: 'whisper-1', language: 'en', status: 'idle', statusMessage: '' },
    })
    const tts = ref<Record<TtsProvider, TtsProviderConfig>>({
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voice: 'alloy', speed: 1.0, status: 'idle', statusMessage: '' },
      elevenlabs: { apiKey: '', baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_turbo_v2', voice: '21m00Tcm4TlvDq8ikWAM', speed: 1.0, status: 'idle', statusMessage: '' },
      deepgram: { apiKey: '', baseUrl: 'https://api.deepgram.com/v1', model: 'aura-asteria-en', voice: 'asteria', speed: 1.0, status: 'idle', statusMessage: '' },
      google: { apiKey: '', baseUrl: 'https://texttospeech.googleapis.com', model: 'en-US-Wavenet-D', voice: 'en-US-Wavenet-D', speed: 1.0, status: 'idle', statusMessage: '' },
      azure: { apiKey: '', baseUrl: '', model: 'en-US-JennyNeural', voice: 'en-US-JennyNeural', speed: 1.0, status: 'idle', statusMessage: '' },
      custom: { apiKey: '', baseUrl: '', model: 'tts-1', voice: 'alloy', speed: 1.0, status: 'idle', statusMessage: '' },
    })

    const voiceProcessing = ref<VoiceProcessingConfig>({
      removeFillers: true,
      autoPunctuate: true,
      correctBacktracks: true,
    })
    const voiceDictionary = ref<VoiceDictionaryEntry[]>([])
    const voiceSnippets = ref<VoiceSnippet[]>([])
    const showSttMic = ref(true)
    const showBrowserButton = ref(true)
    const showLifecycleHooks = ref(true)

    // Defensive: persisted state from older versions may have undefined fields
    watch(voiceProcessing, v => {
      if (!v)
        voiceProcessing.value = { removeFillers: true, autoPunctuate: true, correctBacktracks: true }
    }, { immediate: true })
    watch(voiceDictionary, v => {
      if (!v)
        voiceDictionary.value = []
    }, { immediate: true })
    watch(voiceSnippets, v => {
      if (!v)
        voiceSnippets.value = []
    }, { immediate: true })
    watch(showSttMic, v => {
      if (v == null)
        showSttMic.value = true
    }, { immediate: true })
    watch(showBrowserButton, v => {
      if (v == null)
        showBrowserButton.value = true
    }, { immediate: true })
    watch(showLifecycleHooks, v => {
      if (v == null)
        showLifecycleHooks.value = true
    }, { immediate: true })

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
    const sound = ref<SoundConfig>({
      completionEnabled: true,
      errorEnabled: true,
      volume: 80,
      completionCustomData: null,
      completionCustomName: null,
      errorCustomData: null,
      errorCustomName: null,
    })

    watch(sound, v => {
      if (!v)
        return
      let mutated = false
      if (v.completionCustomData === undefined) {
        v.completionCustomData = null
        mutated = true
      }
      if (v.completionCustomName === undefined) {
        v.completionCustomName = null
        mutated = true
      }
      if (v.errorCustomData === undefined) {
        v.errorCustomData = null
        mutated = true
      }
      if (v.errorCustomName === undefined) {
        v.errorCustomName = null
        mutated = true
      }
      if (mutated)
        sound.value = { ...v }
    }, { immediate: true })
    const developerMode = ref(false)
    const agent = ref<AgentConfig>({
      permissionMode: 'ask',
      subagents: {
        isolation: 'worktree',
      },
      sessionCompaction: {
        auto: true,
        thresholdPercent: 85,
        showManualButton: true,
        modelUid: null,
      },
      gitCoAuthor: true,
      defaultModelUid: null,
      subagentModelUid: null,
    })
    const completedOnboarding = ref(false)
    const toolDisabledIds = ref<{ build: string[]; design: string[] }>({ build: [], design: [] })

    // Migrate legacy flat disabledToolIds → per-mode toolDisabledIds.build
    onMounted(() => {
      try {
        const raw = localStorage.getItem('settings')
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          const legacy = parsed?.disabledToolIds
          if (Array.isArray(legacy) && legacy.length > 0 && toolDisabledIds.value.build.length === 0)
            toolDisabledIds.value = { ...toolDisabledIds.value, build: legacy }
        }
      }
      catch { /* ignore parse errors */ }
    })
    const disabledSkillIds = ref<string[]>([])

    // ── tool description & prompt overrides ─────────────────────────────────
    const toolDescriptionOverrides = ref<Record<string, string>>({})
    const promptOverrides = ref<Record<string, string>>({})

    watch(toolDescriptionOverrides, v => {
      if (!v)
        toolDescriptionOverrides.value = {}
    }, { immediate: true })

    watch(promptOverrides, v => {
      if (!v)
        promptOverrides.value = {}
    }, { immediate: true })

    // ── security overrides (path & command blocklists) ───────────────────────
    const securityOverrides = ref<Record<string, string>>({})

    // Single watcher: defensive null guard + sync to shared security cache
    // (covers both immediate hydration and runtime edits). securityCache also
    // hydrates synchronously from localStorage on module load for early callers.
    watch(securityOverrides, v => {
      if (!v) {
        securityOverrides.value = {}
        import('@/utils/security/securityCache').then(m => m.setSecurityOverridesCache({})).catch(() => {})
        return
      }
      import('@/utils/security/securityCache').then(m => m.setSecurityOverridesCache(v ?? {})).catch(() => {})
    }, { immediate: true, deep: true })

    onMounted(() => {
      import('@/utils/security/securityCache').then(m => m.setSecurityOverridesCache(securityOverrides.value ?? {})).catch(() => {})
    })

    const providerAppearance = ref<ProviderAppearanceConfig>({
      global: {
        hideThinking: false,
        disableThinkingMarkdown: false,
        disableAssistantMarkdown: false,
      },
      perProvider: {},
    })

    watch(providerAppearance, v => {
      if (!v || typeof v !== 'object') {
        providerAppearance.value = {
          global: {
            hideThinking: false,
            disableThinkingMarkdown: false,
            disableAssistantMarkdown: false,
          },
          perProvider: {},
        }
        return
      }
      let mutated = false
      if (!v.global) {
        v.global = {
          hideThinking: false,
          disableThinkingMarkdown: false,
          disableAssistantMarkdown: false,
        }
        mutated = true
      }
      else {
        if (typeof v.global.hideThinking !== 'boolean') {
          v.global.hideThinking = false
          mutated = true
        }
        if (typeof v.global.disableThinkingMarkdown !== 'boolean') {
          v.global.disableThinkingMarkdown = false
          mutated = true
        }
        if (typeof v.global.disableAssistantMarkdown !== 'boolean') {
          v.global.disableAssistantMarkdown = false
          mutated = true
        }
      }
      if (!v.perProvider || typeof v.perProvider !== 'object') {
        v.perProvider = {}
        mutated = true
      }
      if (mutated)
        providerAppearance.value = { global: { ...v.global }, perProvider: { ...v.perProvider } }
    }, { immediate: true })

    function setGlobalAppearance(key: keyof ProviderAppearanceConfig['global'], value: boolean): void {
      providerAppearance.value = {
        ...providerAppearance.value,
        global: { ...providerAppearance.value.global, [key]: value },
      }
    }

    function setProviderAppearance(
      providerId: string,
      key: keyof NonNullable<ProviderAppearanceConfig['perProvider'][string]>,
      value: boolean,
    ): void {
      const nextPerProvider = { ...providerAppearance.value.perProvider }
      const cur = { ...(nextPerProvider[providerId] ?? {}) }
      if (value)
        (cur as Record<string, boolean>)[key] = true
      else
        delete (cur as Record<string, unknown>)[key]
      if (Object.keys(cur).length === 0)
        delete nextPerProvider[providerId]
      else
        nextPerProvider[providerId] = cur
      providerAppearance.value = {
        ...providerAppearance.value,
        perProvider: nextPerProvider,
      }
    }

    function shouldHideThinking(providerId: string | null | undefined): boolean {
      if (providerAppearance.value.global.hideThinking)
        return true
      if (providerId && providerAppearance.value.perProvider[providerId]?.hideThinking)
        return true
      return false
    }

    function shouldDisableThinkingMarkdown(providerId: string | null | undefined): boolean {
      if (providerAppearance.value.global.disableThinkingMarkdown)
        return true
      if (providerId && providerAppearance.value.perProvider[providerId]?.disableThinkingMarkdown)
        return true
      return false
    }

    function shouldDisableAssistantMarkdown(providerId: string | null | undefined): boolean {
      if (providerAppearance.value.global.disableAssistantMarkdown)
        return true
      if (providerId && providerAppearance.value.perProvider[providerId]?.disableAssistantMarkdown)
        return true
      return false
    }

    const providerSampling = ref<ProviderSamplingConfig>({
      global: {},
      perProvider: {},
    })

    watch(providerSampling, v => {
      if (!v || typeof v !== 'object') {
        providerSampling.value = { global: {}, perProvider: {} }
        return
      }
      let mutated = false
      if (!v.global || typeof v.global !== 'object') {
        v.global = {}
        mutated = true
      }
      else {
        const g = v.global as Record<string, unknown>
        for (const k of ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'] as const) {
          const val = g[k]
          if (val !== undefined && typeof val !== 'number') {
            delete g[k]
            mutated = true
          }
        }
        if (g.stopSequences !== undefined && !Array.isArray(g.stopSequences)) {
          delete g.stopSequences
          mutated = true
        }
        if (g.responseFormat !== undefined && !['text', 'json_object', 'json_schema'].includes(g.responseFormat as string)) {
          delete g.responseFormat
          mutated = true
        }
        if (g.parallelToolCalls !== undefined && typeof g.parallelToolCalls !== 'boolean') {
          delete g.parallelToolCalls
          mutated = true
        }
      }
      if (!v.perProvider || typeof v.perProvider !== 'object') {
        v.perProvider = {}
        mutated = true
      }
      else {
        for (const [pid, entry] of Object.entries(v.perProvider as Record<string, Record<string, unknown>>)) {
          if (!entry || typeof entry !== 'object') {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
            continue
          }
          for (const k of ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'] as const) {
            const val = entry[k]
            if (val !== undefined && typeof val !== 'number') {
              delete entry[k]
              mutated = true
            }
          }
          if (entry.stopSequences !== undefined && !Array.isArray(entry.stopSequences)) {
            delete entry.stopSequences
            mutated = true
          }
          if (entry.responseFormat !== undefined && !['text', 'json_object', 'json_schema'].includes(entry.responseFormat as string)) {
            delete entry.responseFormat
            mutated = true
          }
          if (entry.parallelToolCalls !== undefined && typeof entry.parallelToolCalls !== 'boolean') {
            delete entry.parallelToolCalls
            mutated = true
          }
          if (Object.keys(entry).length === 0) {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
          }
        }
      }
      if (mutated)
        providerSampling.value = { global: { ...v.global }, perProvider: { ...v.perProvider } }
    }, { immediate: true })

    function clampSampling(key: keyof ProviderSamplingConfig['global'], value: number): number {
      switch (key) {
        case 'temperature': return Math.min(2, Math.max(0, value))
        case 'topP': return Math.min(1, Math.max(0, value))
        case 'topK': return Math.min(100, Math.max(0, Math.round(value)))
        case 'maxTokens': return Math.min(32768, Math.max(256, Math.round(value)))
        case 'seed': return Math.min(2147483647, Math.max(0, Math.round(value)))
        case 'frequencyPenalty':
        case 'presencePenalty': return Math.min(2, Math.max(-2, value))
        default: return value
      }
    }

    function setGlobalSampling(key: keyof ProviderSamplingConfig['global'], value: number | boolean | string[] | string | null | undefined): void {
      const nextGlobal = { ...providerSampling.value.global } as Record<string, unknown>
      if (value == null || (typeof value === 'number' && Number.isNaN(value))) {
        delete nextGlobal[key as string]
      }
      else if (key === 'stopSequences') {
        nextGlobal[key as string] = (value as string[]).filter(s => typeof s === 'string' && s.length > 0).slice(0, 10)
      }
      else if (typeof value === 'number' && ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'].includes(key as string)) {
        nextGlobal[key as string] = clampSampling(key as keyof ProviderSamplingConfig['global'], value as number)
      }
      else {
        nextGlobal[key as string] = value
      }
      providerSampling.value = { ...providerSampling.value, global: nextGlobal as ProviderSamplingConfig['global'] }
    }

    function setProviderSampling(
      providerId: string,
      key: keyof ProviderSamplingConfig['global'],
      value: number | boolean | string[] | string | null | undefined,
    ): void {
      const nextPerProvider = { ...providerSampling.value.perProvider }
      const cur = { ...(nextPerProvider[providerId] ?? {}) } as Record<string, unknown>
      if (value == null || (typeof value === 'number' && Number.isNaN(value))) {
        delete cur[key as string]
      }
      else if (key === 'stopSequences') {
        cur[key as string] = (value as string[]).filter(s => typeof s === 'string' && s.length > 0).slice(0, 10)
        if ((cur[key as string] as string[]).length === 0)
          delete cur[key as string]
      }
      else if (typeof value === 'number' && ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'].includes(key as string)) {
        cur[key as string] = clampSampling(key as keyof ProviderSamplingConfig['global'], value as number)
      }
      else {
        cur[key as string] = value
      }
      if (Object.keys(cur).length === 0)
        delete nextPerProvider[providerId]
      else
        nextPerProvider[providerId] = cur as ProviderSamplingConfig['global']
      providerSampling.value = { ...providerSampling.value, perProvider: nextPerProvider }
    }

    function getEffectiveSamplingValue(
      providerId: string | null | undefined,
      key: keyof ProviderSamplingConfig['global'],
    ): unknown {
      if (providerId && providerSampling.value.perProvider[providerId]?.[key] !== undefined)
        return providerSampling.value.perProvider[providerId][key]
      if (providerSampling.value.global[key] !== undefined)
        return providerSampling.value.global[key]
      return undefined
    }

    function getEffectiveSampling(providerId: string | null | undefined): ProviderSamplingConfig['global'] {
      const keys: Array<keyof ProviderSamplingConfig['global']> = ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stopSequences', 'responseFormat', 'parallelToolCalls']
      const out: ProviderSamplingConfig['global'] = {}
      for (const k of keys) {
        const v = getEffectiveSamplingValue(providerId, k)
        if (v !== undefined)
          (out as Record<string, unknown>)[k] = v
      }
      return out
    }

    const modelSampling = ref<ModelSamplingConfig>({})

    watch(modelSampling, v => {
      if (!v || typeof v !== 'object') {
        modelSampling.value = {}
        return
      }
      let mutated = false
      for (const [uid, entry] of Object.entries(v as Record<string, Record<string, unknown>>)) {
        if (!entry || typeof entry !== 'object') {
          delete (v as Record<string, unknown>)[uid]
          mutated = true
          continue
        }
        for (const k of ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'contextLimit'] as const) {
          const val = entry[k]
          if (val !== undefined && typeof val !== 'number') {
            delete entry[k]
            mutated = true
          }
        }
        if (entry.stopSequences !== undefined && !Array.isArray(entry.stopSequences)) {
          delete entry.stopSequences
          mutated = true
        }
        if (entry.responseFormat !== undefined && !['text', 'json_object', 'json_schema'].includes(entry.responseFormat as string)) {
          delete entry.responseFormat
          mutated = true
        }
        if (entry.parallelToolCalls !== undefined && typeof entry.parallelToolCalls !== 'boolean') {
          delete entry.parallelToolCalls
          mutated = true
        }
        if (Object.keys(entry).length === 0) {
          delete (v as Record<string, unknown>)[uid]
          mutated = true
        }
      }
      if (mutated)
        modelSampling.value = { ...v }
    }, { immediate: true, deep: true })

    function setModelSampling(
      modelUid: string,
      key: keyof ModelSamplingOverride,
      value: number | boolean | string[] | string | null | undefined,
    ): void {
      const next = { ...modelSampling.value }
      const cur = { ...(next[modelUid] ?? {}) } as Record<string, unknown>
      if (value == null || (typeof value === 'number' && Number.isNaN(value))) {
        delete cur[key as string]
      }
      else if (key === 'stopSequences') {
        const arr = (value as string[]).filter(s => typeof s === 'string' && s.length > 0).slice(0, 10)
        if (arr.length === 0)
          delete cur[key as string]
        else cur[key as string] = arr
      }
      else if (typeof value === 'number' && ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'contextLimit'].includes(key as string)) {
        cur[key as string] = clampSampling(key as keyof ProviderSamplingConfig['global'], value as number)
        if (key === 'contextLimit' && typeof value === 'number') {
          cur[key as string] = Math.min(2000000, Math.max(1024, Math.round(value as number)))
        }
      }
      else {
        cur[key as string] = value
      }
      if (Object.keys(cur).length === 0)
        delete next[modelUid]
      else
        next[modelUid] = cur as ModelSamplingOverride
      modelSampling.value = next
    }

    /* eslint-disable ts/no-use-before-define */
    function getEffectiveModelSampling(modelUid: string | null | undefined, providerId: string | null | undefined): ModelSamplingOverride | undefined {
      if (!modelUid && !providerId)
        return undefined
      const out: ModelSamplingOverride = {}
      const keys: Array<keyof ModelSamplingOverride> = ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stopSequences', 'responseFormat', 'parallelToolCalls', 'contextLimit']
      for (const k of keys) {
        let v: unknown
        if (modelUid && (modelSampling.value[modelUid] as Record<string, unknown>)?.[k] !== undefined)
          v = (modelSampling.value[modelUid] as Record<string, unknown>)[k]
        else if (providerId && getEffectiveSamplingValue(providerId, k as keyof ProviderSamplingConfig['global']) !== undefined)
          v = getEffectiveSamplingValue(providerId, k as keyof ProviderSamplingConfig['global'])
        else if (k === 'contextLimit' && providerId && providerContext.value.perProvider[providerId]?.contextLimit !== undefined)
          v = providerContext.value.perProvider[providerId]?.contextLimit
        else if (k === 'contextLimit' && providerContext.value.global.contextLimit !== undefined)
          v = providerContext.value.global.contextLimit
        if (v !== undefined)
          (out as Record<string, unknown>)[k] = v
      }
      return Object.keys(out).length > 0 ? out : undefined
    }
    /* eslint-enable ts/no-use-before-define */

    const providerContext = ref<ProviderContextConfig>({ global: {}, perProvider: {} })

    watch(providerContext, v => {
      if (!v || typeof v !== 'object') {
        providerContext.value = { global: {}, perProvider: {} }
        return
      }
      let mutated = false
      if (!v.global || typeof v.global !== 'object') {
        v.global = {}
        mutated = true
      }
      else {
        const g = v.global as Record<string, unknown>
        if (g.contextLimit !== undefined && (typeof g.contextLimit !== 'number' || g.contextLimit < 1024)) {
          if (typeof g.contextLimit === 'number' && g.contextLimit < 1024) {
            g.contextLimit = 1024
          }
          else if (typeof g.contextLimit !== 'number') {
            delete g.contextLimit
            mutated = true
          }
        }
        if (g.truncationStrategy !== undefined && !['auto', 'truncate', 'compact'].includes(g.truncationStrategy as string)) {
          delete g.truncationStrategy
          mutated = true
        }
      }
      if (!v.perProvider || typeof v.perProvider !== 'object') {
        v.perProvider = {}
        mutated = true
      }
      else {
        for (const [pid, entry] of Object.entries(v.perProvider as Record<string, Record<string, unknown>>)) {
          if (!entry || typeof entry !== 'object') {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
            continue
          }
          if (entry.contextLimit !== undefined && typeof entry.contextLimit !== 'number') {
            delete entry.contextLimit
            mutated = true
          }
          if (entry.truncationStrategy !== undefined && !['auto', 'truncate', 'compact'].includes(entry.truncationStrategy as string)) {
            delete entry.truncationStrategy
            mutated = true
          }
          if (Object.keys(entry).length === 0) {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
          }
        }
      }
      if (mutated)
        providerContext.value = { global: { ...v.global }, perProvider: { ...v.perProvider } }
    }, { immediate: true })

    function setProviderContext(
      providerId: string | null,
      key: keyof ProviderContextConfig['global'],
      value: number | string | null | undefined,
    ): void {
      if (providerId == null) {
        const nextGlobal = { ...providerContext.value.global } as Record<string, unknown>
        if (value == null) {
          delete nextGlobal[key as string]
        }
        else {
          if (key === 'contextLimit' && typeof value === 'number')
            nextGlobal[key as string] = Math.min(2000000, Math.max(1024, Math.round(value as number)))
          else
            nextGlobal[key as string] = value
        }
        providerContext.value = { ...providerContext.value, global: nextGlobal as ProviderContextConfig['global'] }
        return
      }
      const nextPer = { ...providerContext.value.perProvider }
      const cur = { ...(nextPer[providerId] ?? {}) } as Record<string, unknown>
      if (value == null) {
        delete cur[key as string]
      }
      else {
        if (key === 'contextLimit' && typeof value === 'number')
          cur[key as string] = Math.min(2000000, Math.max(1024, Math.round(value as number)))
        else
          cur[key as string] = value
      }
      if (Object.keys(cur).length === 0)
        delete nextPer[providerId]
      else nextPer[providerId] = cur as ProviderContextConfig['global']
      providerContext.value = { ...providerContext.value, perProvider: nextPer }
    }

    function getEffectiveContextLimit(providerId: string | null | undefined, modelUid?: string | null): number | undefined {
      if (modelUid && (modelSampling.value[modelUid] as ModelSamplingOverride)?.contextLimit !== undefined)
        return (modelSampling.value[modelUid] as ModelSamplingOverride).contextLimit
      if (providerId && providerContext.value.perProvider[providerId]?.contextLimit !== undefined)
        return providerContext.value.perProvider[providerId]?.contextLimit
      if (providerContext.value.global.contextLimit !== undefined)
        return providerContext.value.global.contextLimit
      return undefined
    }

    function getEffectiveTruncation(providerId: string | null | undefined): TruncationStrategy | undefined {
      if (providerId && providerContext.value.perProvider[providerId]?.truncationStrategy !== undefined)
        return providerContext.value.perProvider[providerId]?.truncationStrategy
      return providerContext.value.global.truncationStrategy
    }

    const providerReasoning = ref<ProviderReasoningConfig>({ global: {}, perProvider: {} })

    watch(providerReasoning, v => {
      if (!v || typeof v !== 'object') {
        providerReasoning.value = { global: {}, perProvider: {} }
        return
      }
      let mutated = false
      if (!v.global || typeof v.global !== 'object') {
        v.global = {}
        mutated = true
      }
      else {
        const g = v.global as Record<string, unknown>
        if (g.customBudgetTokens !== undefined && typeof g.customBudgetTokens !== 'number') {
          delete g.customBudgetTokens
          mutated = true
        }
      }
      if (!v.perProvider || typeof v.perProvider !== 'object') {
        v.perProvider = {}
        mutated = true
      }
      else {
        for (const [pid, entry] of Object.entries(v.perProvider as Record<string, Record<string, unknown>>)) {
          if (!entry || typeof entry !== 'object') {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
            continue
          }
          if (entry.customBudgetTokens !== undefined && typeof entry.customBudgetTokens !== 'number') {
            delete entry.customBudgetTokens
            mutated = true
          }
          if (Object.keys(entry).length === 0) {
            delete (v.perProvider as Record<string, unknown>)[pid]
            mutated = true
          }
        }
      }
      if (mutated)
        providerReasoning.value = { global: { ...v.global }, perProvider: { ...v.perProvider } }
    }, { immediate: true })

    function setProviderReasoning(
      providerId: string | null,
      key: keyof ProviderReasoningConfig['global'],
      value: number | null | undefined,
    ): void {
      if (providerId == null) {
        const nextGlobal = { ...providerReasoning.value.global } as Record<string, unknown>
        if (value == null || Number.isNaN(value))
          delete nextGlobal[key as string]
        else nextGlobal[key as string] = Math.min(100000, Math.max(512, Math.round(value as number)))
        providerReasoning.value = { ...providerReasoning.value, global: nextGlobal as ProviderReasoningConfig['global'] }
        return
      }
      const nextPer = { ...providerReasoning.value.perProvider }
      const cur = { ...(nextPer[providerId] ?? {}) } as Record<string, unknown>
      if (value == null || Number.isNaN(value))
        delete cur[key as string]
      else cur[key as string] = Math.min(100000, Math.max(512, Math.round(value as number)))
      if (Object.keys(cur).length === 0)
        delete nextPer[providerId]
      else nextPer[providerId] = cur as ProviderReasoningConfig['global']
      providerReasoning.value = { ...providerReasoning.value, perProvider: nextPer }
    }

    function getEffectiveReasoningBudget(providerId: string | null | undefined): number | undefined {
      if (providerId && providerReasoning.value.perProvider[providerId]?.customBudgetTokens !== undefined)
        return providerReasoning.value.perProvider[providerId]?.customBudgetTokens
      return providerReasoning.value.global.customBudgetTokens
    }

    function getEffectiveThinkingLevels(model: DiscoveredModel): ThinkingEffort[] {
      const opts = model.reasoningOptions
      if (opts?.length) {
        const effort = opts.find((o): o is { type: 'effort'; values: string[] } => o.type === 'effort')
        if (effort) {
          const map: Record<string, ThinkingEffort> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max', off: 'off' }
          const levels: ThinkingEffort[] = []
          for (const v of effort.values) {
            const mapped = map[v] ?? (v as ThinkingEffort)
            if (['off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(mapped) && !levels.includes(mapped))
              levels.push(mapped)
          }
          if (!levels.includes('off'))
            levels.unshift('off')
          return levels.length > 0 ? levels : (['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ThinkingEffort[])
        }
        const budget = opts.find((o): o is { type: 'budget_tokens'; min: number } => o.type === 'budget_tokens')
        if (budget)
          return ['off', 'low', 'medium', 'high', 'xhigh', 'max']
      }
      if (!model.supportsThinking)
        return ['off']
      return ['off', 'low', 'medium', 'high', 'xhigh', 'max']
    }
    // alias for new naming, keep both for compatibility
    const getThinkingLevels = getEffectiveThinkingLevels

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

    const subagentActiveModel = computed(
      () =>
        discoveredModels.value.find(m => m.uid === agent.value.subagentModelUid)
        ?? discoveredModels.value.find(m => m.uid === activeModelUid.value)
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

    function isToolEnabled(id: string, mode: 'build' | 'design' = 'build'): boolean {
      return !toolDisabledIds.value[mode].includes(id)
    }

    function setToolEnabled(id: string, enabled: boolean, mode: 'build' | 'design' = 'build'): void {
      if (enabled)
        toolDisabledIds.value = { ...toolDisabledIds.value, [mode]: toolDisabledIds.value[mode].filter(toolId => toolId !== id) }
      else if (!toolDisabledIds.value[mode].includes(id))
        toolDisabledIds.value = { ...toolDisabledIds.value, [mode]: [...toolDisabledIds.value[mode], id] }
    }

    function setToolsEnabled(ids: string[], enabled: boolean, mode: 'build' | 'design' = 'build'): void {
      const uniqueIds = [...new Set(ids)]
      if (enabled) {
        const disabled = new Set(toolDisabledIds.value[mode])
        uniqueIds.forEach(id => disabled.delete(id))
        toolDisabledIds.value = { ...toolDisabledIds.value, [mode]: [...disabled] }
        return
      }

      const next = new Set(toolDisabledIds.value[mode])
      uniqueIds.forEach(id => next.add(id))
      toolDisabledIds.value = { ...toolDisabledIds.value, [mode]: [...next] }
    }

    function getToolDisabledIds(mode: 'build' | 'design' = 'build'): string[] {
      return toolDisabledIds.value[mode]
    }

    // ── tool description overrides ───────────────────────────────────────────
    function setToolDescriptionOverride(toolId: string, description: string): void {
      toolDescriptionOverrides.value = { ...toolDescriptionOverrides.value, [toolId]: description }
    }

    function resetToolDescriptionOverride(toolId: string): void {
      const next = { ...toolDescriptionOverrides.value }
      delete next[toolId]
      toolDescriptionOverrides.value = next
    }

    function resetAllToolDescriptions(): void {
      toolDescriptionOverrides.value = {}
    }

    // ── prompt overrides ─────────────────────────────────────────────────────
    function setPromptOverride(promptId: string, content: string): void {
      promptOverrides.value = { ...promptOverrides.value, [promptId]: content }
    }

    function resetPromptOverride(promptId: string): void {
      const next = { ...promptOverrides.value }
      delete next[promptId]
      promptOverrides.value = next
    }

    function resetAllPrompts(): void {
      promptOverrides.value = {}
    }

    // ── security overrides ───────────────────────────────────────────────────
    function setSecurityOverride(id: string, content: string): void {
      securityOverrides.value = { ...securityOverrides.value, [id]: content }
    }

    function resetSecurityOverride(id: string): void {
      const next = { ...securityOverrides.value }
      delete next[id]
      securityOverrides.value = next
    }

    function resetAllSecurity(): void {
      securityOverrides.value = {}
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

    // ── voice providers ──────────────────────────────────────────────────────
    async function testSttProvider(provider: SttProvider): Promise<void> {
      const config = stt.value[provider]
      if (!config.apiKey.trim() && provider !== 'custom') {
        config.status = 'error'
        config.statusMessage = 'API key is required'
        return
      }
      if (provider === 'custom' && !config.baseUrl.trim()) {
        config.status = 'error'
        config.statusMessage = 'Base URL is required'
        return
      }
      config.status = 'testing'
      config.statusMessage = ''
      try {
        if (provider === 'openai' || provider === 'custom') {
          const url = `${config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`
          // Try a HEAD-like probe — create minimal valid multipart
          const fd = new FormData()
          fd.append('model', config.model)
          fd.append('file', new Blob([''], { type: 'audio/webm' }), 'test.webm')
          const res = await platformFetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: fd,
            signal: AbortSignal.timeout(10000),
          })
          // 401 = bad key, 2xx or 4xx (non-auth) = endpoint reachable
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'deepgram') {
          const res = await platformFetch(
            `${config.baseUrl.replace(/\/$/, '')}/v1/listen?model=${config.model}`,
            {
              method: 'POST',
              headers: { Token: config.apiKey, 'Content-Type': 'audio/webm' },
              body: new Blob([''], { type: 'audio/webm' }),
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'assemblyai') {
          const res = await platformFetch(`${config.baseUrl.replace(/\/$/, '')}/token`, {
            method: 'POST',
            headers: { Authorization: config.apiKey },
            signal: AbortSignal.timeout(10000),
          })
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'google') {
          const res = await platformFetch(
            `https://speech.googleapis.com/v1/speech:recognize?key=${config.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: { encoding: 'WEBM_OPUS', languageCode: config.language }, audio: { content: '' } }),
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401 || res.status === 403) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'azure') {
          const res = await platformFetch(
            `https://${config.language.replace(/-.+$/, '')}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${config.language}`,
            {
              method: 'POST',
              headers: { 'Ocp-Apim-Subscription-Key': config.apiKey },
              body: new Blob([''], { type: 'audio/webm' }),
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        config.status = 'ok'
        config.statusMessage = 'Connected \u2014 STT ready'
      }
      catch (e: unknown) {
        config.status = 'error'
        config.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (10s)'
            : e instanceof Error ? e.message : String(e)
      }
    }

    function resetSttStatus(provider: SttProvider): void {
      stt.value[provider].status = 'idle'
      stt.value[provider].statusMessage = ''
    }

    async function testTtsProvider(provider: TtsProvider): Promise<void> {
      const config = tts.value[provider]
      if (!config.apiKey.trim() && provider !== 'custom') {
        config.status = 'error'
        config.statusMessage = 'API key is required'
        return
      }
      if (provider === 'custom' && !config.baseUrl.trim()) {
        config.status = 'error'
        config.statusMessage = 'Base URL is required'
        return
      }
      config.status = 'testing'
      config.statusMessage = ''
      try {
        if (provider === 'openai' || provider === 'custom') {
          const url = `${config.baseUrl.replace(/\/$/, '')}/audio/speech`
          const res = await platformFetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: config.model, voice: config.voice, input: 'test' }),
            signal: AbortSignal.timeout(10000),
          })
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'elevenlabs') {
          const res = await platformFetch(
            `${config.baseUrl.replace(/\/$/, '')}/voices`,
            {
              method: 'GET',
              headers: { 'xi-api-key': config.apiKey },
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'deepgram') {
          const res = await platformFetch(
            `${config.baseUrl.replace(/\/$/, '')}/speak`,
            {
              method: 'POST',
              headers: { Token: config.apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: 'test', model: config.model }),
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'google') {
          const res = await platformFetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: { text: 'test' }, voice: { name: config.voice, languageCode: 'en-US' }, audioConfig: { audioEncoding: 'MP3' } }),
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401 || res.status === 403) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        else if (provider === 'azure') {
          const res = await platformFetch(
            'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1',
            {
              method: 'POST',
              headers: {
                'Ocp-Apim-Subscription-Key': config.apiKey,
                'Content-Type': 'application/ssml',
              },
              body: `<speak version='1.0' xml:lang='en-US'><voice name='${config.voice}'>test</voice></speak>`,
              signal: AbortSignal.timeout(10000),
            },
          )
          if (res.status === 401) {
            config.status = 'error'
            config.statusMessage = 'Invalid API key'
            return
          }
        }
        config.status = 'ok'
        config.statusMessage = 'Connected \u2014 TTS ready'
      }
      catch (e: unknown) {
        config.status = 'error'
        config.statusMessage
          = e instanceof Error && e.name === 'TimeoutError'
            ? 'Request timed out (10s)'
            : e instanceof Error ? e.message : String(e)
      }
    }

    function resetTtsStatus(provider: TtsProvider): void {
      tts.value[provider].status = 'idle'
      tts.value[provider].statusMessage = ''
    }

    function setSttProvider(provider: SttProvider): void {
      sttProvider.value = provider
    }

    function setTtsProvider(provider: TtsProvider): void {
      ttsProvider.value = provider
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
        permissionMode: (['ask', 'auto', 'yolo'] as string[]).includes(agent.value.permissionMode) ? agent.value.permissionMode : 'ask',
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
          modelUid: agent.value.sessionCompaction?.modelUid ?? null,
        },
        gitCoAuthor: agent.value.gitCoAuthor !== false,
        defaultModelUid: agent.value.defaultModelUid ?? null,
        subagentModelUid: agent.value.subagentModelUid ?? null,
      }
    }

    normalizeAgentConfig()

    // expose setter for future picker UI — compactionModelUid is optional
    function setCompactionModelUid(uid: string | null): void {
      agent.value.sessionCompaction.modelUid = uid
    }

    function getCompactionModelUid(): string | null {
      return agent.value.sessionCompaction.modelUid ?? null
    }

    // ── onboarding ────────────────────────────────────────────────────────
    function completeOnboarding() {
      completedOnboarding.value = true
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
      sttProvider,
      stt,
      testSttProvider,
      resetSttStatus,
      setSttProvider,
      ttsProvider,
      tts,
      testTtsProvider,
      resetTtsStatus,
      setTtsProvider,
      voiceProcessing,
      voiceDictionary,
      voiceSnippets,
      showSttMic,
      showBrowserButton,
      showLifecycleHooks,
      contextCaching,
      autoContext,
      memory,
      sound,
      developerMode,
      agent,
      completedOnboarding,
      completeOnboarding,
      providerAppearance,
      setGlobalAppearance,
      setProviderAppearance,
      shouldHideThinking,
      shouldDisableThinkingMarkdown,
      shouldDisableAssistantMarkdown,
      providerSampling,
      setGlobalSampling,
      setProviderSampling,
      getEffectiveSamplingValue,
      getEffectiveSampling,
      modelSampling,
      setModelSampling,
      getEffectiveModelSampling,
      providerContext,
      setProviderContext,
      getEffectiveContextLimit,
      getEffectiveTruncation,
      providerReasoning,
      setProviderReasoning,
      getEffectiveReasoningBudget,
      getEffectiveThinkingLevels,
      getThinkingLevels,
      toolDisabledIds,
      getToolDisabledIds,
      toolDescriptionOverrides,
      setToolDescriptionOverride,
      resetToolDescriptionOverride,
      resetAllToolDescriptions,
      promptOverrides,
      setPromptOverride,
      resetPromptOverride,
      resetAllPrompts,
      securityOverrides,
      setSecurityOverride,
      resetSecurityOverride,
      resetAllSecurity,
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
      subagentActiveModel,
      enabledModels,
      setCompactionModelUid,
      getCompactionModelUid,
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
        'sttProvider',
        'stt',
        'ttsProvider',
        'tts',
        'voiceProcessing',
        'voiceDictionary',
        'voiceSnippets',
        'showSttMic',
        'showBrowserButton',
        'showLifecycleHooks',
        'sound',
        'contextCaching',
        'autoContext',
        'memory',
        'developerMode',
        'agent',
        'completedOnboarding',
        'toolDisabledIds',
        'toolDescriptionOverrides',
        'promptOverrides',
        'securityOverrides',
        'disabledSkillIds',
        'compatibleProviders',
        'mcpServers',
        'discoveredModels',
        'activeModelUid',
        'providerAppearance',
        'providerSampling',
        'modelSampling',
        'providerContext',
        'providerReasoning',
      ],
    },
  },
)
