import type { ChatTab, Message, SubAgentPersonality } from './types'
import type { LanguageModel, StreamChatOptions, ToolCallEvent, ToolResultEvent, ToolSet } from '@/utils/ai'
import type { OsInfo } from '@/utils/os'
import type { FilesystemTools } from '@/utils/tools/filesystem'
import type { SubAgentOutcome } from '@/utils/tools/subagent'
import { makeId } from './utils'

export interface SubAgentStreamParams {
  subTab: ChatTab
  personality: SubAgentPersonality
  mission: string
  signal: AbortSignal
  // These are passed in to avoid circular dependencies or redundant dynamic imports
  buildLanguageModel: (creds: ProviderCredentials, modelId: string) => LanguageModel
  streamChat: (opts: StreamChatOptions) => Promise<void>
  buildSubAgentSystemPrompt: (p: SubAgentPersonality, path: string | null, osInfo?: OsInfo) => string
  settings: SettingsSnapshot
  project: ProjectSnapshot
  osInfo: OsInfo | undefined
  toolDisplayLabel: (name: string, args: Record<string, unknown>) => string
  shellToolDisplayLabel: (name: string, args: Record<string, unknown>) => string
  webToolDisplayLabel: (name: string, args: Record<string, unknown>) => string
  artifactToolDisplayLabel: (name: string, args: Record<string, unknown>) => string
  createFilesystemTools: (path: string) => FilesystemTools
  createShellTools: (path: string, shell?: 'sh' | 'powershell') => unknown
  createWebTools: () => unknown
  createCreateArtifactTool: () => unknown
  onAbort: (tabId: string) => void
}

/** Minimal snapshot of the settings store needed by sub-agents. */
interface ProviderSnapshot {
  id: string
  apiKey: string
  baseURL: string
  name: string
}

interface SettingsSnapshot {
  activeModel: {
    id: string
    providerId: string
    supportsThinking: boolean
    thinkingEffort: 'low' | 'medium' | 'high'
  } | null
  openai: { apiKey: string; baseURL?: string; organizationId?: string }
  anthropic: { apiKey: string; baseURL?: string }
  google: { apiKey: string }
  compatibleProviders?: ProviderSnapshot[]
}

interface ProjectSnapshot {
  projectPath: string | null
}

interface ProviderCredentials {
  type: 'openai' | 'anthropic' | 'google' | 'compatible'
  apiKey?: string | undefined
  baseURL?: string | undefined
  organizationId?: string | undefined
  name?: string | undefined
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
    toolDisplayLabel,
    shellToolDisplayLabel,
    webToolDisplayLabel,
    artifactToolDisplayLabel,
    createFilesystemTools,
    createShellTools,
    createWebTools,
    createCreateArtifactTool,
    onAbort,
  } = params

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

  // Build language model — same as parent
  let languageModel: LanguageModel
  try {
    const pid = activeModel.providerId
    if (pid === 'openai') {
      languageModel = buildLanguageModel(
        { type: 'openai', apiKey: settings.openai.apiKey, baseURL: settings.openai.baseURL, organizationId: settings.openai.organizationId },
        activeModel.id,
      )
    }
    else if (pid === 'anthropic') {
      languageModel = buildLanguageModel(
        { type: 'anthropic', apiKey: settings.anthropic.apiKey, baseURL: settings.anthropic.baseURL },
        activeModel.id,
      )
    }
    else if (pid === 'google') {
      languageModel = buildLanguageModel(
        { type: 'google', apiKey: settings.google.apiKey },
        activeModel.id,
      )
    }
    else {
      const compat = settings.compatibleProviders?.find((p: ProviderSnapshot) => p.id === pid)
      if (!compat)
        throw new Error(`Provider "${pid}" not found`)
      languageModel = buildLanguageModel(
        { type: 'compatible', apiKey: compat.apiKey, baseURL: compat.baseURL, name: compat.name },
        activeModel.id,
      )
    }
  }
  catch (e) {
    const errMsg = `Failed to initialise model: ${e instanceof Error ? e.message : String(e)}`
    subTab.messages.push({ id: makeId(), role: 'assistant', content: '', timestamp: new Date(), error: errMsg })
    subTab.isStreaming = false
    if (subTab.subAgent)
      subTab.subAgent.status = 'error'
    return { text: '', status: 'error' }
  }

  const maxOutputTokens = activeModel.supportsThinking
    ? activeModel.thinkingEffort === 'high'
      ? 16000
      : activeModel.thinkingEffort === 'low'
        ? 2048
        : 8000
    : 4096

  // Tool set scoped by personality
  const projectPath = project.projectPath
  let tools: Record<string, unknown> = {}

  switch (personality) {
    case 'explorer': {
      if (projectPath) {
        const fsTools = createFilesystemTools(projectPath)
        tools = {
          list_directory: fsTools.list_directory,
          read_files: fsTools.read_files,
          glob: fsTools.glob,
          grep: fsTools.grep,
        }
      }
      tools = { ...tools, create_artifact: createCreateArtifactTool() }
      break
    }

    case 'researcher': {
      const webTools = createWebTools() as Record<string, unknown>
      tools = { ...webTools, create_artifact: createCreateArtifactTool() }
      break
    }

    case 'debugger': {
      if (projectPath) {
        const fsTools = createFilesystemTools(projectPath)
        tools = {
          list_directory: fsTools.list_directory,
          read_files: fsTools.read_files,
          glob: fsTools.glob,
          grep: fsTools.grep,
        }
      }
      const webTools = createWebTools() as Record<string, unknown>
      tools = { ...tools, ...webTools, create_artifact: createCreateArtifactTool() }
      break
    }

    case 'general': {
      const webTools = createWebTools() as Record<string, unknown>
      tools = { ...webTools, create_artifact: createCreateArtifactTool() }
      if (projectPath) {
        const fsTools = createFilesystemTools(projectPath) as Record<string, unknown>
        const shellTools = createShellTools(projectPath, osInfo?.shell) as Record<string, unknown>
        tools = { ...tools, ...fsTools, ...shellTools }
      }
      break
    }
  }

  // Label chain for sub-agent tool events
  function subAgentDisplayLabel(name: string, args: Record<string, unknown>): string {
    const fsLabel = toolDisplayLabel(name, args)
    if (fsLabel !== `Called ${name}`)
      return fsLabel
    const shellLabel = shellToolDisplayLabel(name, args)
    if (shellLabel !== `Called ${name}`)
      return shellLabel
    const webLabel = webToolDisplayLabel(name, args)
    if (webLabel !== `Called ${name}`)
      return webLabel
    return artifactToolDisplayLabel(name, args)
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

  const liveMsg = assistantMsg

  const handleToolCall = (event: ToolCallEvent) => {
    const metadata = event.name === 'create_artifact'
      ? { artifact: event.args.artifact }
      : undefined
    liveMsg.toolEvents ??= []
    liveMsg.toolEvents.push({
      id: event.id,
      name: event.name,
      label: subAgentDisplayLabel(event.name, event.args),
      status: 'running',
      toolName: event.name,
      startedAt: Date.now(),
      ...(metadata ? { metadata } : {}),
    })
    liveMsg.parts ??= []
    liveMsg.parts.push({ type: 'tool', toolCallId: event.id })
  }

  const handleToolResult = (event: ToolResultEvent) => {
    const te = liveMsg.toolEvents?.find(e => e.id === event.id)
    if (te) {
      te.status = event.ok ? 'done' : 'error'
      te.finishedAt = Date.now()
    }
  }

  const systemPrompt = buildSubAgentSystemPrompt(personality, projectPath, osInfo)

  return new Promise<SubAgentOutcome>(resolve => {
    streamChat({
      model: languageModel,
      messages: [{ role: 'user', content: mission }],
      systemPrompt,
      maxOutputTokens,
      supportsToolCalls: Object.keys(tools).length > 0,
      tools: Object.keys(tools).length > 0 ? tools as ToolSet : undefined,
      onDelta: (delta: string) => {
        liveMsg.content += delta
        liveMsg.parts ??= []
        const last = liveMsg.parts.at(-1)
        if (last?.type === 'text') { last.text += delta }
        else { liveMsg.parts.push({ type: 'text', text: delta }) }
      },
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onFinish: (fullText: string) => {
        liveMsg.content = fullText
        subTab.isStreaming = false
        if (subTab.subAgent)
          subTab.subAgent.status = 'done'
        onAbort(subTab.id)
        resolve({ text: fullText, status: 'done' })
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        subTab.isStreaming = false
        if (subTab.subAgent)
          subTab.subAgent.status = 'error'
        onAbort(subTab.id)
        resolve({ text: '', status: 'error' })
      },
      signal,
    }).catch(() => {
      subTab.isStreaming = false
      if (subTab.subAgent)
        subTab.subAgent.status = 'error'
      onAbort(subTab.id)
      resolve({ text: '', status: 'error' })
    })
  })
}
