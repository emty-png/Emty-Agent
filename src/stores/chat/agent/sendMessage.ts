import type { LanguageModel, ModelMessage } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import type { SettingsSnapshot } from '@/stores/chat/context/compaction'
import type { Attachment, ChatMode, ChatTab, Message, SubAgentPersonality, ToolEvent } from '@/stores/chat/core/types'
import type { RequestToolPermission, ToolPermissionDecision } from '@/utils/tools/permissions'
import type { QuestionAnswer, QuestionSpec } from '@/utils/tools/questions'
import type { TaskItem } from '@/utils/tools/todos'
import { APICallError } from 'ai'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbSaveMemory,
  dbTouchConversation,
  dbUpdateConversationDesigns,
  dbUpdateConversationWorkspace,
  dbUpdateMessage,
} from '@/db/database'
import { emitStatusChange } from '@/stores/chat/agent/lifecycle'
import {
  STATUS_IDLE,
  STATUS_INITIALIZING,
  STATUS_STREAMING,
  statusError,
  statusToolRunning,
  statusWaitingPermission,
} from '@/stores/chat/agent/status'
import { runSubAgentStream } from '@/stores/chat/agent/subagent'
import { compactConversationSession, persistCompactionMessages, shouldCompactSession } from '@/stores/chat/context/compaction'
import { buildMentionContext } from '@/stores/chat/context/mentions'
import { toModelMessages } from '@/stores/chat/context/messageSerializer'
import { BG_TASK_COMPLETED_DIVIDER } from '@/stores/chat/core/constants'
import { toolRegistry } from '@/stores/chat/tools/registry'
import { consumePendingBgTaskNotifications } from '@/stores/chat/utils/bgTaskNotifications'
import { makeId } from '@/stores/chat/utils/tabFactory'
import { resolveTabWorkspacePath } from '@/stores/chat/utils/workspace'
import { getEffectiveMcpServers } from '@/utils/perTabOverrides'

// ── Register tool profiles once on first import ───────────────────────────────

import ('@/stores/chat/tools/profiles/build').then(m => toolRegistry.register('build', m.buildProfile))
import('@/stores/chat/tools/profiles/plan').then(m => toolRegistry.register('plan', m.planProfile))
import('@/stores/chat/tools/profiles/chat').then(m => toolRegistry.register('chat', m.chatProfile))
import('@/stores/chat/tools/profiles/design').then(m => toolRegistry.register('design', m.designProfile))

// ── Helper ────────────────────────────────────────────────────────────────────

function setStatus(tab: ChatTab, next: ChatTab['agentStatus']): void {
  const prev = tab.agentStatus
  tab.agentStatus = next
  emitStatusChange(tab.id, prev, next)
}

function debugStreamInterceptor(message: string, data?: Record<string, unknown>): void {
  console.warn('[stream-interceptor]', message, data ?? {})
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSendMessage(
  tabs: Ref<ChatTab[]>,
  activeId: Ref<string>,
  activeTab: ComputedRef<ChatTab>,
  abortControllers: Map<string, AbortController>,
  questionResolvers: Map<string, (answers: QuestionAnswer[]) => void>,
  requestToolPermission: (tabId: string, request: Parameters<RequestToolPermission>[0]) => Promise<ToolPermissionDecision>,
  drainQueue: () => void,
) {
  async function sendMessage(content: string, _mode: ChatMode = 'build', attachments?: Attachment[], modelOverride?: string | null, isBgNotification?: boolean): Promise<void> {
    const tab = activeTab.value
    if ((!content.trim() && (!attachments || attachments.length === 0)) || tab.agentStatus.type !== 'idle')
      return

    const [
      { useSettingsStore },
      { useProjectStore },
      { inspectWorkspace },
      { getOsInfo },
      { startReplayCapture, finishReplayCapture },
      { classifyFailure, recordFailureEvent, resolveConversationFailures },
      { streamChat },
      { getCoreToolDisplayLabel },
      { wrapToolSetWithPermissions },
      { SequentialToolQueue, wrapToolSetSequentially },
      { buildRunContext },
      { createStreamHandlers },
    ] = await Promise.all([
      import('@/stores/settings'),
      import('@/stores/project'),
      import('@/utils/worktrees'),
      import('@/utils/os'),
      import('@/utils/evals'),
      import('@/utils/failureRecovery'),
      import('@/utils/ai'),
      import('@/stores/chat/tools/labels'),
      import('@/utils/tools/permissions'),
      import('@/utils/tools/sequential'),
      import('@/stores/chat/agent/runContext'),
      import('@/stores/chat/agent/streamHandlers'),
    ])

    const settings = useSettingsStore()
    const project = useProjectStore()
    const tabId = tab.id
    const mode = tab.mode ?? 'build'
    const now = Date.now()
    const text = content.trim()

    setStatus(tab, STATUS_INITIALIZING)

    // ── Resolve OS info (needed for shell tools) ───────────────────────────
    const osInfo = await getOsInfo().catch(() => undefined)

    // ── Resolve workspace ─────────────────────────────────────────────────
    const requestedWorkspacePath = resolveTabWorkspacePath(tab, project.projectPath)
    const workspaceSnapshot = await inspectWorkspace(requestedWorkspacePath)
    const effectiveProjectPath = workspaceSnapshot?.path ?? requestedWorkspacePath ?? null

    // ── Resolve model ─────────────────────────────────────────────────────
    const resolvedModelUid = modelOverride ?? tab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid
    const activeModel = settings.enabledModels.find((m: { uid: string }) => m.uid === resolvedModelUid) ?? settings.activeModel

    if (!activeModel) {
      tab.messages.push({ id: makeId(), role: 'assistant', content: '', timestamp: new Date(), error: 'No model selected. Open Settings → Providers to connect a model.' })
      setStatus(tab, STATUS_IDLE)
      return
    }

    // ── Skill chip detection ──────────────────────────────────────────────
    const SKILL_CHIP_PATTERN = /\[skill:([^\]]+)\]/
    let skillId: string | null = null
    let skillContentToInject = ''
    const skillMatch = SKILL_CHIP_PATTERN.exec(text)
    if (skillMatch?.[1]) {
      skillId = skillMatch[1]
    }

    if (skillId) {
      const { loadSkillDefinition } = await import('@/utils/skills')
      const { recordSkillUsage } = await import('@/utils/skills/tracking')
      const skill = await loadSkillDefinition(skillId, effectiveProjectPath)
      if (skill) {
        recordSkillUsage(skillId)
        skillContentToInject = `## Requested Skill: ${skill.name}\n\n${skill.content}`
      }
    }

    // ── Update tab workspace state ────────────────────────────────────────
    tab.workspacePath = effectiveProjectPath
    tab.workspaceMeta = workspaceSnapshot
    tab.workspaceLocked = true
    if (effectiveProjectPath && project.projectPath !== effectiveProjectPath)
      project.setProject(effectiveProjectPath)

    tab.draft = { text: '', attachments: [] }
    tab.estimator = { estimate: tab.estimator.estimate, error: '', estimating: false }

    // ── Checkpoint ────────────────────────────────────────────────────────
    const { useCheckpointStore } = await import('@/stores/checkpoints')
    const checkpointStore = useCheckpointStore()
    if (!isBgNotification) {
      await checkpointStore.createCheckpoint(tab.id, tab.conversationId, tab.messages.length, text)
    }

    // ── Create/update conversation ────────────────────────────────────────
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
        ...(tab.isDesignTab ? { is_design_tab: 1 } : {}),
      })
      tab.conversationId = convId
      tab.title = title
      const { useHistoryStore } = await import('@/stores/history')
      useHistoryStore().prepend({ id: convId, title, created_at: now, updated_at: now, msg_count: 0, workspace_path: effectiveProjectPath, workspace_meta: workspaceSnapshot ? JSON.stringify(workspaceSnapshot) : null })
    }
    else {
      await dbUpdateConversationWorkspace(tab.conversationId, {
        workspace_path: effectiveProjectPath,
        workspace_meta: workspaceSnapshot ? JSON.stringify(workspaceSnapshot) : null,
      }).catch(() => {})
    }

    // ── TurnStart hook ────────────────────────────────────────────────
    const { runHooks, fireHooks, projectNameFromPath } = await import('@/utils/hooks')
    const promptHookDecision = await runHooks('TurnStart', {
      event: 'TurnStart',
      tabId,
      workspacePath: effectiveProjectPath,
      projectName: projectNameFromPath(effectiveProjectPath),
      prompt: text,
      mode,
    })
    if (!promptHookDecision.allowed) {
      tab.messages.push({
        id: makeId(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        error: `Blocked by hook: ${promptHookDecision.reason ?? 'TurnStart denied'}`,
      })
      setStatus(tab, STATUS_IDLE)
      return
    }

    // ── Preflight compaction ──────────────────────────────────────────────
    if (shouldCompactSession(tab, settings.agent.sessionCompaction?.thresholdPercent ?? 90)) {
      try {
        setStatus(tab, { type: 'compacting' })
        await compactConversationSession({
          tab,
          settings: settings as unknown as SettingsSnapshot,
          source: 'auto',
          onPersist: async payload => {
            if (tab.conversationId) {
              await persistCompactionMessages({ conversationId: tab.conversationId, insertedMessages: payload.insertedMessages })
            }
          },
        })
        setStatus(tab, STATUS_INITIALIZING)
      }
      catch (err) {
        console.error('[sendMessage] Preflight compaction failed:', err)
        setStatus(tab, STATUS_INITIALIZING)
      }
    }

    // ── User message ──────────────────────────────────────────────────────
    let mentionContext = await buildMentionContext(text, effectiveProjectPath, tab.readRegistry, mode, tab.designs).catch(() => '')
    if (skillContentToInject)
      mentionContext = mentionContext ? `${mentionContext}\n\n${skillContentToInject}` : skillContentToInject

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date(now),
      ...(isBgNotification ? { isBgNotification: true } : {}),
      ...(skillId ? { skillId } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(mentionContext.trim() ? { mentionContext } : {}),
    }
    tab.messages.push(userMsg)

    await dbInsertMessage({
      id: userMsg.id,
      conversation_id: tab.conversationId!,
      role: 'user',
      content: text,
      created_at: now,
      ...(skillId ? { skill_id: skillId } : {}),
      ...(mentionContext.trim() ? { mention_context: mentionContext } : {}),
      ...(attachments?.length ? { attachments: JSON.stringify(attachments) } : {}),
      ...(isBgNotification ? { is_bg_notification: 1 } : {}),
    })
    await dbTouchConversation(tab.conversationId!)

    // ── Assistant message (pre-inserted for crash safety) ─────────────────
    const assistantId = makeId()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), toolEvents: [], parts: [], modelUid: resolvedModelUid ?? null, modelName: activeModel?.name ?? null }
    tab.messages.push(assistantMsg)
    setStatus(tab, STATUS_INITIALIZING)

    const assistantCreatedAt = Date.now()
    await dbInsertMessage({ id: assistantId, conversation_id: tab.conversationId!, role: 'assistant', content: '', created_at: assistantCreatedAt, is_complete: 0, model_uid: resolvedModelUid ?? null, model_name: activeModel?.name ?? null })
      .catch(e => console.error('[sendMessage] Failed to pre-insert assistant row:', e))

    const interceptedStepMessages: ModelMessage[] = []

    function insertBeforeLiveAssistant(message: Message): void {
      const assistantIndex = tab.messages.findIndex(m => m.id === assistantId)
      if (assistantIndex >= 0)
        tab.messages.splice(assistantIndex, 0, message)
      else
        tab.messages.push(message)
    }

    function modelMessageSignature(message: ModelMessage): string {
      try {
        return JSON.stringify(message)
      }
      catch {
        return `${message.role}:${String(message.content)}`
      }
    }

    function appendMissingInterceptedMessages(messages: ModelMessage[]): ModelMessage[] {
      if (interceptedStepMessages.length === 0)
        return messages

      const existing = new Set(messages.map(modelMessageSignature))
      const missing = interceptedStepMessages.filter(message => !existing.has(modelMessageSignature(message)))
      return missing.length > 0 ? [...messages, ...missing] : messages
    }

    async function appendInterceptedUserMessage(input: {
      text: string
      attachments?: Attachment[] | undefined
      isBgNotification?: boolean | undefined
      mentionContext?: string | undefined
      createdAt?: number
    }): Promise<Message> {
      const createdAt = input.createdAt ?? Date.now()
      const message: Message = {
        id: makeId(),
        role: 'user',
        content: input.text,
        timestamp: new Date(createdAt),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        ...(input.mentionContext?.trim() ? { mentionContext: input.mentionContext } : {}),
        ...(input.isBgNotification ? { isBgNotification: true } : {}),
      }

      insertBeforeLiveAssistant(message)

      await dbInsertMessage({
        id: message.id,
        conversation_id: tab.conversationId!,
        role: 'user',
        content: message.content,
        created_at: createdAt,
        ...(message.mentionContext ? { mention_context: message.mentionContext } : {}),
        ...(message.attachments?.length ? { attachments: JSON.stringify(message.attachments) } : {}),
        ...(message.isBgNotification ? { is_bg_notification: 1 } : {}),
      }).catch(e => console.error('[sendMessage] Failed to insert intercepted user row:', e))

      return message
    }

    async function consumePendingRequestMessages(): Promise<ModelMessage[]> {
      const createdMessages: Message[] = []
      const queuedCount = tab.messageQueue.length

      const bgNotification = consumePendingBgTaskNotifications(tabId)
      debugStreamInterceptor('checking pending request messages', {
        tabId,
        queuedCount,
        hasBgNotification: Boolean(bgNotification),
      })
      if (bgNotification) {
        const dividerCreatedAt = Date.now()
        const dividerMsg: Message = {
          id: makeId(),
          role: 'assistant',
          content: BG_TASK_COMPLETED_DIVIDER,
          timestamp: new Date(dividerCreatedAt),
        }
        insertBeforeLiveAssistant(dividerMsg)
        await dbInsertMessage({
          id: dividerMsg.id,
          conversation_id: tab.conversationId!,
          role: 'assistant',
          content: BG_TASK_COMPLETED_DIVIDER,
          created_at: dividerCreatedAt,
        }).catch(e => console.error('[sendMessage] Failed to insert bg divider row:', e))

        createdMessages.push(await appendInterceptedUserMessage({
          text: bgNotification,
          isBgNotification: true,
          createdAt: dividerCreatedAt + 1,
        }))
      }

      const queued = tab.messageQueue.splice(0)
      for (const item of queued) {
        const queuedMentionContext = await buildMentionContext(item.text, effectiveProjectPath, tab.readRegistry, mode, tab.designs).catch(() => '')
        createdMessages.push(await appendInterceptedUserMessage({
          text: item.text,
          attachments: item.attachments.length > 0 ? item.attachments : undefined,
          mentionContext: queuedMentionContext,
          createdAt: Math.max(item.queuedAt, Date.now()),
        }))
      }

      if (createdMessages.length > 0 && tab.conversationId)
        await dbTouchConversation(tab.conversationId).catch(() => {})

      const modelMessages = createdMessages.length > 0 ? toModelMessages(createdMessages) : []
      debugStreamInterceptor('consumed pending request messages', {
        tabId,
        createdCount: createdMessages.length,
        modelMessageCount: modelMessages.length,
      })
      return modelMessages
    }

    await consumePendingRequestMessages()

    // ── Build run context (model, system prompt, api messages, cache) ─────
    let runCtx: Awaited<ReturnType<typeof buildRunContext>>
    try {
      runCtx = await buildRunContext({ tab, settings: settings as import('@/stores/chat/agent/runContext').SettingsForContext, requestText: text, mentionContext, modelOverride: modelOverride ?? null, ...(osInfo ? { osInfo: osInfo as { shell?: 'sh' | 'powershell' } } : {}) })
    }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message === 'NO_MODEL') {
        assistantMsg.error = 'No model selected. Open Settings → Providers to connect a model.'
      }
      else {
        assistantMsg.error = `Failed to initialise model: ${message}`
      }
      setStatus(tab, statusError(assistantMsg.error))
      await dbUpdateMessage(assistantId, { content: assistantMsg.error, is_complete: 1 }).catch(() => {})
      const failure = classifyFailure(new Error(assistantMsg.error))
      void recordFailureEvent({ replayId: null, conversationId: tab.conversationId, category: failure.category, summary: failure.summary, recoveryHint: failure.recoveryHint, severity: failure.severity }).catch(() => {})
      if (failure.category !== 'stream_aborted') {
        fireHooks('StopFailure', {
          event: 'StopFailure',
          tabId,
          workspacePath: effectiveProjectPath,
          projectName: projectNameFromPath(effectiveProjectPath),
          conversationId: tab.conversationId ?? null,
          errorMessage: assistantMsg.error,
          errorCategory: failure.category,
          retryable: false,
          attemptCount: 0,
          toolCallsCount: 0,
        })
      }
      // Clear queue on early failure (stream never started)
      tab.messageQueue = []
      return
    }

    const { model, activeModel: resolvedModel, systemPrompt, apiMessages, maxOutputTokens, providerOptions, replayId } = runCtx
    const streamStartedAt = Date.now()
    const liveMsg = tab.messages.find(m => m.id === assistantId)!
    let replayFinished = false

    // ── Stream handlers ───────────────────────────────────────────────────
    const streamHandlers = createStreamHandlers({
      liveMsg,
      getToolLabel: getCoreToolDisplayLabel,
      getTabStatus: () => tab.agentStatus,
      onStatusChange: (status, meta) => {
        if (status === 'tool-running' && meta?.toolName) {
          setStatus(tab, statusToolRunning(meta.toolName))
        }
        else if (status === 'streaming') {
          setStatus(tab, STATUS_STREAMING)
        }
        else if (status === 'waiting-permission' && meta?.toolName) {
          setStatus(tab, statusWaitingPermission(meta.toolName))
        }
        else if (status === 'waiting-questions') {
          setStatus(tab, { type: 'waiting-questions' })
        }
        else if (status === 'sleeping') {
          setStatus(tab, { type: 'sleeping' })
        }
      },
    })

    // ── Tool setup ────────────────────────────────────────────────────────
    const effectiveMcpServers = getEffectiveMcpServers(tab, settings.mcpServers)

    async function requestPermissionForTool(request: Parameters<RequestToolPermission>[0]): Promise<ToolPermissionDecision> {
      const mode = tab.permissionMode ?? settings.agent.permissionMode
      if (mode === 'yolo')
        return 'allow-once'
      if (mode === 'auto') {
        const { reviewToolCall } = await import('@/utils/tools/autoReview')
        const { resolveLanguageModel: resolveLM } = await import('@/stores/chat/utils/modelResolver')
        const { buildLanguageModel: buildLM } = await import('@/utils/ai')
        const languageModel = resolveLM(activeModel!, settings as import('@/stores/chat/utils/modelResolver').ModelSettingsSnapshot, buildLM)
        const verdict = await reviewToolCall(request, languageModel)
        if (verdict === 'safe')
          return 'allow-once'
        return requestToolPermission(tab.id, request)
      }
      return requestToolPermission(tab.id, request)
    }

    const snapshotCallback = async (relPath: string, absPath: string, fileContent?: string | null) => {
      await checkpointStore.snapshotFile(relPath, absPath, fileContent)
    }

    const todoCallback = (items: TaskItem[]) => {
      tab.todos = items
      if (!tab.conversationId)
        return
      const scope: 'project' | 'global' = tab.workspaceMeta?.projectKey ? 'project' : 'global'
      dbSaveMemory({
        scope,
        project_key: tab.workspaceMeta?.projectKey ?? null,
        kind: 'task',
        key: tab.conversationId,
        title: 'Tasks',
        content: JSON.stringify(items),
        source: 'agent',
        metadata: JSON.stringify({ conversationId: tab.conversationId }),
      }).catch(() => {})
    }

    const questionCallback = (questions: QuestionSpec[], resolve: (answers: QuestionAnswer[]) => void) => {
      tab.pendingQuestions = { questions }
      questionResolvers.set(tab.id, resolve)
      setStatus(tab, { type: 'waiting-questions' })
    }

    const { PERSONALITY_META } = await import('@/utils/tools/subagent')

    const subAgentSpawnCallback = async ({ personality, mission }: { personality: SubAgentPersonality; mission: string }) => {
      if (tabs.value.length >= 9)
        throw new Error('Cannot spawn sub-agent: tab limit reached (9). Close a tab first.')

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
        agentStatus: STATUS_STREAMING,
        todos: [],
        modelUid: resolvedModelUid,
        draft: { text: '', attachments: [] },
        estimator: { estimate: null, error: '', estimating: false },
        pendingQuestions: null,
        pendingPermissions: [],
        readRegistry: new Map(),
        permissionMode: tab.permissionMode ?? settings.agent.permissionMode,
        subAgent: { personality, mission, parentTabId: tab.id, status: 'running' },
        messageQueue: [],
      }

      tabs.value.push(subTab)
      activeId.value = subTabId

      // Retrieve the reactive Proxy — the raw `subTab` reference bypasses Vue reactivity,
      // so all streaming mutations would be invisible to the UI.
      const reactiveSubTab = tabs.value[tabs.value.length - 1]!

      const spawnEvent = liveMsg.toolEvents?.slice().reverse().find((e: ToolEvent) => e.toolName === 'spawn_subagent')
      if (spawnEvent)
        spawnEvent.metadata = { ...spawnEvent.metadata, subAgentTabId: subTabId, subAgentConversationId: convId }

      const subAc = new AbortController()
      abortControllers.set(subTabId, subAc)

      const { buildLanguageModel, streamChat: _streamChat } = await import('@/utils/ai')
      const { buildSubAgentSystemPrompt } = await import('@/utils/tools/subagent')
      const { createFilesystemTools } = await import('@/utils/tools/filesystem')
      const { createShellTools } = await import('@/utils/tools/shell')
      const { createWebTools } = await import('@/utils/tools/web')
      const { createBrowserTools } = await import('@/utils/tools/browser')

      const completionPromise = runSubAgentStream({
        subTab: reactiveSubTab,
        personality,
        mission,
        signal: subAc.signal,
        buildLanguageModel,
        streamChat: _streamChat,
        buildSubAgentSystemPrompt,
        settings,
        project: { projectPath: effectiveProjectPath },
        osInfo,
        createFilesystemTools,
        createShellTools,
        createWebTools,
        createBrowserTools,
        requestToolPermission,
        onAbort: id => { abortControllers.delete(id) },
      })

      return { tabId: subTabId, completionPromise }
    }

    const subAgentAbortCallback = (subTabId: string) => {
      abortControllers.get(subTabId)?.abort()
      abortControllers.delete(subTabId)
      const subTab = tabs.value.find(t => t.id === subTabId)
      if (subTab) {
        setStatus(subTab, statusError('Aborted'))
        if (subTab.subAgent)
          subTab.subAgent.status = 'error'
      }
    }

    const rawTools = resolvedModel.supportsToolCalls
      ? await toolRegistry.resolve(mode, {
          tabId: tab.id,
          conversationId: tab.conversationId ?? tab.id,
          mode,
          workspacePath: effectiveProjectPath,
          workspaceMeta: workspaceSnapshot,
          readRegistry: tab.readRegistry,
          osInfo: osInfo as import('@/utils/os').OsInfo | undefined,
          coAuthor: settings.agent.gitCoAuthor,
          memoryEnabled: settings.memory.enabled,
          mcpServers: effectiveMcpServers,
          disabledToolIds: settings.disabledToolIds,
          snapshotCallback,
          questionCallback,
          todoCallback,
          initialTasks: tab.todos,
          subAgentSpawnCallback,
          subAgentAbortCallback,
          onDesignCreate: artifact => {
            if (!tab.designs)
              tab.designs = []
            const existingIdx = tab.designs.findIndex(d => d.id === artifact.id)
            if (existingIdx >= 0) {
              tab.designs[existingIdx] = artifact
            }
            else {
              tab.designs.push(artifact)
            }
            tab.activeDesignId = artifact.id
            if (tab.conversationId)
              dbUpdateConversationDesigns(tab.conversationId, JSON.stringify(tab.designs)).catch(() => {})
          },
          onDesignEdit: (id, patch) => {
            const design = tab.designs?.find(d => d.id === id)
            if (design) {
              Object.assign(design, patch)
              tab.activeDesignId = id
            }
            if (tab.conversationId && tab.designs)
              dbUpdateConversationDesigns(tab.conversationId, JSON.stringify(tab.designs)).catch(() => {})
          },
          onProjectScaffold: async project => {
            // Stop any running dev server from a previous project
            if (tab.devServerTaskId) {
              const { stopManagedCommandTask } = await import('@/utils/tools/shell')
              await stopManagedCommandTask(tab.devServerTaskId).catch(() => {})
              tab.devServerTaskId = undefined
              tab.previewUrl = undefined
            }
            tab.activeDesignProject = project
            if (tab.conversationId)
              dbUpdateConversationDesigns(tab.conversationId, JSON.stringify({ project, designs: tab.designs })).catch(() => {})
          },
          getActiveDesignProject: () => tab.activeDesignProject ?? null,
          onFilesChanged: () => {
            tab.projectVersion = (tab.projectVersion ?? 0) + 1
          },
          onPreviewUrl: url => {
            tab.previewUrl = url ?? undefined
          },
          onDevServerTaskId: id => {
            tab.devServerTaskId = id ?? undefined
          },
          stopPreview: async () => {
            if (tab.devServerTaskId) {
              const { stopManagedCommandTask } = await import('@/utils/tools/shell')
              await stopManagedCommandTask(tab.devServerTaskId).catch(() => {})
              tab.devServerTaskId = undefined
              tab.previewUrl = undefined
            }
          },
          runtimeEvents: {
            onOutput: streamHandlers.onToolOutput,
          },
        })
      : undefined

    const permissionWrappedTools = rawTools && Object.keys(rawTools).length > 0
      ? wrapToolSetWithPermissions(rawTools, {
          tabId: tab.id,
          workspacePath: effectiveProjectPath,
          projectName: projectNameFromPath(effectiveProjectPath),
          requestPermission: requestPermissionForTool,
          getToolLabel: getCoreToolDisplayLabel,
          onToolExecutionStart: streamHandlers.onToolExecutionStart,
        })
      : undefined

    const toolQueue = new SequentialToolQueue()
    const tools = permissionWrappedTools ? wrapToolSetSequentially(permissionWrappedTools, toolQueue) : undefined

    // ── Replay capture ────────────────────────────────────────────────────
    const ac = new AbortController()
    abortControllers.set(tabId, ac)

    if (replayId && tab.conversationId) {
      await startReplayCapture({
        id: replayId,
        conversationId: tab.conversationId,
        workspace: workspaceSnapshot,
        modelUid: resolvedModelUid,
        requestText: text,
        systemPrompt: runCtx.promptBuildResult.prompt as string,
        promptFingerprint: runCtx.promptBuildResult.promptFingerprint,
        messages: apiMessages,
        ...(providerOptions ? { providerOptions } : {}),
        toolNames: Object.keys(rawTools ?? {}),
        createdAt: now,
      }).catch(() => {})
    }

    // ── Workspace refresh helper ──────────────────────────────────────────
    const { inspectWorkspace: _inspectWorkspace } = await import('@/utils/worktrees')
    async function refreshWorkspaceState() {
      const next = await _inspectWorkspace(effectiveProjectPath).catch(() => workspaceSnapshot)
      tab.workspaceMeta = next
      if (tab.conversationId) {
        await dbUpdateConversationWorkspace(tab.conversationId, {
          workspace_path: effectiveProjectPath,
          workspace_meta: next ? JSON.stringify(next) : null,
        }).catch(() => {})
      }
      return next
    }

    // ── SessionStart hook (after conversation created, first message only) ─
    if (tab.conversationId && tab.messages.filter(m => m.role === 'user').length <= 1) {
      const sessionHookDecision = await runHooks('SessionStart', {
        event: 'SessionStart',
        tabId,
        workspacePath: effectiveProjectPath,
        projectName: projectNameFromPath(effectiveProjectPath),
        conversationId: tab.conversationId,
        mode,
      })
      if (!sessionHookDecision.allowed) {
        const reason = sessionHookDecision.reason ?? 'Blocked by hook'
        tab.messages.push({
          id: makeId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          error: `Blocked by hook: ${reason}`,
        })
        setStatus(tab, STATUS_IDLE)
        return
      }
    }

    // ── onFinish ──────────────────────────────────────────────────────────
    const { extractUsageStats } = await import('@/utils/contextCaching')
    const { saveConversationTurnMemory } = await import('@/utils/memory')

    async function onFinish({ fullText, usage }: { fullText: string; usage: import('ai').LanguageModelUsage }) {
      streamHandlers.flushLive()
      liveMsg.content = fullText
      const usageStats = extractUsageStats(usage, resolvedModel.providerId)
      if (usageStats)
        liveMsg.cacheStats = usageStats
      else delete liveMsg.cacheStats
      const elapsedSec = Math.max(1, Math.round((Date.now() - streamStartedAt) / 1000))
      liveMsg.elapsedSec = elapsedSec
      setStatus(tab, STATUS_IDLE)
      abortControllers.delete(tabId)
      if (tab.conversationId) {
        await dbUpdateMessage(assistantId, {
          content: fullText,
          parts: liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null,
          tool_events: liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null,
          cache_stats: liveMsg.cacheStats ? JSON.stringify(liveMsg.cacheStats) : null,
          is_complete: 1,
          elapsed_sec: elapsedSec,
        })
        await dbTouchConversation(tab.conversationId)
      }
      const finalWorkspace = await refreshWorkspaceState()
      replayFinished = true
      if (replayId) {
        await finishReplayCapture({ id: replayId, startedAt: now, status: 'completed', usage, ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}) }).catch(() => {})
      }
      await resolveConversationFailures(tab.conversationId).catch(() => {})
      await saveConversationTurnMemory({ settings: settings.memory, workspace: finalWorkspace, userMessage: userMsg, assistantMessage: liveMsg }).catch(() => {})
      await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => {})
      // ── TurnEnd hook ────────────────────────────────────────────────────
      fireHooks('TurnEnd', {
        event: 'TurnEnd',
        tabId,
        workspacePath: effectiveProjectPath,
        projectName: projectNameFromPath(effectiveProjectPath),
        conversationId: tab.conversationId!,
        toolCallsCount: liveMsg.toolEvents?.length ?? 0,
      })
      // ── Completion sound (parent agent only, not aborted) ──────────────────
      if (!tab.subAgent && settings.sound.completionEnabled) {
        import('@/utils/sounds').then(({ playCompletionSound }) => playCompletionSound(settings.sound.volume)).catch(() => {})
      }
      // ── In-loop compaction ────────────────────────────────────────────────
      if (shouldCompactSession(tab, settings.agent.sessionCompaction?.thresholdPercent ?? 90)) {
        try {
          await compactConversationSession({
            tab,
            settings: settings as unknown as SettingsSnapshot,
            source: 'auto',
            onPersist: async payload => {
              if (tab.conversationId) {
                await persistCompactionMessages({ conversationId: tab.conversationId, insertedMessages: payload.insertedMessages })
              }
            },
          })
        }
        catch (err) {
          console.error('[sendMessage] In-loop compaction failed:', err)
        }
      }

      // ── Auto-drain queue ──────────────────────────────────────────────────
      drainQueue()
    }

    // ── onError ───────────────────────────────────────────────────────────
    function onError(error: Error) {
      streamHandlers.flushLive()
      liveMsg.error = error.message
      setStatus(tab, statusError(error.message))
      abortControllers.delete(tabId)
      // Discard remaining queued messages on error
      tab.messageQueue = []
      if (tab.conversationId) {
        const hasNote = /\[Assistant turn ended with error\/interruption:/.test(liveMsg.content)
        const persistedContent = hasNote
          ? liveMsg.content
          : liveMsg.content.trim()
            ? liveMsg.content
            : `Generation stopped: ${error.message}`
        const elapsedSec = Math.max(1, Math.round((Date.now() - streamStartedAt) / 1000))
        liveMsg.elapsedSec = elapsedSec
        dbUpdateMessage(assistantId, {
          content: persistedContent,
          parts: liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null,
          tool_events: liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null,
          elapsed_sec: elapsedSec,
        }).catch(() => {})
        dbTouchConversation(tab.conversationId).catch(() => {})
      }
      replayFinished = true
      const failure = classifyFailure(error)
      if (replayId) {
        void finishReplayCapture({ id: replayId, startedAt: now, status: 'error', errorCode: failure.category, errorMessage: failure.summary, ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}) }).catch(() => {})
      }
      void recordFailureEvent({ replayId, conversationId: tab.conversationId, category: failure.category, summary: failure.summary, recoveryHint: failure.recoveryHint, severity: failure.severity, details: error.stack ?? null }).catch(() => {})
      if (failure.category !== 'stream_aborted') {
        fireHooks('StopFailure', {
          event: 'StopFailure',
          tabId,
          workspacePath: effectiveProjectPath,
          projectName: projectNameFromPath(effectiveProjectPath),
          conversationId: tab.conversationId ?? null,
          errorMessage: error.message,
          errorCategory: failure.category,
          retryable: false,
          attemptCount: 0,
          toolCallsCount: liveMsg.toolEvents?.length ?? 0,
        })
      }
      checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => {})
      // ── TurnEnd hook (error path) ──────────────────────────────────────────
      fireHooks('TurnEnd', {
        event: 'TurnEnd',
        tabId,
        workspacePath: effectiveProjectPath,
        projectName: projectNameFromPath(effectiveProjectPath),
        conversationId: tab.conversationId!,
        toolCallsCount: liveMsg.toolEvents?.length ?? 0,
        error: error.message,
      })
      // ── Error sound ────────────────────────────────────────────────────────
      if (settings.sound.errorEnabled) {
        import('@/utils/sounds').then(({ playErrorSound }) => playErrorSound(settings.sound.volume)).catch(() => {})
      }
    }

    // ── Stream ───────────────────────────────────────────────────────────

    setStatus(tab, STATUS_STREAMING)

    try {
      await streamChat({
        model: model as LanguageModel,
        messages: apiMessages,
        systemPrompt,
        supportsToolCalls: resolvedModel.supportsToolCalls,
        maxOutputTokens,
        onDelta: streamHandlers.onDelta,
        onReasoningDelta: streamHandlers.onReasoningDelta,
        onToolCall: streamHandlers.onToolCall,
        onToolResult: streamHandlers.onToolResult,
        onFinish,
        onError,
        prepareStep: async ({ stepNumber, messages }) => {
          const nextMessages = await consumePendingRequestMessages()
          if (nextMessages.length > 0)
            interceptedStepMessages.push(...nextMessages)
          const preparedMessages = appendMissingInterceptedMessages(messages)
          debugStreamInterceptor('prepareStep', {
            tabId,
            stepNumber,
            incomingMessageCount: messages.length,
            newlyInterceptedCount: nextMessages.length,
            retainedInterceptedCount: interceptedStepMessages.length,
            outgoingMessageCount: preparedMessages.length,
            appended: preparedMessages !== messages,
          })
          return preparedMessages === messages ? undefined : { messages: preparedMessages }
        },
        signal: ac.signal,
        ...(providerOptions ? { providerOptions: providerOptions as Record<string, Record<string, import('ai').JSONValue>> } : {}),
        ...(tools ? { tools } : {}),
      })
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // ── Overflow compaction ───────────────────────────────────────────────
      if (APICallError.isInstance(err) && err.statusCode === 413) {
        try {
          setStatus(tab, { type: 'compacting' })
          await compactConversationSession({
            tab,
            settings: settings as unknown as SettingsSnapshot,
            source: 'auto',
            onPersist: async payload => {
              if (tab.conversationId) {
                await persistCompactionMessages({ conversationId: tab.conversationId, insertedMessages: payload.insertedMessages })
              }
            },
          })
          err.message = 'Context was too large. Auto-compacted history. Please retry your request.'
        }
        catch (cErr) {
          console.error('[sendMessage] Overflow compaction failed:', cErr)
        }
      }

      onError(err)
    }

    setStatus(tab, STATUS_IDLE)
    abortControllers.delete(tabId)
    if (!replayFinished && replayId) {
      await finishReplayCapture({ id: replayId, startedAt: now, status: ac.signal.aborted ? 'aborted' : 'error', ...(liveMsg.toolEvents ? { toolEvents: liveMsg.toolEvents } : {}) }).catch(() => {})
    }
    await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => {})
  }

  return { sendMessage }
}
