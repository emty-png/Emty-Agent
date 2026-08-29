import type { LanguageModel, ModelMessage, SystemModelMessage } from 'ai'
import type { ChatTab } from '@/stores/chat/core/types'
import type {
  McpServerConfig,
  ModelSamplingConfig,
  ProviderContextConfig,
  ProviderReasoningConfig,
  ProviderSamplingConfig,
} from '@/stores/settings/types'
import type { ProviderCredentials, StreamChatFinishEvent } from '@/utils/ai'
import type { WorkspaceSnapshot } from '@/utils/worktrees'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelConfig {
  id: string
  uid: string
  providerId: string
  supportsToolCalls: boolean
  supportsThinking: boolean
  thinkingEffort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  contextLimit?: number | null
  sdkType?: 'openai' | 'anthropic' | 'google' | null
  transport?: 'responses'
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
  promptOverrides: Record<string, string>
  getToolDisabledIds: (mode?: 'build' | 'design') => string[]
  providerSampling?: ProviderSamplingConfig
  modelSampling?: ModelSamplingConfig
  providerContext?: ProviderContextConfig
  providerReasoning?: ProviderReasoningConfig
  getEffectiveSamplingValue?: (providerId: string | null | undefined, key: keyof ProviderSamplingConfig['global']) => unknown
  getEffectiveSampling?: (providerId: string | null | undefined) => ProviderSamplingConfig['global']
  getEffectiveModelSampling?: (modelUid: string | null | undefined, providerId: string | null | undefined) => unknown
  getEffectiveContextLimit?: (providerId: string | null | undefined, modelUid?: string | null) => number | undefined
  getEffectiveReasoningBudget?: (providerId: string | null | undefined) => number | undefined
}

export interface AgentRunContext {
  tab: ChatTab
  model: LanguageModel
  activeModel: ModelConfig
  systemPrompt: string | SystemModelMessage[]
  apiMessages: ModelMessage[]
  maxOutputTokens: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  stopSequences?: string[]
  responseFormat?: 'text' | 'json_object' | 'json_schema'
  parallelToolCalls?: boolean
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
  let maxOutputTokens = resolveMaxTokens(activeModel, 16_384)
  const providerIdForSampling = activeModel.providerId
  const modelUidForSampling = activeModel.uid

  function resolveGenerationValue<K extends keyof NonNullable<SettingsForContext['providerSampling']>['global']>(key: K): NonNullable<SettingsForContext['providerSampling']>['global'][K] | undefined {
    // model-level first
    const modelVal = (settings.modelSampling as Record<string, Record<string, unknown>> | undefined)?.[modelUidForSampling]?.[key as string]
    if (modelVal !== undefined)
      return modelVal as NonNullable<SettingsForContext['providerSampling']>['global'][K]
    if (settings.getEffectiveSamplingValue) {
      const v = settings.getEffectiveSamplingValue(providerIdForSampling, key)
      if (v !== undefined)
        return v as NonNullable<SettingsForContext['providerSampling']>['global'][K]
    }
    if (!settings.providerSampling)
      return undefined
    const per = settings.providerSampling.perProvider[providerIdForSampling]?.[key]
    if (per !== undefined)
      return per as NonNullable<SettingsForContext['providerSampling']>['global'][K]
    return settings.providerSampling.global[key]
  }

  const temperature = resolveGenerationValue('temperature') as number | undefined
  const topP = resolveGenerationValue('topP') as number | undefined
  const topK = resolveGenerationValue('topK') as number | undefined
  const frequencyPenalty = resolveGenerationValue('frequencyPenalty') as number | undefined
  const presencePenalty = resolveGenerationValue('presencePenalty') as number | undefined
  const seed = resolveGenerationValue('seed') as number | undefined
  const stopSequences = resolveGenerationValue('stopSequences') as string[] | undefined
  const responseFormat = resolveGenerationValue('responseFormat') as 'text' | 'json_object' | 'json_schema' | undefined
  const parallelToolCalls = resolveGenerationValue('parallelToolCalls') as boolean | undefined
  const samplingMaxTokens = resolveGenerationValue('maxTokens') as number | undefined
  if (samplingMaxTokens !== undefined)
    maxOutputTokens = samplingMaxTokens

  // reasoning custom budget override
  let customReasoningBudget: number | undefined
  if (settings.getEffectiveReasoningBudget) {
    customReasoningBudget = settings.getEffectiveReasoningBudget(providerIdForSampling)
  }
  else if (settings.providerReasoning) {
    const per = settings.providerReasoning.perProvider[providerIdForSampling]?.customBudgetTokens
    if (per !== undefined)
      customReasoningBudget = per
    else customReasoningBudget = settings.providerReasoning.global.customBudgetTokens
  }
  if (customReasoningBudget !== undefined && activeModel.supportsThinking) {
    // Custom budget must not become maxOutputTokens directly — max must be budget + output slack
    // otherwise Anthropic returns invalid_param (budget >= max_tokens) as 400/500 and stream aborts after thinking.
    maxOutputTokens = Math.max(maxOutputTokens, customReasoningBudget + 8192)
  }

  // ── Guard: if maxOutputTokens is still <= thinking budget, inflate it. Catches legacy resolveMaxTokens values.
  if (activeModel.supportsThinking && activeModel.thinkingEffort !== 'off') {
    const budgetMap: Record<string, number> = { off: 0, low: 2048, medium: 16000, high: 32000, xhigh: 48000, max: 100000 }
    const budget = budgetMap[activeModel.thinkingEffort] ?? 0
    if (budget > 0 && maxOutputTokens <= budget) {
      maxOutputTokens = budget + 8192
    }
  }

  // context limit override (effective for estimation/compaction, not generation)
  let effectiveContextLimit: number | undefined
  if (settings.getEffectiveContextLimit) {
    effectiveContextLimit = settings.getEffectiveContextLimit(providerIdForSampling, modelUidForSampling)
  }
  else {
    const modelCtx = (settings.modelSampling as Record<string, Record<string, unknown>> | undefined)?.[modelUidForSampling]?.contextLimit as number | undefined
    if (modelCtx !== undefined) {
      effectiveContextLimit = modelCtx
    }
    else if (settings.providerContext) {
      const perCtx = settings.providerContext.perProvider[providerIdForSampling]?.contextLimit
      if (perCtx !== undefined)
        effectiveContextLimit = perCtx
      else effectiveContextLimit = settings.providerContext.global.contextLimit
    }
  }
  const effectiveActiveModel: ModelConfig = effectiveContextLimit !== undefined
    ? { ...activeModel, contextLimit: effectiveContextLimit }
    : activeModel

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
    basePrompt: buildSystemPrompt(effectiveProjectPath, tab.mode || 'build', osInfo as import('@/utils/os').OsInfo | undefined, settings.agent.gitCoAuthor, settings.promptOverrides),
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

  let providerOptions = mergeProviderOptions(
    buildProviderOptions({
      providerId: effectiveActiveModel.providerId,
      modelId: effectiveActiveModel.id,
      supportsThinking: effectiveActiveModel.supportsThinking,
      thinkingEffort: effectiveActiveModel.thinkingEffort,
    }),
    buildContextCachingProviderOptions(cacheRuntime),
  )

  // generation-specific provider options (responseFormat, parallelToolCalls)
  if (responseFormat !== undefined || parallelToolCalls !== undefined) {
    const genOpts: Record<string, Record<string, unknown>> = {}
    if (responseFormat !== undefined) {
      // OpenAI expects { type: 'json_object' } etc; Google uses responseMimeType
      if (effectiveActiveModel.providerId === 'openai' || effectiveActiveModel.sdkType === 'openai') {
        genOpts.openai = { ...(genOpts.openai ?? {}), responseFormat: responseFormat === 'text' ? { type: 'text' } : { type: 'json_object' } }
      }
      else if (effectiveActiveModel.providerId === 'google' || effectiveActiveModel.sdkType === 'google') {
        genOpts.google = { ...(genOpts.google ?? {}), responseMimeType: responseFormat === 'json_object' ? 'application/json' : 'text/plain' }
      }
      else {
        genOpts.openai = { ...(genOpts.openai ?? {}), responseFormat: responseFormat === 'text' ? { type: 'text' } : { type: 'json_object' } }
      }
    }
    if (parallelToolCalls !== undefined) {
      genOpts.openai = { ...(genOpts.openai ?? {}), parallelToolCalls }
    }
    providerOptions = mergeProviderOptions(providerOptions, genOpts as never)
  }

  const replayId = tab.conversationId ? newReplayId() : null

  return {
    tab,
    model,
    activeModel: effectiveActiveModel,
    systemPrompt,
    apiMessages,
    maxOutputTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
    ...(presencePenalty !== undefined ? { presencePenalty } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(stopSequences !== undefined ? { stopSequences } : {}),
    ...(responseFormat !== undefined ? { responseFormat } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
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
