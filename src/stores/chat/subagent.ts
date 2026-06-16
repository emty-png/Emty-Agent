import type { ChatTab, Message, SubAgentPersonality } from './types'
import type { LanguageModel, ProviderCredentials, StreamChatOptions, ToolSet } from '@/utils/ai'
import type { OsInfo } from '@/utils/os'
import type { BeforeFileWriteCallback, FileReadRegistry, FilesystemTools } from '@/utils/tools/fs'
import type { RequestToolPermission, ToolPermissionDecision } from '@/utils/tools/permissions'
import type { SubAgentOutcome } from '@/utils/tools/subagent'
import { dbInsertConversation, dbInsertMessage, dbUpdateMessage } from '@/db/database'
import { buildAgentSystemPrompt } from '@/utils/agentContext'
import { buildProviderOptions, mergeProviderOptions } from '@/utils/ai'
import {
  buildCachedSystemPrompt,
  buildContextCachingProviderOptions,
  extractUsageStats,
} from '@/utils/contextCaching'
import { filterDisabledTools } from '@/utils/tools/catalog'
import { createMcpTools } from '@/utils/tools/mcp'
import { wrapToolSetWithPermissions } from '@/utils/tools/permissions'
import { SequentialToolQueue, wrapToolSetSequentially } from '@/utils/tools/sequential'
import { createSkillTools } from '@/utils/tools/skills'
import { resolveLanguageModel, resolveMaxTokens } from './models'
import { createStreamHandlers } from './streamHandlers'
import { getCoreToolDisplayLabel } from './toolLabels'
import { makeId } from './utils'

export interface SubAgentStreamParams {
  subTab: ChatTab
  personality: SubAgentPersonality
  mission: string
  signal: AbortSignal
  // Core AI functions passed in to avoid circular dependencies
  buildLanguageModel: (creds: ProviderCredentials, modelId: string) => LanguageModel
  streamChat: (opts: StreamChatOptions) => Promise<void>
  buildSubAgentSystemPrompt: (p: SubAgentPersonality, path: string | null, osInfo?: OsInfo) => string
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
    thinkingEffort: 'low' | 'medium' | 'high'
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
    permissionMode: 'ask' | 'auto'
    subagents: {
      isolation: 'inherit' | 'worktree'
    }
    gitCoAuthor: boolean
  }
  disabledToolIds: string[]
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

  const activeModel = settings.activeModel
  if (!activeModel) {
    subTab.messages.push({
      id: makeId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      error: 'No model selected. Open Settings → Providers to connect a model.',
    })
    subTab.isStreaming = false
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
    subTab.isStreaming = false
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
  ] = await Promise.all([
    import('@/utils/worktrees'),
    import('@/utils/memory'),
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
  let tools: Record<string, unknown> = {}
  const browserTools = filterDisabledTools(
    createBrowserTools(subTab.id) as Record<string, unknown>,
    settings.disabledToolIds,
  )

  switch (personality) {
    case 'explorer': {
      tools = { ...browserTools }
      if (effectiveProjectPath) {
        const fsTools = filterDisabledTools(
          createFilesystemTools(effectiveProjectPath, undefined, readRegistry),
          settings.disabledToolIds,
        )
        tools = {
          ...tools,
          list_directory: fsTools.list_directory,
          read_files: fsTools.read_files,
          glob: fsTools.glob,
          grep: fsTools.grep,
        }
      }
      break
    }

    case 'researcher': {
      const webTools = filterDisabledTools(
        createWebTools() as Record<string, unknown>,
        settings.disabledToolIds,
      )
      tools = { ...webTools, ...browserTools }
      break
    }

    case 'debugger': {
      if (effectiveProjectPath) {
        const fsTools = filterDisabledTools(
          createFilesystemTools(effectiveProjectPath, undefined, readRegistry),
          settings.disabledToolIds,
        )
        tools = {
          list_directory: fsTools.list_directory,
          read_files: fsTools.read_files,
          glob: fsTools.glob,
          grep: fsTools.grep,
        }
      }
      const webTools = filterDisabledTools(
        createWebTools() as Record<string, unknown>,
        settings.disabledToolIds,
      )
      tools = { ...tools, ...webTools, ...browserTools }
      break
    }

    case 'general': {
      const webTools = filterDisabledTools(
        createWebTools() as Record<string, unknown>,
        settings.disabledToolIds,
      )
      tools = { ...webTools, ...browserTools }
      if (effectiveProjectPath) {
        const fsTools = filterDisabledTools(
          createFilesystemTools(effectiveProjectPath, undefined, readRegistry),
          settings.disabledToolIds,
        )
        const shellTools = filterDisabledTools(
          createShellTools(effectiveProjectPath, osInfo?.shell, settings.agent.gitCoAuthor) as Record<string, unknown>,
          settings.disabledToolIds,
        )
        tools = { ...tools, ...fsTools, ...shellTools }
      }
      break
    }
  }

  async function requestPermissionForTool(request: Parameters<RequestToolPermission>[0]) {
    if (settings.agent.permissionMode === 'auto')
      return 'allow-once' as const

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

  // IMPORTANT: retrieve liveMsg from the reactive array — NOT the raw object.
  // Vue wraps array elements in a Proxy; writing to the raw object bypasses
  // reactivity and the UI never re-renders during streaming.
  const liveMsg = subTab.messages[subTab.messages.length - 1]!

  // Create DB conversation and initial messages in the background
  const convId = makeId()
  subTab.conversationId = convId
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
    settings.disabledToolIds,
  )
  const skillTools = filterDisabledTools(createSkillTools(effectiveProjectPath), settings.disabledToolIds)
  const mergedTools = filterDisabledTools({ ...tools, ...skillTools, ...mcpTools }, settings.disabledToolIds)
  const permissionWrappedTools = Object.keys(mergedTools).length > 0
    ? wrapToolSetWithPermissions(mergedTools as ToolSet, {
        tabId: subTab.id,
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
    basePrompt: buildSubAgentSystemPrompt(personality, effectiveProjectPath, osInfo),
    projectPath: effectiveProjectPath,
    requestText: mission,
    autoContext: settings.autoContext,
    disabledSkillIds: settings.disabledSkillIds,
    supportsToolCalls: Object.keys(mergedTools).length > 0,
    workspaceContext: buildWorkspacePromptContext(workspace),
    memoryContext: await buildMemoryPromptContext(settings.memory, workspace),
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
        subTab.isStreaming = false
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
          }).catch(e => console.error('[subagent] final update failed', e))

          onAbort(subTab.id)
          resolve({ text: liveMsg.content, status: 'done' })
        })()
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        subTab.isStreaming = false
        if (subTab.subAgent)
          subTab.subAgent.status = 'error'
        void (async () => {
          if (isolatedWorktree)
            await cleanupAgentWorktree(isolatedWorktree)

          await dbUpdateMessage(liveMsg.id, {
            is_complete: 1,
          }).catch(() => {})

          onAbort(subTab.id)
          resolve({ text: '', status: 'error' })
        })()
      },
      signal,
    }).catch(() => {
      subTab.isStreaming = false
      if (subTab.subAgent)
        subTab.subAgent.status = 'error'
      void (async () => {
        if (isolatedWorktree)
          await cleanupAgentWorktree(isolatedWorktree)

        await dbUpdateMessage(liveMsg.id, {
          is_complete: 1,
        }).catch(() => {})

        onAbort(subTab.id)
        resolve({ text: '', status: 'error' })
      })()
    })
  })
}
