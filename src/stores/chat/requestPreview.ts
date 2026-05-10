import type { JSONSchema7, SystemModelMessage } from 'ai'
import type { Attachment, ChatMode, ChatTab, Message } from './types'
import type { CompatibleProvider, DiscoveredModel, McpServerConfig } from '@/stores/settings/types'
import type { ToolSet } from '@/utils/ai'
import { asSchema } from 'ai'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { buildMentionContext } from './mentions'
import { normalizeContentParts, normalizeModelMessages } from './requestPreviewParts'
import { toModelMessages } from './utils'

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
  mode: ChatMode
  attachments?: Attachment[]
}): Promise<ChatRequestPreview | null> {
  const { tab, content, mode, attachments = [] } = options
  const settings = useSettingsStore()
  const project = useProjectStore()

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
  ] = await Promise.all([
    import('@/utils/ai'),
    import('@/utils/agentContext'),
    import('@/utils/contextCaching'),
  ])

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
    projectPath: project.projectPath,
    scope: `chat:${mode}`,
    promptFingerprint: '',
  }

  const promptBuild = await buildAgentSystemPrompt({
    basePrompt: buildSystemPrompt(project.projectPath, mode, osInfo),
    projectPath: project.projectPath,
    requestText: text,
    autoContext: settings.autoContext,
    disabledSkillIds: settings.disabledSkillIds,
    supportsToolCalls: activeModel.supportsToolCalls,
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

  const mentionContext = await buildMentionContext(text, project.projectPath).catch(() => '')
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
        projectPath: project.projectPath,
        mcpServers: settings.mcpServers,
        ...(osInfo?.shell ? { shell: osInfo.shell } : {}),
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
  mcpServers: McpServerConfig[]
  shell?: 'sh' | 'powershell'
}): Promise<PromptToolDefinition[]> {
  const { projectPath, mcpServers, shell } = options
  const [
    { createFilesystemTools },
    { createQuestionsTool },
    { createShellTools },
    { createSkillTools },
    { createSpawnSubAgentTool },
    { createWriteTodoTool },
    { createWebTools },
  ] = await Promise.all([
    import('@/utils/tools/filesystem'),
    import('@/utils/tools/questions'),
    import('@/utils/tools/shell'),
    import('@/utils/tools/skills'),
    import('@/utils/tools/subagent'),
    import('@/utils/tools/todos'),
    import('@/utils/tools/web'),
  ])

  const noopSpawn = async () => ({
    tabId: '__preview__',
    completionPromise: Promise.resolve({
      text: '',
      status: 'done' as const,
    }),
  })

  const toolSet: ToolSet = {
    ask_questions: createQuestionsTool((_questions, resolve) => resolve([])),
    write_todo: createWriteTodoTool(() => {}),
    ...createSkillTools(projectPath),
    spawn_subagent: createSpawnSubAgentTool(noopSpawn, () => {}),
    ...createWebTools(),
  }

  if (projectPath) {
    Object.assign(toolSet, createFilesystemTools(projectPath))
    Object.assign(toolSet, shell ? createShellTools(projectPath, shell) : createShellTools(projectPath))
  }

  const builtInTools = Object.entries(toolSet).map(([name, tool]) => ({
    name,
    description: tool.description ?? '',
    inputSchema: asSchema(tool.inputSchema).jsonSchema as JSONSchema7,
  }))

  return [
    ...builtInTools,
    ...buildMcpToolDefinitions(mcpServers),
  ]
}

function buildMcpToolDefinitions(servers: McpServerConfig[]): PromptToolDefinition[] {
  return servers
    .filter(server => server.enabled && server.command.trim())
    .flatMap(server => {
      const seenAliases = new Set<string>()

      return server.tools.map(tool => {
        const alias = makeUniqueAlias(aliasFor(server.name, tool.name), seenAliases)
        const description = [
          `MCP tool from ${server.name}.`,
          tool.title ? `Title: ${tool.title}.` : '',
          tool.description || 'No description provided.',
        ].filter(Boolean).join(' ')

        return {
          name: alias,
          description,
          inputSchema: tool.inputSchema as JSONSchema7,
        }
      })
    })
}

function aliasFor(serverName: string, toolName: string): string {
  return `mcp__${slugify(serverName)}__${slugify(toolName)}`
}

function makeUniqueAlias(base: string, usedAliases: Set<string>): string {
  if (!usedAliases.has(base)) {
    usedAliases.add(base)
    return base
  }

  let index = 2
  while (usedAliases.has(`${base}__${index}`))
    index++

  const alias = `${base}__${index}`
  usedAliases.add(alias)
  return alias
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'server'
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
