import type { ChatTab, Message, SubAgentPersonality } from '@/stores/chat/core/types'
import type { LanguageModel, ProviderCredentials, StreamChatOptions, ToolSet } from '@/utils/ai'
import type { OsInfo } from '@/utils/os'
import type { BeforeFileWriteCallback, FileReadRegistry, FilesystemTools } from '@/utils/tools/fs'
import type { RequestToolPermission, ToolPermissionDecision } from '@/utils/tools/permissions'
import type { SubAgentOutcome } from '@/utils/tools/subagent'
import { dbInsertConversation, dbInsertMessage, dbUpdateMessage } from '@/db/database'
import { statusToolRunning, statusWaitingPermission } from '@/stores/chat/agent/status'
import { createStreamHandlers } from '@/stores/chat/agent/streamHandlers'
import { getCoreToolDisplayLabel } from '@/stores/chat/tools/labels'
import { resolveLanguageModel, resolveMaxTokens } from '@/stores/chat/utils/modelResolver'
import { makeId } from '@/stores/chat/utils/tabFactory'
import { buildAgentSystemPrompt } from '@/utils/agentContext'
import { buildProviderOptions, mergeProviderOptions } from '@/utils/ai'
import {
  buildCachedSystemPrompt,
  buildContextCachingProviderOptions,
  extractUsageStats,
} from '@/utils/contextCaching'
import { buildToolCatalogGroups, filterDisabledTools } from '@/utils/tools/catalog'
import { createMcpTools } from '@/utils/tools/mcp'
import { wrapToolSetWithPermissions } from '@/utils/tools/permissions'
import { SequentialToolQueue, wrapToolSetSequentially } from '@/utils/tools/sequential'
import { createSkillTools } from '@/utils/tools/skills'

export interface SubAgentStreamParams {
  subTab: ChatTab
  personality: SubAgentPersonality
  mission: string
  signal: AbortSignal
  // Core AI functions passed in to avoid circular dependencies
  buildLanguageModel: (creds: ProviderCredentials, modelId: string) => LanguageModel
  streamChat: (opts: StreamChatOptions) => Promise<void>
  buildSubAgentSystemPrompt: (p: SubAgentPersonality, path: string | null, osInfo?: OsInfo, promptOverrides?: Record<string, string>) => string
  settings: SettingsSnapshot
  project: ProjectSnapshot
  osInfo: OsInfo | undefined
  // Tool factories
  createFilesystemTools: (projectPath: string, onBeforeFileWrite?: BeforeFileWriteCallback, registry?: FileReadRegistry) => FilesystemTools
  createShellTools: (path: string, shell?: 'sh' | 'powershell', coAuthor?: boolean) => unknown
  createWebTools: () => unknown
  createBrowserTools: (ownerId: string) => unknown
  // Permission and lifecycle
  requestToolPermission: (tabId: string, request: Parameters<RequestToolPermission>[0]) => Promise<ToolPermissionDecision>
  onAbort: (tabId: string) => void
}

/** Minimal snapshot of the settings store needed by sub-agents. */
interface ProviderSnapshot {
  id: string
  apiKey: string
  baseURL: string
  name: string
  headers?: Record<string, string>
}

interface SettingsSnapshot {
  activeModel: {
    id: string
    providerId: string
    supportsThinking: boolean
    thinkingEffort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    sdkType?: 'openai' | 'anthropic' | 'google' | null
  } | null
  subagentActiveModel: {
    id: string
    providerId: string
    supportsThinking: boolean
    thinkingEffort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    sdkType?: 'openai' | 'anthropic' | 'google' | null
  } | null
  openai: { apiKey: string; baseURL?: string; organizationId?: string }
  anthropic: { apiKey: string; baseURL?: string }
  google: { apiKey: string }
  contextCaching: {
    enabled: boolean
    anthropicTtl: '5m' | '1h'
    openaiPromptCacheRetention: 'in_memory' | '24h'
    googleCachedContent: string
  }
  autoContext: {
    enabled: boolean
  }
  memory: {
    enabled: boolean
  }
  agent: {
    permissionMode: 'ask' | 'auto' | 'yolo'
    subagents: {
      isolation: 'inherit' | 'worktree'
    }
    gitCoAuthor: boolean
  }
  getToolDisabledIds: (mode?: 'build' | 'design') => string[]
  disabledSkillIds: string[]
  mcpServers?: Array<{
    id: string
    name: string
    enabled: boolean
    command: string
    argsText: string
    cwd: string
    envText: string
  }>
  compatibleProviders?: ProviderSnapshot[]
  toolDescriptionOverrides: Record<string, string>
  promptOverrides: Record<string, string>
}

interface ProjectSnapshot {
  projectPath: string | null
}

export async function runSubAgentStream(params: SubAgentStreamParams): Promise<SubAgentOutcome> {
  const {
    subTab,
    personality,
    mission,
    signal,
    buildLanguageModel,
    streamChat,
    buildSubAgentSystemPrompt,
    settings,
    project,
    osInfo,
    createFilesystemTools,
    createShellTools,
    createWebTools,
    createBrowserTools,
    requestToolPermission,
    onAbort,
  } = params

  // Each sub-agent gets its own file read registry — no cross-tab dedup interference
  const readRegistry: FileReadRegistry = new Map()

  const activeModel = settings.subagentActiveModel ?? settings.activeModel
  if (!activeModel) {
    subTab.messages.push({
      id: makeId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      error: 'No model selected. Open Settings → Providers to connect a model.',
    })
    subTab.agentStatus = { type: 'error', message: 'No model selected' }
    if (subTab.subAgent)
      subTab.subAgent.status = 'error'
    return { text: '', status: 'error' }
  }

  // ── Model initialization ───────────────────────────────────────────────
  let languageModel: LanguageModel
  try {
    languageModel = resolveLanguageModel(activeModel, settings, buildLanguageModel)
  }
  catch (e) {
    const errMsg = `Failed to initialise model: ${e instanceof Error ? e.message : String(e)}`
    subTab.messages.push({ id: makeId(), role: 'assistant', content: '', timestamp: new Date(), error: errMsg })
    subTab.agentStatus = { type: 'error', message: errMsg }
    if (subTab.subAgent)
      subTab.subAgent.status = 'error'
    return { text: '', status: 'error' }
  }

  const maxOutputTokens = resolveMaxTokens(activeModel, 4096)

  // Tool set scoped by personality
  const projectPath = project.projectPath
  const [
    { inspectWorkspace, buildWorkspacePromptContext, createAgentWorktree, cleanupAgentWorktree },
    { buildMemoryPromptContext },
    { createMemoryTools },
  ] = await Promise.all([
    import('@/utils/worktrees'),
    import('@/utils/memory'),
    import('@/utils/tools/memory'),
  ])
  let effectiveProjectPath = projectPath
  let isolationNote = ''
  let isolatedWorktree: Awaited<ReturnType<typeof createAgentWorktree>> = null

  if (
    projectPath
    && settings.agent.subagents.isolation === 'worktree'
    && (personality === 'general' || personality === 'debugger')
  ) {
    try {
      isolatedWorktree = await createAgentWorktree(projectPath, `${personality}-${subTab.id}`)
      if (isolatedWorktree) {
        effectiveProjectPath = isolatedWorktree.path
        subTab.workspacePath = isolatedWorktree.path
        isolationNote = `\n\n[Sub-agent workspace isolated in git worktree: ${isolatedWorktree.path} (${isolatedWorktree.branch})]`
      }
    }
    catch (error) {
      isolationNote = `\n\n[Sub-agent worktree isolation unavailable: ${error instanceof Error ? error.message : String(error)}]`
    }
  }

  const workspace = await inspectWorkspace(effectiveProjectPath)
  subTab.workspaceMeta = workspace
  const fsTools: Record<string, unknown> = effectiveProjectPath
    ? filterDisabledTools(
        createFilesystemTools(effectiveProjectPath, undefined, readRegistry),
        settings.getToolDisabledIds('build'),
      )
    : {}
  const webTools = filterDisabledTools(
    createWebTools() as Record<string, unknown>,
    settings.getToolDisabledIds('build'),
  )
  const shellTools: Record<string, unknown> = effectiveProjectPath
    ? filterDisabledTools(
        createShellTools(effectiveProjectPath, osInfo?.shell, settings.agent.gitCoAuthor) as Record<string, unknown>,
        settings.getToolDisabledIds('build'),
      )
    : {}

  const browserTools = filterDisabledTools(
    createBrowserTools(subTab.id) as Record<string, unknown>,
    settings.getToolDisabledIds('build'),
  )

  let tools: Record<string, unknown> = { ...browserTools }

  if (personality === 'explorer' || personality === 'debugger') {
    tools = {
      ...tools,
      list_directory: fsTools.list_directory,
      read_files: fsTools.read_files,
      glob: fsTools.glob,
      grep: fsTools.grep,
    }
  }

  if (personality !== 'explorer') {
    tools = { ...tools, ...webTools }
  }

  if (personality === 'general') {
    tools = { ...tools, ...fsTools, ...shellTools }
  }

  const effectivePermissionMode = subTab.permissionMode ?? settings.agent.permissionMode

  async function requestPermissionForTool(request: Parameters<RequestToolPermission>[0]): Promise<ToolPermissionDecision> {
    if (effectivePermissionMode === 'yolo')
      return 'allow-once'
    if (effectivePermissionMode === 'auto') {
      const { reviewToolCall } = await import('@/utils/tools/autoReview')
      const verdict = await reviewToolCall(request, languageModel)
      if (verdict === 'safe')
        return 'allow-once'
      return await requestToolPermission(subTab.id, request)
    }
    return await requestToolPermission(subTab.id, request)
  }

  // Push the mission as a user message
  const missionMsg: Message = {
    id: makeId(),
    role: 'user',
    content: mission,
    timestamp: new Date(),
  }
  subTab.messages.push(missionMsg)

  // Push empty assistant placeholder
  const assistantId = makeId()
  const assistantMsg: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    toolEvents: [],
    parts: [],
  }
  subTab.messages.push(assistantMsg)
  subTab.agentStatus = { type: 'initializing' }

  // IMPORTANT: retrieve liveMsg from the reactive array — NOT the raw object.
  // Vue wraps array elements in a Proxy; writing to the raw object bypasses
  // reactivity and the UI never re-renders during streaming.
  const liveMsg = subTab.messages[subTab.messages.length - 1]!

  // Create DB conversation and initial messages in the background
  const convId = subTab.conversationId!
  void (async () => {
    try {
      await dbInsertConversation({
        id: convId,
        title: subTab.title,
        created_at: Date.now(),
        updated_at: Date.now(),
        workspace_path: effectiveProjectPath,
        workspace_meta: workspace ? JSON.stringify(workspace) : null,
        is_subagent: 1,
      })
      await dbInsertMessage({
        id: missionMsg.id,
        conversation_id: convId,
        role: 'user',
        content: missionMsg.content,
        created_at: missionMsg.timestamp.getTime(),
        is_complete: 1,
      })
      await dbInsertMessage({
        id: liveMsg.id,
        conversation_id: convId,
        role: 'assistant',
        content: liveMsg.content,
        created_at: liveMsg.timestamp.getTime(),
        is_complete: 0,
      })
    }
    catch (e) {
      console.error('[subagent] Failed to insert conversation/messages into DB', e)
    }
  })()

  const streamHandlers = createStreamHandlers({
    liveMsg,
    getToolLabel: getCoreToolDisplayLabel,
    getTabStatus: () => subTab.agentStatus,
    onStatusChange: (status, meta) => {
      if (status === 'tool-running' && meta?.toolName) {
        subTab.agentStatus = statusToolRunning(meta.toolName)
      }
      else if (status === 'streaming') {
        subTab.agentStatus = { type: 'streaming' }
      }
      else if (status === 'sleeping') {
        subTab.agentStatus = { type: 'sleeping' }
      }
      else if (status === 'waiting-permission' && meta?.toolName) {
        subTab.agentStatus = statusWaitingPermission(meta.toolName)
      }
      else if (status === 'waiting-questions') {
        subTab.agentStatus = { type: 'waiting-questions' }
      }
    },
  })

  const cacheRuntime = {
    settings: settings.contextCaching,
    providerId: activeModel.providerId,
    modelId: activeModel.id,
    projectPath,
    scope: `subagent:${personality}`,
    promptFingerprint: '',
  }
  const mcpTools = filterDisabledTools(
    await createMcpTools(settings.mcpServers ?? []),
    settings.getToolDisabledIds('build'),
  )
  const skillTools = filterDisabledTools(createSkillTools(effectiveProjectPath), settings.getToolDisabledIds('build'))
  const memoryTools = filterDisabledTools(createMemoryTools(settings.memory.enabled, workspace) as Record<string, unknown>, settings.getToolDisabledIds('build'))
  const mergedTools = filterDisabledTools({ ...tools, ...skillTools, ...mcpTools, ...memoryTools }, settings.getToolDisabledIds('build'))

  // Apply tool description overrides
  const { applyDescriptionOverrides } = await import('@/utils/tools/toolDescriptions')
  const toolsWithOverrides = applyDescriptionOverrides(mergedTools as Record<string, { description?: string }>, settings.toolDescriptionOverrides)

  const disabledToolIds = settings.getToolDisabledIds('build')
  const disabledSet = new Set(disabledToolIds)
  const toolCatalogGroups = buildToolCatalogGroups((settings.mcpServers ?? []) as import('@/stores/settings/types').McpServerConfig[])
    .map(group => ({
      ...group,
      tools: group.tools.filter(tool => !disabledSet.has(tool.id)),
    }))
    .filter(group => group.tools.length > 0)
  const permissionWrappedTools = Object.keys(toolsWithOverrides).length > 0
    ? wrapToolSetWithPermissions(toolsWithOverrides as ToolSet, {
        tabId: subTab.id,
        workspacePath: effectiveProjectPath,
        projectName: effectiveProjectPath ? effectiveProjectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null : null,
        requestPermission: requestPermissionForTool,
        getToolLabel: getCoreToolDisplayLabel,
        onToolExecutionStart: streamHandlers.onToolExecutionStart,
      })
    : undefined

  const toolQueue = new SequentialToolQueue()
  const runtimeTools = permissionWrappedTools
    ? wrapToolSetSequentially(permissionWrappedTools, toolQueue)
    : undefined

  const promptBuild = await buildAgentSystemPrompt({
    basePrompt: buildSubAgentSystemPrompt(personality, effectiveProjectPath, osInfo, settings.promptOverrides),
    projectPath: effectiveProjectPath,
    requestText: mission,
    autoContext: settings.autoContext,
    disabledSkillIds: settings.disabledSkillIds,
    supportsToolCalls: Object.keys(mergedTools).length > 0,
    workspaceContext: buildWorkspacePromptContext(workspace),
    memoryContext: await buildMemoryPromptContext(settings.memory, workspace),
    toolCatalogGroups,
  })

  cacheRuntime.promptFingerprint = promptBuild.promptFingerprint

  const systemPrompt = buildCachedSystemPrompt(
    promptBuild.prompt,
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

  return new Promise<SubAgentOutcome>(resolve => {
    streamChat({
      model: languageModel,
      messages: [{ role: 'user', content: mission }],
      systemPrompt,
      ...(providerOptions ? { providerOptions } : {}),
      maxOutputTokens,
      supportsToolCalls: Object.keys(mergedTools).length > 0,
      tools: runtimeTools,
      onDelta: streamHandlers.onDelta,
      onReasoningDelta: streamHandlers.onReasoningDelta,
      onToolCall: streamHandlers.onToolCall,
      onToolResult: streamHandlers.onToolResult,
      onFinish: ({ fullText, usage }) => {
        liveMsg.content = `${fullText}${isolationNote}`.trim()
        const usageStats = extractUsageStats(usage, activeModel.providerId)
        if (usageStats)
          liveMsg.cacheStats = usageStats
        else
          delete liveMsg.cacheStats
        subTab.agentStatus = { type: 'idle' }
        if (subTab.subAgent)
          subTab.subAgent.status = 'done'
        void (async () => {
          let cleanupNote = ''
          if (isolatedWorktree) {
            const cleanup = await cleanupAgentWorktree(isolatedWorktree)
            if (cleanup.removed) {
              subTab.workspacePath = projectPath
              subTab.workspaceMeta = await inspectWorkspace(projectPath)
            }
            if (cleanup.reason)
              cleanupNote = `\n\n[${cleanup.reason}]`
          }
          if (cleanupNote)
            liveMsg.content = `${liveMsg.content}${cleanupNote}`.trim()

          await dbUpdateMessage(liveMsg.id, {
            content: liveMsg.content,
            parts: JSON.stringify(liveMsg.parts),
            tool_events: JSON.stringify(liveMsg.toolEvents),
            cache_stats: liveMsg.cacheStats ? JSON.stringify(liveMsg.cacheStats) : null,
            is_complete: 1,
            ...(liveMsg.elapsedSec != null ? { elapsed_sec: liveMsg.elapsedSec } : {}),
          }).catch(e => console.error('[subagent] final update failed', e))

          onAbort(subTab.id)
          resolve({ text: liveMsg.content, status: 'done' })
        })()
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        subTab.agentStatus = { type: 'error', message: error.message }
        if (subTab.subAgent)
          subTab.subAgent.status = 'error'
        void (async () => {
          if (isolatedWorktree)
            await cleanupAgentWorktree(isolatedWorktree)

          await dbUpdateMessage(liveMsg.id, {
            is_complete: 1,
          }).catch(() => {})

          const { classifyFailure } = await import('@/utils/failureRecovery')
          const { fireHooks, projectNameFromPath } = await import('@/utils/hooks')
          const failure = classifyFailure(error)
          if (failure.category !== 'stream_aborted') {
            fireHooks('StopFailure', {
              event: 'StopFailure',
              tabId: subTab.id,
              workspacePath: effectiveProjectPath,
              projectName: projectNameFromPath(effectiveProjectPath),
              conversationId: subTab.conversationId ?? null,
              errorMessage: error.message,
              errorCategory: failure.category,
              retryable: false,
              attemptCount: 0,
              toolCallsCount: liveMsg.toolEvents?.length ?? 0,
            })
          }

          onAbort(subTab.id)
          resolve({ text: '', status: 'error' })
        })()
      },
      signal,
    }).catch(() => {
      subTab.agentStatus = { type: 'error', message: 'Stream failed' }
      if (subTab.subAgent)
        subTab.subAgent.status = 'error'
      void (async () => {
        if (isolatedWorktree)
          await cleanupAgentWorktree(isolatedWorktree)

        await dbUpdateMessage(liveMsg.id, {
          is_complete: 1,
        }).catch(() => {})

        const { fireHooks, projectNameFromPath } = await import('@/utils/hooks')
        fireHooks('StopFailure', {
          event: 'StopFailure',
          tabId: subTab.id,
          workspacePath: effectiveProjectPath,
          projectName: projectNameFromPath(effectiveProjectPath),
          conversationId: subTab.conversationId ?? null,
          errorMessage: 'Stream failed',
          errorCategory: 'stream_error',
          retryable: false,
          attemptCount: 0,
          toolCallsCount: liveMsg.toolEvents?.length ?? 0,
        })

        onAbort(subTab.id)
        resolve({ text: '', status: 'error' })
      })()
    })
  })
}
