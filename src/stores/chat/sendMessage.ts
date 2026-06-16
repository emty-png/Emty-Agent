import type { LanguageModel } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import type { Attachment, ChatMode, ChatTab, Message, SubAgentPersonality, ToolEvent } from './types'
import type { StreamChatOptions } from '@/utils/ai'
import type { RequestToolPermission, ToolPermissionDecision } from '@/utils/tools/permissions'
import type { QuestionAnswer, QuestionSpec } from '@/utils/tools/questions'
import type { TaskItem } from '@/utils/tools/todos'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbTouchConversation,
  dbUpdateConversationWorkspace,
  dbUpdateMessage,
} from '@/db/database'
import { buildMentionContext } from './mentions'
import { runSubAgentStream } from './subagent'
import { makeId, toModelMessages } from './utils'
import { resolveTabWorkspacePath } from './workspace'

export function createSendMessage(
  tabs: Ref<ChatTab[]>,
  activeId: Ref<string>,
  activeTab: ComputedRef<ChatTab>,
  abortControllers: Map<string, AbortController>,
  questionResolvers: Map<string, (answers: QuestionAnswer[]) => void>,
  requestToolPermission: (tabId: string, request: Parameters<RequestToolPermission>[0]) => Promise<ToolPermissionDecision>,
) {
  async function sendMessage(content: string, _mode: ChatMode = 'build', attachments?: Attachment[], modelOverride?: string | null): Promise<void> {
    const tab = activeTab.value
    if ((!content.trim() && (!attachments || attachments.length === 0)) || tab.isStreaming)
      return

    const [
      { buildLanguageModel, buildProviderOptions, buildSystemPrompt, mergeProviderOptions, streamChat },
      { buildAgentSystemPrompt },
      { applyMentionContextToMessages, buildCachedSystemPrompt, buildContextCachingProviderOptions, extractUsageStats },
      { useSettingsStore },
      { useProjectStore },
      { createFilesystemTools },
      { createShellTools },
      { createQuestionsTool },
      { createSkillTools },
      { createWebTools },
      { createBrowserTools },
      { createImageGenTools },
      { createMcpTools },
      { createTaskTools },
      { createMemoryTools },
      { createSleepTool },
      { filterDisabledTools },
      { wrapToolSetWithPermissions },
      { SequentialToolQueue, wrapToolSetSequentially },
      { createSpawnSubAgentTool, buildSubAgentSystemPrompt },
      { getOsInfo },
      { inspectWorkspace, buildWorkspacePromptContext },
      { buildMemoryPromptContext, saveConversationTurnMemory },
      { newReplayId, startReplayCapture, finishReplayCapture },
      { buildRecoveryPromptContext, classifyFailure, recordFailureEvent, resolveConversationFailures },
      { resolveLanguageModel, resolveMaxTokens },
      { createStreamHandlers },
      { getCoreToolDisplayLabel },
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
      import('@/utils/tools/browser'),
      import('@/utils/tools/imageGen'),
      import('@/utils/tools/mcp'),
      import('@/utils/tools/todos'),
      import('@/utils/tools/memory'),
      import('@/utils/tools/sleep'),
      import('@/utils/tools/catalog'),
      import('@/utils/tools/permissions'),
      import('@/utils/tools/sequential'),
      import('@/utils/tools/subagent'),
      import('@/utils/os'),
      import('@/utils/worktrees'),
      import('@/utils/memory'),
      import('@/utils/evals'),
      import('@/utils/failureRecovery'),
      import('./models'),
      import('./streamHandlers'),
      import('./toolLabels'),
    ])

    const settings = useSettingsStore()
    const project = useProjectStore()
    const requestedWorkspacePath = resolveTabWorkspacePath(tab, project.projectPath)
    const workspaceSnapshot = await inspectWorkspace(requestedWorkspacePath)
    const effectiveProjectPath = workspaceSnapshot?.path ?? requestedWorkspacePath ?? null

    const resolvedModelUid = modelOverride ?? tab.modelUid ?? settings.activeModelUid
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

    async function requestPermissionForTool(request: Parameters<RequestToolPermission>[0]) {
      if (settings.agent.permissionMode === 'auto')
        return 'allow-once' as const

      return await requestToolPermission(tab.id, request)
    }

    const now = Date.now()
    const text = content.trim()

    // Detect skill chips and extract ID
    const SKILL_CHIP_PATTERN = /\[skill:([^\]]+)\]/
    let skillId: string | null = null
    let skillContentToInject = ''

    const match = SKILL_CHIP_PATTERN.exec(text)
    if (match && match[1]) {
      skillId = match[1]
    }

    const finalContent = text // Preserve the user's message including the chip
    if (skillId) {
      const { loadSkillDefinition } = await import('@/utils/skills')
      const { recordSkillUsage } = await import('@/utils/skills/tracking')
      const skill = await loadSkillDefinition(skillId, effectiveProjectPath)
      if (skill) {
        recordSkillUsage(skillId)
        skillContentToInject = `## Requested Skill: ${skill.name}\n\n${skill.content}`
      }
    }

    const tabId = tab.id
    tab.workspacePath = effectiveProjectPath
    tab.workspaceMeta = workspaceSnapshot
    tab.workspaceLocked = true
    if (effectiveProjectPath && project.projectPath !== effectiveProjectPath)
      project.setProject(effectiveProjectPath)

    tab.todos = []
    tab.draft = {
      text: '',
      attachments: [],
    }
    tab.estimator = {
      estimate: tab.estimator.estimate,
      error: '',
      estimating: false,
    }

    const { useCheckpointStore } = await import('@/stores/checkpoints')
    const checkpointStore = useCheckpointStore()
    await checkpointStore.createCheckpoint(
      tab.id,
      tab.conversationId,
      tab.messages.length,
      text,
    )

    if (!tab.conversationId) {
      const title = text.slice(0, 60) + (text.length > 60 ? '\u2026' : '')
      const convId = makeId()
      await dbInsertConversation({
        id: convId,
        title,
        created_at: now,
        updated_at: now,
        workspace_path: effectiveProjectPath,
        workspace_meta: workspaceSnapshot ? JSON.stringify(workspaceSnapshot) : null,
      })
      tab.conversationId = convId
      tab.title = title
      const { useHistoryStore } = await import('@/stores/history')
      useHistoryStore().prepend({
        id: convId,
        title,
        created_at: now,
        updated_at: now,
        msg_count: 0,
        workspace_path: effectiveProjectPath,
        workspace_meta: workspaceSnapshot ? JSON.stringify(workspaceSnapshot) : null,
      })
    }
    else {
      await dbUpdateConversationWorkspace(tab.conversationId, {
        workspace_path: effectiveProjectPath,
        workspace_meta: workspaceSnapshot ? JSON.stringify(workspaceSnapshot) : null,
      }).catch(() => { })
    }

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: finalContent,
      timestamp: new Date(now),
      ...(skillId ? { skillId } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }
    tab.messages.push(userMsg)

    let mentionContext = await buildMentionContext(finalContent, effectiveProjectPath, tab.readRegistry).catch(() => '')
    if (skillContentToInject) {
      mentionContext = mentionContext ? `${mentionContext}\n\n${skillContentToInject}` : skillContentToInject
    }
    if (mentionContext.trim())
      userMsg.mentionContext = mentionContext

    await dbInsertMessage({
      id: userMsg.id,
      conversation_id: tab.conversationId!,
      role: 'user',
      content: finalContent,
      created_at: now,
      ...(skillId ? { skill_id: skillId } : {}),
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

    // ── Insert assistant row immediately so a crash won't lose this turn ───
    // is_complete = 0 flags it as in-progress. We flip it to 1 in onFinish.
    // Subsequent live updates go through dbUpdateMessage (not a second insert).
    await dbInsertMessage({
      id: assistantId,
      conversation_id: tab.conversationId!,
      role: 'assistant',
      content: '',
      created_at: Date.now(),
      is_complete: 0,
    }).catch(e => console.error('[sendMessage] Failed to pre-insert assistant row:', e))

    let languageModel: LanguageModel | undefined
    try {
      languageModel = resolveLanguageModel(activeModel, settings, buildLanguageModel)
    }
    catch (e) {
      assistantMsg.error = `Failed to initialise model: ${e instanceof Error ? e.message : String(e)}`
      tab.isStreaming = false
      await dbUpdateMessage(assistantId, {
        content: assistantMsg.error,
        is_complete: 1,
      }).catch(() => { })
      const failure = classifyFailure(new Error(assistantMsg.error))
      await recordFailureEvent({
        replayId: null,
        conversationId: tab.conversationId,
        category: failure.category,
        summary: failure.summary,
        recoveryHint: failure.recoveryHint,
        severity: failure.severity,
      }).catch(() => { })
      return
    }

    const maxOutputTokens = resolveMaxTokens(activeModel, 16_384)

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

    const promptBuild = await buildAgentSystemPrompt({
      basePrompt: buildSystemPrompt(effectiveProjectPath, tab.mode || 'build', osInfo, settings.agent.gitCoAuthor),
      projectPath: effectiveProjectPath,
      requestText: text,
      autoContext: settings.autoContext,
      disabledSkillIds: settings.disabledSkillIds,
      supportsToolCalls: activeModel.supportsToolCalls,
      workspaceContext: buildWorkspacePromptContext(workspaceSnapshot),
      memoryContext,
      recoveryContext,
    })

    cacheRuntime.promptFingerprint = promptBuild.promptFingerprint

    const systemPrompt = buildCachedSystemPrompt(
      promptBuild.prompt,
      cacheRuntime,
    )
    const ac = new AbortController()
    abortControllers.set(tabId, ac)

    const liveMsg = tab.messages.find(m => m.id === assistantId)!

    const streamHandlers = createStreamHandlers({
      liveMsg,
      getToolLabel: getCoreToolDisplayLabel,
    })

    const apiMessages = applyMentionContextToMessages(
      toModelMessages(tab.messages.slice(0, -1), {
        skipLastMessageMentionContext: true,
      }),
      mentionContext,
      cacheRuntime,
    )

    const todoCallback = (items: TaskItem[]) => { tab.todos = items }
    const { reset: _resetTasks, ...taskTools } = createTaskTools(todoCallback)

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
      const convId = makeId()

      const subTab: ChatTab = {
        id: subTabId,
        title: `${meta.label} \u00B7 ${titleMission}`,
        messages: [],
        conversationId: convId,
        workspacePath: effectiveProjectPath,
        workspaceMeta: workspaceSnapshot,
        workspaceLocked: true,
        isStreaming: true,
        todos: [],
        modelUid: resolvedModelUid,
        draft: {
          text: '',
          attachments: [],
        },
        estimator: {
          estimate: null,
          error: '',
          estimating: false,
        },
        pendingQuestions: null,
        pendingPermissions: [],
        readRegistry: new Map(),
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
        spawnEvent.metadata = { ...spawnEvent.metadata, subAgentTabId: subTabId, subAgentConversationId: convId }
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
        project: { projectPath: effectiveProjectPath },
        osInfo,
        createFilesystemTools,
        createShellTools,
        createWebTools,
        createBrowserTools,
        requestToolPermission,
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

    const snapshotCallback = async (relPath: string, absPath: string, content?: string | null) => {
      await checkpointStore.snapshotFile(relPath, absPath, content)
    }

    const mcpTools = activeModel.supportsToolCalls
      ? filterDisabledTools(
          await createMcpTools(settings.mcpServers),
          settings.disabledToolIds,
        )
      : {}

    const { createPlanTools } = await import('@/utils/tools/plan')
    const planTools = createPlanTools(filepath => {
      window.dispatchEvent(new CustomEvent('emty:plan-created', { detail: { filepath } }))
    })

    const rawTools = activeModel.supportsToolCalls
      ? filterDisabledTools({
          ...planTools,
          ask_questions: createQuestionsTool(questionCallback),
          ...taskTools,
          sleep: createSleepTool(),
          ...createMemoryTools(settings.memory.enabled, workspaceSnapshot),
          ...createSkillTools(effectiveProjectPath),
          spawn_subagent: createSpawnSubAgentTool(subAgentSpawnCallback, subAgentAbortCallback),
          ...mcpTools,
          ...createWebTools(),
          ...createBrowserTools(tab.id),
          ...createImageGenTools(),
          ...(effectiveProjectPath
            ? {
                ...createFilesystemTools(effectiveProjectPath, snapshotCallback, tab.readRegistry),
                ...createShellTools(effectiveProjectPath, osInfo?.shell, settings.agent.gitCoAuthor, {
                  onOutput: streamHandlers.onToolOutput,
                }),
              }
            : {}),
        }, settings.disabledToolIds)
      : undefined

    if (rawTools && tab.mode === 'plan') {
      const modifyingTools = ['write_file', 'edit_files', 'run_command', 'git_command']
      const toolMap = rawTools as Record<string, unknown>
      for (const toolName of modifyingTools) {
        if (toolMap[toolName]) {
          const original = toolMap[toolName] as Record<string, unknown>
          toolMap[toolName] = {
            ...original,
            execute: async (..._args: unknown[]) => {
              return 'Error: Please write a plan or if u already have then wait for the users approvel'
            },
          }
        }
      }
    }

    const permissionWrappedTools = rawTools && Object.keys(rawTools).length > 0
      ? wrapToolSetWithPermissions(rawTools, {
          tabId: tab.id,
          requestPermission: requestPermissionForTool,
          getToolLabel: getCoreToolDisplayLabel,
          onToolExecutionStart: streamHandlers.onToolExecutionStart,
        })
      : undefined

    const toolQueue = new SequentialToolQueue()
    const tools = permissionWrappedTools
      ? wrapToolSetSequentially(permissionWrappedTools, toolQueue)
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

    const replayId = tab.conversationId ? newReplayId() : null
    let replayFinished = false

    if (replayId && tab.conversationId) {
      await startReplayCapture({
        id: replayId,
        conversationId: tab.conversationId,
        workspace: workspaceSnapshot,
        modelUid: resolvedModelUid,
        requestText: text,
        systemPrompt: promptBuild.prompt,
        promptFingerprint: promptBuild.promptFingerprint,
        messages: apiMessages,
        ...(providerOptions ? { providerOptions } : {}),
        toolNames: Object.keys(rawTools ?? {}),
        createdAt: now,
      }).catch(() => { })
    }

    async function refreshWorkspaceState() {
      const next = await inspectWorkspace(effectiveProjectPath).catch(() => workspaceSnapshot)
      tab.workspaceMeta = next
      if (tab.conversationId) {
        await dbUpdateConversationWorkspace(tab.conversationId, {
          workspace_path: effectiveProjectPath,
          workspace_meta: next ? JSON.stringify(next) : null,
        }).catch(() => { })
      }
      return next
    }

    const streamOpts: StreamChatOptions = {
      model: languageModel,
      messages: apiMessages,
      systemPrompt,
      supportsToolCalls: activeModel.supportsToolCalls,
      maxOutputTokens,
      onDelta: streamHandlers.onDelta,
      onReasoningDelta: streamHandlers.onReasoningDelta,
      onToolCall: streamHandlers.onToolCall,
      onToolResult: streamHandlers.onToolResult,
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
          // Final authoritative write — marks the row as complete
          await dbUpdateMessage(assistantId, {
            content: fullText,
            parts: liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null,
            tool_events: liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null,
            cache_stats: liveMsg.cacheStats ? JSON.stringify(liveMsg.cacheStats) : null,
            is_complete: 1,
          })
          await dbTouchConversation(tab.conversationId)
        }
        const finalWorkspace = await refreshWorkspaceState()
        replayFinished = true
        if (replayId) {
          await finishReplayCapture({
            id: replayId,
            startedAt: now,
            status: 'completed',
            usage,
            ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}),
          }).catch(() => { })
        }
        await resolveConversationFailures(tab.conversationId).catch(() => { })
        await saveConversationTurnMemory({
          settings: settings.memory,
          workspace: finalWorkspace,
          userMessage: userMsg,
          assistantMessage: liveMsg,
        }).catch(() => { })
        await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        tab.isStreaming = false
        abortControllers.delete(tabId)
        // Persist whatever was generated before the error so it isn't lost.
        // is_complete stays 0, signalling the message was interrupted.
        if (tab.conversationId) {
          const hasInterruptionNote = /\[Assistant turn ended with error\/interruption:/.test(liveMsg.content)
          const persistedContent = hasInterruptionNote
            ? liveMsg.content
            : (
                liveMsg.content.trim()
                  ? `${liveMsg.content}\n\n[Assistant turn ended with error/interruption: ${error.message}]`
                  : `Error: ${error.message}`
              )
          dbUpdateMessage(assistantId, {
            content: persistedContent,
            parts: liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null,
            tool_events: liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null,
          }).catch(() => { })
          dbTouchConversation(tab.conversationId).catch(() => { })
        }
        replayFinished = true
        const failure = classifyFailure(error)
        if (replayId) {
          void finishReplayCapture({
            id: replayId,
            startedAt: now,
            status: 'error',
            errorCode: failure.category,
            errorMessage: failure.summary,
            ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}),
          }).catch(() => { })
        }
        void recordFailureEvent({
          replayId,
          conversationId: tab.conversationId,
          category: failure.category,
          summary: failure.summary,
          recoveryHint: failure.recoveryHint,
          severity: failure.severity,
          details: error.stack ?? null,
        }).catch(() => { })
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
      if (!replayFinished && replayId) {
        await finishReplayCapture({
          id: replayId,
          startedAt: now,
          status: ac.signal.aborted ? 'aborted' : 'error',
          ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}),
        }).catch(() => { })
      }
      await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
    }
  }

  return { sendMessage }
}
