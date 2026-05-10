import type { LanguageModel } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import type { Attachment, ChatMode, ChatTab, Message, SubAgentPersonality, ToolEvent } from './types'
import type { StreamChatOptions, ToolCallEvent, ToolResultEvent } from '@/utils/ai'
import type { QuestionAnswer, QuestionSpec } from '@/utils/tools/questions'
import type { TodoItem } from '@/utils/tools/todos'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbTouchConversation,
} from '@/db/database'
import { buildMentionContext } from './mentions'
import { runSubAgentStream } from './subagent'
import { makeId, toModelMessages } from './utils'

export function createSendMessage(
  tabs: Ref<ChatTab[]>,
  activeId: Ref<string>,
  activeTab: ComputedRef<ChatTab>,
  abortControllers: Map<string, AbortController>,
  questionResolvers: Map<string, (answers: QuestionAnswer[]) => void>,
) {
  return async function sendMessage(content: string, mode: ChatMode = 'build', attachments?: Attachment[]): Promise<void> {
    const tab = activeTab.value
    if ((!content.trim() && (!attachments || attachments.length === 0)) || tab.isStreaming)
      return

    const [
      { buildLanguageModel, buildProviderOptions, buildSystemPrompt, mergeProviderOptions, streamChat },
      { buildAgentSystemPrompt },
      { applyMentionContextToMessages, buildCachedSystemPrompt, buildContextCachingProviderOptions, extractUsageStats },
      { useSettingsStore },
      { useProjectStore },
      { createFilesystemTools, toolDisplayLabel },
      { createShellTools, shellToolDisplayLabel },
      { createQuestionsTool, questionsToolDisplayLabel },
      { createSkillTools, skillToolDisplayLabel },
      { createWebTools, webToolDisplayLabel },
      { createMcpTools, mcpToolDisplayLabel },
      { createWriteTodoTool, todosToolDisplayLabel },
      { createSpawnSubAgentTool, subAgentDisplayLabel, buildSubAgentSystemPrompt },
      { getOsInfo },
    ] = await Promise.all([
      import('@/utils/ai'),
      import('@/utils/agentContext'),
      import('@/utils/contextCaching'),
      import('@/stores/settings'),
      import('@/stores/project'),
      import('@/utils/tools/filesystem'),
      import('@/utils/tools/shell'),
      import('@/utils/tools/questions'),
      import('@/utils/tools/skills'),
      import('@/utils/tools/web'),
      import('@/utils/tools/mcp'),
      import('@/utils/tools/todos'),
      import('@/utils/tools/subagent'),
      import('@/utils/os'),
    ])

    const settings = useSettingsStore()
    const project = useProjectStore()

    const resolvedModelUid = tab.modelUid ?? settings.activeModelUid
    const activeModel = settings.enabledModels.find((m: { uid: string }) => m.uid === resolvedModelUid) ?? settings.activeModel

    if (!activeModel) {
      tab.messages.push({
        id: makeId(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        error: 'No model selected. Open Settings → Providers to connect a model.',
      })
      return
    }

    const osInfo = await getOsInfo().catch(() => undefined)

    function allToolDisplayLabel(name: string, args: Record<string, unknown>): string {
      const fsLabel = toolDisplayLabel(name, args)
      if (fsLabel !== `Called ${name}`)
        return fsLabel
      const shellLabel = shellToolDisplayLabel(name, args)
      if (shellLabel !== `Called ${name}`)
        return shellLabel
      const qLabel = questionsToolDisplayLabel(name, args)
      if (qLabel !== `Called ${name}`)
        return qLabel
      const skillLabel = skillToolDisplayLabel(name, args)
      if (skillLabel !== `Called ${name}`)
        return skillLabel
      const webLabel = webToolDisplayLabel(name, args)
      if (webLabel !== `Called ${name}`)
        return webLabel
      const mcpLabel = mcpToolDisplayLabel(name)
      if (mcpLabel !== `Called ${name}`)
        return mcpLabel
      const todoLabel = todosToolDisplayLabel(name, args)
      if (todoLabel !== `Called ${name}`)
        return todoLabel
      return subAgentDisplayLabel(name, args)
    }

    const now = Date.now()
    const text = content.trim()

    const tabId = tab.id

    tab.todos = []
    tab.draft = {
      text: '',
      mode,
      attachments: [],
    }
    tab.estimator = {
      estimate: tab.estimator.estimate,
      error: '',
      estimating: false,
    }

    const { useCheckpointStore } = await import('@/stores/checkpoints')
    const checkpointStore = useCheckpointStore()
    checkpointStore.createCheckpoint(
      tab.id,
      tab.conversationId,
      tab.messages.length,
      text,
    )

    if (!tab.conversationId) {
      const title = text.slice(0, 60) + (text.length > 60 ? '\u2026' : '')
      const convId = makeId()
      await dbInsertConversation({ id: convId, title, created_at: now, updated_at: now })
      tab.conversationId = convId
      tab.title = title
      const { useHistoryStore } = await import('@/stores/history')
      useHistoryStore().prepend({ id: convId, title, created_at: now, updated_at: now, msg_count: 0 })
    }

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date(now),
      ...(attachments?.length ? { attachments } : {}),
    }
    tab.messages.push(userMsg)

    const mentionContext = await buildMentionContext(text, project.projectPath).catch(() => '')
    if (mentionContext.trim())
      userMsg.mentionContext = mentionContext

    await dbInsertMessage({
      id: userMsg.id,
      conversation_id: tab.conversationId!,
      role: 'user',
      content: text,
      created_at: now,
      ...(mentionContext.trim() ? { mention_context: mentionContext } : {}),
      ...(attachments?.length ? { attachments: JSON.stringify(attachments) } : {}),
    })
    await dbTouchConversation(tab.conversationId!)

    const assistantId = makeId()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      toolEvents: [],
      parts: [],
    }
    tab.messages.push(assistantMsg)
    tab.isStreaming = true

    let languageModel: LanguageModel | undefined
    try {
      const pid = activeModel.providerId
      if (pid === 'openai') {
        languageModel = buildLanguageModel(
          { type: 'openai', apiKey: settings.openai.apiKey, ...(settings.openai.baseURL ? { baseURL: settings.openai.baseURL } : {}), ...(settings.openai.organizationId ? { organizationId: settings.openai.organizationId } : {}) },
          activeModel.id,
        )
      }
      else if (pid === 'anthropic') {
        languageModel = buildLanguageModel(
          { type: 'anthropic', apiKey: settings.anthropic.apiKey, ...(settings.anthropic.baseURL ? { baseURL: settings.anthropic.baseURL } : {}) },
          activeModel.id,
        )
      }
      else if (pid === 'google') {
        languageModel = buildLanguageModel({ type: 'google', apiKey: settings.google.apiKey }, activeModel.id)
      }
      else {
        const compat = settings.compatibleProviders.find((p: { id: string }) => p.id === pid)
        if (!compat)
          throw new Error(`Provider "${pid}" not found`)
        languageModel = buildLanguageModel(
          { type: 'compatible', apiKey: compat.apiKey, baseURL: compat.baseURL, name: compat.name },
          activeModel.id,
        )
      }
    }
    catch (e) {
      assistantMsg.error = `Failed to initialise model: ${e instanceof Error ? e.message : String(e)}`
      tab.isStreaming = false
      return
    }

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

    const systemPrompt = buildCachedSystemPrompt(
      promptBuild.prompt,
      cacheRuntime,
    )
    const ac = new AbortController()
    abortControllers.set(tabId, ac)

    const liveMsg = tab.messages.find(m => m.id === assistantId)!

    const handleToolCall = (event: ToolCallEvent) => {
      liveMsg.toolEvents ??= []
      liveMsg.toolEvents.push({
        id: event.id,
        name: event.name,
        label: allToolDisplayLabel(event.name, event.args),
        status: 'running',
        toolName: event.name,
        startedAt: Date.now(),
        args: event.args,
      })
      liveMsg.parts ??= []
      liveMsg.parts.push({ type: 'tool', toolCallId: event.id })
    }

    const handleToolResult = (event: ToolResultEvent) => {
      const te = liveMsg.toolEvents?.find(e => e.id === event.id)
      if (te) {
        te.status = event.ok ? 'done' : 'error'
        te.finishedAt = Date.now()
        te.result = event.result

        // Append +added / -removed line-count stats to the badge label so
        // ToolCallBadge can colour them without a separate data channel.
        // write_files and edit_files both return { added, removed } from execute().
        // The cast is safe: execute() returns a plain object the AI SDK passes through.
        if (event.ok) {
          const result = (event as unknown as { result?: Record<string, unknown> }).result
          const added = typeof result?.added === 'number' ? result.added : null
          const removed = typeof result?.removed === 'number' ? result.removed : null
          if (added !== null || removed !== null) {
            const parts: string[] = []
            if ((added ?? 0) > 0)
              parts.push(`+${added}`)
            if ((removed ?? 0) > 0)
              parts.push(`-${removed}`)
            if (parts.length > 0)
              te.label = `${te.label} ${parts.join(' ')}`
          }
        }
      }
    }

    const apiMessages = applyMentionContextToMessages(
      toModelMessages(tab.messages.slice(0, -1), {
        skipLastMessageMentionContext: true,
      }),
      mentionContext,
      cacheRuntime,
    )

    const todoCallback = (items: TodoItem[]) => { tab.todos = items }

    const questionCallback = (questions: QuestionSpec[], resolve: (answers: QuestionAnswer[]) => void) => {
      tab.pendingQuestions = { questions }
      questionResolvers.set(tab.id, resolve)
    }

    const { PERSONALITY_META } = await import('@/utils/tools/subagent')

    const subAgentSpawnCallback = async ({ personality, mission }: { personality: SubAgentPersonality; mission: string }) => {
      if (tabs.value.length >= 9) {
        throw new Error('Cannot spawn sub-agent: tab limit reached (9). Close a tab first.')
      }

      const meta = PERSONALITY_META[personality as keyof typeof PERSONALITY_META]
      const titleMission = mission.length > 40 ? `${mission.slice(0, 40)}\u2026` : mission
      const subTabId = makeId()

      const subTab: ChatTab = {
        id: subTabId,
        title: `${meta.label} \u00B7 ${titleMission}`,
        messages: [],
        conversationId: null,
        isStreaming: true,
        todos: [],
        modelUid: resolvedModelUid,
        draft: {
          text: '',
          mode: 'build',
          attachments: [],
        },
        estimator: {
          estimate: null,
          error: '',
          estimating: false,
        },
        pendingQuestions: null,
        subAgent: {
          personality,
          mission,
          parentTabId: tab.id,
          status: 'running',
        },
      }

      tabs.value.push(subTab)
      activeId.value = subTabId // Switch to sub-agent tab

      const spawnEvent = liveMsg.toolEvents?.slice().reverse().find((e: ToolEvent) => e.toolName === 'spawn_subagent')
      if (spawnEvent) {
        spawnEvent.metadata = { ...spawnEvent.metadata, subAgentTabId: subTabId }
      }

      const subAc = new AbortController()
      abortControllers.set(subTabId, subAc)

      const completionPromise = runSubAgentStream({
        subTab,
        personality,
        mission,
        signal: subAc.signal,
        buildLanguageModel,
        streamChat,
        buildSubAgentSystemPrompt,
        settings,
        project,
        osInfo,
        toolDisplayLabel,
        shellToolDisplayLabel,
        webToolDisplayLabel,
        createFilesystemTools,
        createShellTools,
        createWebTools,
        onAbort: tabId => { abortControllers.delete(tabId) },
      })

      return { tabId: subTabId, completionPromise }
    }

    const subAgentAbortCallback = (tabId: string) => {
      abortControllers.get(tabId)?.abort()
      abortControllers.delete(tabId)
      const subTab = tabs.value.find(t => t.id === tabId)
      if (subTab) {
        subTab.isStreaming = false
        if (subTab.subAgent)
          subTab.subAgent.status = 'error'
      }
    }

    const snapshotCallback = async (relPath: string, absPath: string) => {
      await checkpointStore.snapshotFile(relPath, absPath)
    }

    const mcpTools = activeModel.supportsToolCalls
      ? await createMcpTools(settings.mcpServers)
      : {}

    const tools = activeModel.supportsToolCalls
      ? {
          ask_questions: createQuestionsTool(questionCallback),
          write_todo: createWriteTodoTool(todoCallback),
          ...createSkillTools(project.projectPath),
          spawn_subagent: createSpawnSubAgentTool(subAgentSpawnCallback, subAgentAbortCallback),
          ...mcpTools,
          ...createWebTools(),
          ...(project.projectPath
            ? {
                ...createFilesystemTools(project.projectPath, snapshotCallback),
                ...createShellTools(project.projectPath, osInfo?.shell),
              }
            : {}),
        }
      : undefined

    const providerOptions = mergeProviderOptions(
      buildProviderOptions({
        providerId: activeModel.providerId,
        modelId: activeModel.id,
        supportsThinking: activeModel.supportsThinking,
        thinkingEffort: activeModel.thinkingEffort,
      }),
      buildContextCachingProviderOptions(cacheRuntime),
    )

    const streamOpts: StreamChatOptions = {
      model: languageModel,
      messages: apiMessages,
      systemPrompt,
      supportsToolCalls: activeModel.supportsToolCalls,
      maxOutputTokens,
      onDelta: (delta: string) => {
        liveMsg.content += delta
        liveMsg.parts ??= []
        const last = liveMsg.parts.at(-1)
        if (last?.type === 'text') { last.text += delta }
        else { liveMsg.parts.push({ type: 'text', text: delta }) }
      },
      onReasoningDelta: (delta: string) => {
        liveMsg.parts ??= []
        const last = liveMsg.parts.at(-1)
        if (last?.type === 'reasoning') { last.text += delta }
        else { liveMsg.parts.push({ type: 'reasoning', text: delta }) }
      },
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onFinish: async ({ fullText, usage }) => {
        liveMsg.content = fullText
        const usageStats = extractUsageStats(usage, activeModel.providerId)
        if (usageStats)
          liveMsg.cacheStats = usageStats
        else
          delete liveMsg.cacheStats
        tab.isStreaming = false
        abortControllers.delete(tabId)
        if (tab.conversationId) {
          const serializedTools = liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null
          const serializedParts = liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null
          const serializedUsageStats = liveMsg.cacheStats ? JSON.stringify(liveMsg.cacheStats) : null
          await dbInsertMessage({
            id: assistantId,
            conversation_id: tab.conversationId,
            role: 'assistant',
            content: fullText,
            created_at: Date.now(),
            tool_events: serializedTools,
            parts: serializedParts,
            cache_stats: serializedUsageStats,
          })
          await dbTouchConversation(tab.conversationId)
        }
        await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        tab.isStreaming = false
        abortControllers.delete(tabId)
        checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
      },
      signal: ac.signal,
      ...(providerOptions ? { providerOptions } : {}),
      ...(tools ? { tools } : {}),
    }

    try {
      await streamChat(streamOpts)
    }
    catch {
      tab.isStreaming = false
      abortControllers.delete(tabId)
      await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
    }
  }
}
