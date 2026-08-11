import type { LanguageModel, ModelMessage, SystemModelMessage } from 'ai'
import type { ChatTab } from '@/stores/chat/core/types'
import type { McpServerConfig } from '@/stores/settings/types'
import type { ProviderCredentials, StreamChatFinishEvent } from '@/utils/ai'
import type { WorkspaceSnapshot } from '@/utils/worktrees'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelConfig {
  id: string
  uid: string
  providerId: string
  supportsToolCalls: boolean
  supportsThinking: boolean
  thinkingEffort: 'low' | 'medium' | 'high'
  contextLimit?: number | null
  sdkType?: 'openai' | 'anthropic' | 'google' | null
}

export interface SettingsForContext {
  activeModel: ModelConfig | null
  activeModelUid: string
  enabledModels: ModelConfig[]
  openai: { apiKey: string; baseURL?: string; organizationId?: string }
  anthropic: { apiKey: string; baseURL?: string }
  google: { apiKey: string }
  compatibleProviders?: Array<{ id: string; apiKey: string; baseURL: string; name: string; headers?: Record<string, string> }>
  contextCaching: { enabled: boolean; anthropicTtl: '5m' | '1h'; openaiPromptCacheRetention: 'in_memory' | '24h'; googleCachedContent: string }
  autoContext: { enabled: boolean }
  memory: { enabled: boolean }
  agent: { permissionMode: 'ask' | 'auto' | 'yolo'; gitCoAuthor: boolean; subagents?: { isolation: 'inherit' | 'worktree' }; defaultModelUid?: string | null }
  disabledSkillIds: string[]
  mcpServers: McpServerConfig[]
  getToolDisabledIds: (mode?: 'build' | 'design') => string[]
}

export interface AgentRunContext {
  tab: ChatTab
  model: LanguageModel
  activeModel: ModelConfig
  systemPrompt: string | SystemModelMessage[]
  apiMessages: ModelMessage[]
  maxOutputTokens: number
  providerOptions: Record<string, Record<string, unknown>> | undefined
  effectiveProjectPath: string | null
  workspaceSnapshot: WorkspaceSnapshot | null
  resolvedModelUid: string
  now: number
  replayId: string | null
  promptBuildResult: { prompt: string | SystemModelMessage[]; promptFingerprint: string }
  cacheRuntime: {
    settings: SettingsForContext['contextCaching']
    providerId: string
    modelId: string
    projectPath: string | null
    scope: string
    promptFingerprint: string
  }
}

export interface BuildRunContextOpts {
  tab: ChatTab
  settings: SettingsForContext
  requestText: string
  mentionContext: string
  modelOverride?: string | null
  osInfo?: { shell?: 'sh' | 'powershell'; [key: string]: unknown }
}

// ── Builder ───────────────────────────────────────────────────────────────────

export async function buildRunContext(opts: BuildRunContextOpts): Promise<AgentRunContext> {
  const { tab, settings, requestText, mentionContext, modelOverride, osInfo } = opts

  const now = Date.now()

  const [
    { buildLanguageModel, buildProviderOptions, buildSystemPrompt, mergeProviderOptions },
    { buildAgentSystemPrompt },
    { buildToolCatalogGroups },
    { applyMentionContextToMessages, buildCachedSystemPrompt, buildContextCachingProviderOptions },
    { inspectWorkspace, buildWorkspacePromptContext },
    { buildMemoryPromptContext, buildMemoryNudge },
    { buildRecoveryPromptContext },
    { resolveLanguageModel, resolveMaxTokens },
    { toModelMessages },
    { newReplayId },
    { getEffectiveDisabledSkillIds },
    { resolveTabWorkspacePath },
  ] = await Promise.all([
    import('@/utils/ai'),
    import('@/utils/agentContext'),
    import('@/utils/tools/catalog'),
    import('@/utils/contextCaching'),
    import('@/utils/worktrees'),
    import('@/utils/memory'),
    import('@/utils/failureRecovery'),
    import('@/stores/chat/utils/modelResolver'),
    import('@/stores/chat/context/messageSerializer'),
    import('@/utils/evals'),
    import('@/utils/perTabOverrides'),
    import('@/stores/chat/utils/workspace'),
  ])

  const { useProjectStore } = await import('@/stores/project')
  const project = useProjectStore()

  const requestedWorkspacePath = resolveTabWorkspacePath(tab, project.projectPath)
  const workspaceSnapshot = await inspectWorkspace(requestedWorkspacePath)
  const effectiveProjectPath = workspaceSnapshot?.path ?? requestedWorkspacePath ?? null

  const resolvedModelUid = modelOverride ?? tab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid
  const activeModel = (settings.enabledModels.find(m => m.uid === resolvedModelUid) ?? settings.activeModel) as ModelConfig | null
  if (!activeModel)
    throw new Error('NO_MODEL')

  const model = resolveLanguageModel(activeModel, settings, buildLanguageModel as (creds: ProviderCredentials, id: string) => LanguageModel)
  const maxOutputTokens = resolveMaxTokens(activeModel, 16_384)

  const effectiveDisabledSkillIds = getEffectiveDisabledSkillIds(tab, settings.disabledSkillIds)

  const cacheRuntime = {
    settings: settings.contextCaching,
    providerId: activeModel.providerId,
    modelId: activeModel.id,
    projectPath: effectiveProjectPath,
    scope: 'chat:build',
    promptFingerprint: '',
  }

  const [memoryContext, recoveryContext] = await Promise.all([
    buildMemoryPromptContext(settings.memory, workspaceSnapshot),
    buildRecoveryPromptContext(tab.conversationId),
  ])

  const turnCount = tab.messages.filter(m => m.role === 'user').length
  const memoryNudge = buildMemoryNudge(turnCount)

  const toolMode = tab.mode === 'design' ? 'design' : 'build'
  const disabledToolIds = settings.getToolDisabledIds(toolMode)
  const disabledSet = new Set(disabledToolIds)
  const toolCatalogGroups = buildToolCatalogGroups(settings.mcpServers)
    .map(group => ({
      ...group,
      tools: group.tools.filter(tool => !disabledSet.has(tool.id)),
    }))
    .filter(group => group.tools.length > 0)

  const promptBuildResult = await buildAgentSystemPrompt({
    basePrompt: buildSystemPrompt(effectiveProjectPath, tab.mode || 'build', osInfo as import('@/utils/os').OsInfo | undefined, settings.agent.gitCoAuthor),
    projectPath: effectiveProjectPath,
    requestText,
    autoContext: settings.autoContext,
    disabledSkillIds: effectiveDisabledSkillIds,
    supportsToolCalls: activeModel.supportsToolCalls,
    mode: tab.mode,
    workspaceContext: buildWorkspacePromptContext(workspaceSnapshot),
    memoryContext,
    memoryNudge,
    recoveryContext,
    toolCatalogGroups,
  })

  cacheRuntime.promptFingerprint = promptBuildResult.promptFingerprint

  const systemPrompt = buildCachedSystemPrompt(promptBuildResult.prompt, cacheRuntime)

  const apiMessages = applyMentionContextToMessages(
    toModelMessages(tab.messages.slice(0, -1), { skipLastMessageMentionContext: true }),
    mentionContext,
    cacheRuntime,
  )

  const providerOptions = mergeProviderOptions(
    buildProviderOptions({
      providerId: activeModel.providerId,
      modelId: activeModel.id,
      supportsThinking: activeModel.supportsThinking,
      thinkingEffort: activeModel.thinkingEffort,
    }),
    buildContextCachingProviderOptions(cacheRuntime),
  )

  const replayId = tab.conversationId ? newReplayId() : null

  return {
    tab,
    model,
    activeModel,
    systemPrompt,
    apiMessages,
    maxOutputTokens,
    providerOptions,
    effectiveProjectPath,
    workspaceSnapshot,
    resolvedModelUid,
    now,
    replayId,
    promptBuildResult,
    cacheRuntime,
  }
}

export type { StreamChatFinishEvent }
