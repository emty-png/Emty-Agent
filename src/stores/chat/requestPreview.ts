import type { JSONSchema7, SystemModelMessage } from 'ai'
import type { Attachment, ChatTab, Message } from './types'
import type { CompatibleProvider, DiscoveredModel, McpServerConfig } from '@/stores/settings/types'
import type { ToolSet } from '@/utils/ai'
import { asSchema } from 'ai'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { filterDisabledTools } from '@/utils/tools/catalog'
import { buildMcpAliasedTools } from '@/utils/tools/mcpAliases'
import { buildMentionContext } from './mentions'
import { normalizeContentParts, normalizeModelMessages } from './requestPreviewParts'
import { toModelMessages } from './utils'
import { resolveTabWorkspacePath } from './workspace'

export type EstimatorProviderConfig = {
  type: 'openai'
  apiKey: string
  baseURL: string
  organizationId?: string
} | {
  type: 'anthropic'
  apiKey: string
  baseURL: string
} | {
  type: 'google'
  apiKey: string
} | {
  type: 'compatible'
  apiKey: string
  baseURL: string
  name: string
  compatibleProvider: CompatibleProvider
  isOllama: boolean
}

export interface PromptToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema7
}

export interface PreviewPromptPartText {
  type: 'text'
  text: string
}

export interface PreviewPromptPartImage {
  type: 'image'
  dataUrl: string
  mimeType?: string
}

export type PreviewPromptPart = PreviewPromptPartText | PreviewPromptPartImage

export interface PreviewPromptMessage {
  role: 'system' | 'user' | 'assistant'
  parts: PreviewPromptPart[]
}

export interface ChatRequestPreview {
  activeModel: DiscoveredModel
  provider: EstimatorProviderConfig
  contextLimit: number | null
  maxOutputTokens: number
  inputMessages: PreviewPromptMessage[]
  toolDefinitions: PromptToolDefinition[]
  systemPrompt: string
  thinkingBudgetTokens: number
  providerOptions?: Record<string, Record<string, unknown>>
}

let osInfoPromise: Promise<Awaited<ReturnType<typeof import('@/utils/os').getOsInfo>> | undefined> | null = null

function getCachedOsInfo() {
  if (!osInfoPromise) {
    osInfoPromise = import('@/utils/os')
      .then(({ getOsInfo }) => getOsInfo().catch(() => undefined))
  }
  return osInfoPromise
}

export async function buildChatRequestPreview(options: {
  tab: ChatTab
  content: string

  attachments?: Attachment[]
}): Promise<ChatRequestPreview | null> {
  const { tab, content, attachments = [] } = options
  const settings = useSettingsStore()
  const project = useProjectStore()
  const workspacePath = resolveTabWorkspacePath(tab, project.projectPath)

  const activeModel = resolveActiveModel(tab, settings)
  if (!activeModel)
    return null

  const provider = resolveProvider(activeModel, settings)
  if (!provider)
    return null

  const osInfo = await getCachedOsInfo()
  const [
    { buildProviderOptions, buildSystemPrompt, mergeProviderOptions },
    { buildAgentSystemPrompt },
    {
      applyMentionContextToMessages,
      buildCachedSystemPrompt,
      buildContextCachingProviderOptions,
    },
    { inspectWorkspace, buildWorkspacePromptContext },
    { buildMemoryPromptContext },
    { buildRecoveryPromptContext },
  ] = await Promise.all([
    import('@/utils/ai'),
    import('@/utils/agentContext'),
    import('@/utils/contextCaching'),
    import('@/utils/worktrees'),
    import('@/utils/memory'),
    import('@/utils/failureRecovery'),
  ])

  const workspace = await inspectWorkspace(workspacePath)

  const text = content.trim()
  const maxOutputTokens = activeModel.supportsThinking
    ? activeModel.thinkingEffort === 'high'
      ? 16000
      : activeModel.thinkingEffort === 'low'
        ? 2048
        : 8000
    : 4096

  const cacheRuntime = {
    settings: settings.contextCaching,
    providerId: activeModel.providerId,
    modelId: activeModel.id,
    projectPath: workspacePath,
    scope: 'chat:build',
    promptFingerprint: '',
  }

  const [memoryContext, recoveryContext] = await Promise.all([
    buildMemoryPromptContext(settings.memory, workspace),
    buildRecoveryPromptContext(tab.conversationId),
  ])

  const promptBuild = await buildAgentSystemPrompt({
    basePrompt: buildSystemPrompt(workspacePath, 'build', osInfo, settings.agent.gitCoAuthor),
    projectPath: workspacePath,
    requestText: text,
    autoContext: settings.autoContext,
    disabledSkillIds: settings.disabledSkillIds,
    supportsToolCalls: activeModel.supportsToolCalls,
    workspaceContext: buildWorkspacePromptContext(workspace),
    memoryContext,
    recoveryContext,
  })

  cacheRuntime.promptFingerprint = promptBuild.promptFingerprint

  const systemPrompt = buildCachedSystemPrompt(promptBuild.prompt, cacheRuntime)
  const draftMessages: Message[] = [
    ...tab.messages,
    {
      id: '__preview__',
      role: 'user' as const,
      content: text,
      timestamp: new Date(),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  ]

  const readRegistry = new Map<string, { hash: string; complete: boolean; mtimeMs: number | null; sizeBytes: number }>()
  const mentionContext = await buildMentionContext(text, workspacePath, readRegistry).catch(() => '')
  const apiMessages = applyMentionContextToMessages(
    toModelMessages(draftMessages),
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

  const inputMessages = [
    ...normalizeSystemPrompt(systemPrompt),
    ...normalizeModelMessages(apiMessages),
    ...buildToolEventMessages(draftMessages),
    ...buildReasoningMessages(draftMessages),
  ]

  const toolDefinitions = activeModel.supportsToolCalls
    ? await buildToolDefinitions({
        projectPath: workspacePath,
        memoryEnabled: settings.memory.enabled,
        mcpServers: settings.mcpServers,
        disabledToolIds: settings.disabledToolIds,
        readRegistry,
        ...(osInfo?.shell ? { shell: osInfo.shell } : {}),
        coAuthor: settings.agent.gitCoAuthor,
      })
    : []

  return {
    activeModel,
    provider,
    contextLimit: activeModel.contextLimit,
    maxOutputTokens,
    inputMessages,
    toolDefinitions,
    systemPrompt: flattenPromptMessages(inputMessages.filter(message => message.role === 'system')),
    thinkingBudgetTokens: getReasoningBudgetTokens(activeModel, providerOptions),
    ...(providerOptions ? { providerOptions } : {}),
  }
}

function resolveActiveModel(
  tab: ChatTab,
  settings: ReturnType<typeof useSettingsStore>,
): DiscoveredModel | null {
  const resolvedModelUid = tab.modelUid ?? settings.activeModelUid
  return settings.enabledModels.find(m => m.uid === resolvedModelUid) ?? settings.activeModel
}

function resolveProvider(
  activeModel: DiscoveredModel,
  settings: ReturnType<typeof useSettingsStore>,
): EstimatorProviderConfig | null {
  switch (activeModel.providerId) {
    case 'openai':
      return {
        type: 'openai',
        apiKey: settings.openai.apiKey,
        baseURL: settings.openai.baseURL,
        ...(settings.openai.organizationId.trim()
          ? { organizationId: settings.openai.organizationId.trim() }
          : {}),
      }
    case 'anthropic':
      return {
        type: 'anthropic',
        apiKey: settings.anthropic.apiKey,
        baseURL: settings.anthropic.baseURL,
      }
    case 'google':
      return {
        type: 'google',
        apiKey: settings.google.apiKey,
      }
    default: {
      const compatibleProvider = settings.compatibleProviders.find(provider => provider.id === activeModel.providerId)
      if (!compatibleProvider)
        return null

      return {
        type: 'compatible',
        apiKey: compatibleProvider.apiKey,
        baseURL: compatibleProvider.baseURL,
        name: compatibleProvider.name,
        compatibleProvider,
        isOllama: (compatibleProvider.mdevId ?? compatibleProvider.name.toLowerCase()) === 'ollama'
          || compatibleProvider.name.toLowerCase() === 'ollama',
      }
    }
  }
}

function normalizeSystemPrompt(systemPrompt: string | SystemModelMessage[]): PreviewPromptMessage[] {
  if (typeof systemPrompt === 'string') {
    const parts: PreviewPromptPart[] = systemPrompt.trim()
      ? [{ type: 'text', text: systemPrompt }]
      : []

    return [
      {
        role: 'system' as const,
        parts,
      },
    ].filter(message => message.parts.length > 0)
  }

  return systemPrompt
    .map(message => ({
      role: 'system' as const,
      parts: normalizeContentParts(message.content),
    }))
    .filter(message => message.parts.length > 0)
}

/**
 * Build synthetic preview messages from tool events stored on assistant messages.
 * Each tool call + result pair is serialized as text so the estimator accounts
 * for the token cost of multi-turn tool loops.
 */
function buildToolEventMessages(messages: Message[]): PreviewPromptMessage[] {
  const result: PreviewPromptMessage[] = []

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.toolEvents?.length)
      continue

    // Only include events that lack persisted args (legacy / pre-persistence data)
    const legacyEvents = message.toolEvents.filter(e => e.args === undefined)
    if (legacyEvents.length === 0)
      continue

    const toolText = legacyEvents
      .map(event => {
        const parts = [`[Tool call: ${event.toolName}]`]
        if (event.label)
          parts.push(`Label: ${event.label}`)
        parts.push(`Status: ${event.status}`)
        return parts.join('\n')
      })
      .join('\n\n')

    if (toolText.trim()) {
      result.push({
        role: 'assistant',
        parts: [{ type: 'text', text: toolText }],
      })
    }
  }

  return result
}

/**
 * Build synthetic preview messages from reasoning/thinking parts on assistant
 * messages. Reasoning content is part of the conversation history for thinking
 * models and consumes tokens.
 */
function buildReasoningMessages(messages: Message[]): PreviewPromptMessage[] {
  const result: PreviewPromptMessage[] = []

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parts?.length)
      continue

    const reasoningText = message.parts
      .filter((p): p is { type: 'reasoning'; text: string } => p.type === 'reasoning' && !!p.text)
      .map(p => p.text)
      .join('\n')

    if (reasoningText.trim()) {
      result.push({
        role: 'assistant',
        parts: [{ type: 'text', text: reasoningText }],
      })
    }
  }

  return result
}

async function buildToolDefinitions(options: {
  projectPath: string | null
  memoryEnabled: boolean
  mcpServers: McpServerConfig[]
  disabledToolIds: string[]
  readRegistry?: Map<string, { hash: string; complete: boolean; mtimeMs: number | null; sizeBytes: number }>
  shell?: 'sh' | 'powershell'
  coAuthor?: boolean
}): Promise<PromptToolDefinition[]> {
  const { projectPath, memoryEnabled, mcpServers, disabledToolIds, readRegistry, shell, coAuthor } = options
  const [
    { createFilesystemTools },
    { createQuestionsTool },
    { createMemoryTools },
    { createShellTools },
    { createSkillTools },
    { createSpawnSubAgentTool },
    { createTaskTools },
    { createWebTools },
    { createBrowserTools },
  ] = await Promise.all([
    import('@/utils/tools/filesystem'),
    import('@/utils/tools/questions'),
    import('@/utils/tools/memory'),
    import('@/utils/tools/shell'),
    import('@/utils/tools/skills'),
    import('@/utils/tools/subagent'),
    import('@/utils/tools/todos'),
    import('@/utils/tools/web'),
    import('@/utils/tools/browser'),
  ])

  const noopSpawn = async () => ({
    tabId: '__preview__',
    completionPromise: Promise.resolve({
      text: '',
      status: 'done' as const,
    }),
  })

  const { reset: _resetTasks, ...taskTools } = createTaskTools(() => {})
  const toolSet: ToolSet = {
    ask_questions: createQuestionsTool((_questions, resolve) => resolve([])),
    ...taskTools,
    ...createMemoryTools(memoryEnabled, null),
    ...createSkillTools(projectPath),
    spawn_subagent: createSpawnSubAgentTool(noopSpawn, () => {}),
    ...createWebTools(),
    ...createBrowserTools('__preview__'),
  }

  if (projectPath) {
    Object.assign(toolSet, createFilesystemTools(projectPath, undefined, readRegistry))
    Object.assign(toolSet, createShellTools(projectPath, shell, coAuthor))
  }

  const builtInTools = Object.entries(filterDisabledTools(toolSet, disabledToolIds)).map(([name, tool]) => ({
    name,
    description: tool.description ?? '',
    inputSchema: asSchema(tool.inputSchema).jsonSchema as JSONSchema7,
  }))

  return [
    ...builtInTools,
    ...buildMcpToolDefinitions(mcpServers, disabledToolIds),
  ]
}

function buildMcpToolDefinitions(servers: McpServerConfig[], disabledToolIds: string[]): PromptToolDefinition[] {
  return buildMcpAliasedTools(
    servers.filter(server => server.enabled && server.command.trim()),
  )
    .filter(tool => !disabledToolIds.includes(tool.alias))
    .map(tool => ({
      name: tool.alias,
      description: [
        `MCP tool from ${tool.serverName}.`,
        tool.toolTitle ? `Title: ${tool.toolTitle}.` : '',
        tool.toolDescription || 'No description provided.',
      ].filter(Boolean).join(' '),
      inputSchema: tool.inputSchema as JSONSchema7,
    }))
}

function flattenPromptMessages(messages: PreviewPromptMessage[]): string {
  return messages
    .flatMap(message => message.parts)
    .filter((part): part is PreviewPromptPartText => part.type === 'text')
    .map(part => part.text)
    .join('\n\n')
}

function getReasoningBudgetTokens(
  activeModel: DiscoveredModel,
  providerOptions: Record<string, Record<string, unknown>> | undefined,
): number {
  if (!activeModel.supportsThinking)
    return 0

  const anthropicBudget = providerOptions?.anthropic?.thinking
  if (
    typeof anthropicBudget === 'object'
    && anthropicBudget !== null
    && 'budgetTokens' in anthropicBudget
    && typeof anthropicBudget.budgetTokens === 'number'
  ) {
    return anthropicBudget.budgetTokens
  }

  return activeModel.providerId === 'openai'
    ? 0
    : fallbackThinkingBudgetTokens(activeModel.thinkingEffort)
}

function fallbackThinkingBudgetTokens(effort: 'low' | 'medium' | 'high'): number {
  switch (effort) {
    case 'low':
      return 2048
    case 'high':
      return 32000
    default:
      return 16000
  }
}
