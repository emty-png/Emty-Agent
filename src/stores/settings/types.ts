import type { MDevContextOver200k, MDevCostTier, MDevReasoningOption } from '@/utils/modelsdev'
import type { SkillMetadata } from '@/utils/skills'
import type { ToolPermissionMode } from '@/utils/tools/permissions'

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

export type WebSearchProvider = 'duckduckgo' | 'tavily' | 'exa' | 'brave' | 'serper'

export interface DuckDuckGoConfig {
  status: ConnectionStatus
  statusMessage: string
}

export interface ExaConfig {
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}

export interface BraveConfig {
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}

export interface SerperConfig {
  apiKey: string
  status: ConnectionStatus
  statusMessage: string
}

// ── Image generation providers ────────────────────────────────────────────

export type ImageGenProvider
  = | 'google'
    | 'openai'
    | 'stability'
    | 'fal'
    | 'replicate'
    | 'together'
    | 'fireworks'
    | 'custom'

export interface ImageGenProviderConfig {
  apiKey: string
  baseURL?: string
  model: string
  status: ConnectionStatus
  statusMessage: string
  discoveredModels: DiscoveredImageModel[]
}

export interface DiscoveredImageModel {
  id: string
  name: string
}

export interface ImageGenModelOption {
  id: string
  name: string
}

export interface CompatibleProviderModel {
  id: string // raw model ID sent to the API
  name: string // display name
  contextLimit?: number // manual context window override
}

export interface CompatibleProvider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  mdevId?: string
  headers?: Record<string, string>
  models?: CompatibleProviderModel[]
  status: ConnectionStatus
  statusMessage: string
}

export interface McpToolSummary {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio'
  enabled: boolean
  command: string
  argsText: string
  cwd: string
  envText: string
  toolCount: number
  tools: McpToolSummary[]
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
  costReasoning: number | null
  costTiers: MDevCostTier[] | null
  costContextOver200k: MDevContextOver200k | null
  knowledgeCutoff: string | null
  releaseDate: string | null
  lastUpdated: string | null
  status: 'alpha' | 'beta' | 'deprecated' | null
  reasoningOptions: MDevReasoningOption[] | null
  sdkType: 'openai' | 'anthropic' | 'google' | null
}

export interface ContextCachingConfig {
  enabled: boolean
  anthropicTtl: '5m' | '1h'
  openaiPromptCacheRetention: 'in_memory' | '24h'
  googleCachedContent: string
}

export interface AutoContextConfig {
  enabled: boolean
}

export interface MemoryConfig {
  enabled: boolean
}

export interface AgentSubagentConfig {
  isolation: 'inherit' | 'worktree'
}

export interface AgentSessionCompactionConfig {
  auto: boolean
  thresholdPercent: number
  showManualButton: boolean
}

export interface AgentConfig {
  permissionMode: ToolPermissionMode
  subagents: AgentSubagentConfig
  sessionCompaction: AgentSessionCompactionConfig
  gitCoAuthor: boolean
}

export interface ConfiguredSkill extends SkillMetadata {
  enabled: boolean
}

export interface SoundConfig {
  completionEnabled: boolean
  errorEnabled: boolean
  volume: number // 0–100
}

export interface TestResult {
  ok: boolean
  message: string
}
