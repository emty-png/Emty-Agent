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
export interface CompatibleProvider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  mdevId?: string
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
  knowledgeCutoff: string | null
  releaseDate: string | null
  lastUpdated: string | null
  status: 'alpha' | 'beta' | 'deprecated' | null
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

export interface AgentConfig {
  permissionMode: ToolPermissionMode
}

export interface ConfiguredSkill extends SkillMetadata {
  enabled: boolean
}

export interface ProviderPreset {
  name: string
  baseURL: string
  requiresKey: boolean
  description: string
}

export interface TestResult {
  ok: boolean
  message: string
}
