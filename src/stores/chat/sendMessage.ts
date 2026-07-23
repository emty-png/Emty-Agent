import type { LanguageModel } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import type { ChatMode, ChatTab, Message, SubAgentPersonality, ToolEvent } from './types'
import type { RequestToolPermission, ToolPermissionDecision } from '@/utils/tools/permissions'
import type { QuestionAnswer, QuestionSpec } from '@/utils/tools/questions'
import type { TaskItem } from '@/utils/tools/todos'
import { APICallError, RetryError } from 'ai'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbSaveMemory,
  dbTouchConversation,
  dbUpdateConversationDesigns,
  dbUpdateConversationWorkspace,
  dbUpdateMessage,
} from '@/db/database'
import { getEffectiveMcpServers } from '@/utils/perTabOverrides'
import { emitStatusChange } from './agentLifecycle'
import {
  STATUS_IDLE,
  STATUS_INITIALIZING,
  STATUS_STREAMING,
  statusError,
  statusReconnecting,
  statusToolRunning,
  statusWaitingPermission,
} from './agentStatus'
import { buildMentionContext } from './mentions'
import { runSubAgentStream } from './subagent'
import { toolRegistry } from './toolRegistry'
import { makeId } from './utils'
import { resolveTabWorkspacePath } from './workspace'

// ── Register tool profiles once on first import ───────────────────────────────

import ('@/stores/chat/toolProfiles/build').then(m => toolRegistry.register('build', m.buildProfile))
import('@/stores/chat/toolProfiles/plan').then(m => toolRegistry.register('plan', m.planProfile))
import('@/stores/chat/toolProfiles/chat').then(m => toolRegistry.register('chat', m.chatProfile))
import('@/stores/chat/toolProfiles/design').then(m => toolRegistry.register('design', m.designProfile))

// ── Helper ────────────────────────────────────────────────────────────────────

function setStatus(tab: ChatTab, next: ChatTab['agentStatus']): void {
  const prev = tab.agentStatus
  tab.agentStatus = next
  emitStatusChange(tab.id, prev, next)
}

// ── Network retry helpers ──────────────────────────────────────────────────────

const MAX_NETWORK_RETRIES = 15

function isNetworkError(error: Error): boolean {
  // Unwrap AI SDK RetryError — check the last underlying error
  if (RetryError.isInstance(error)) {
    const lastErr = error.errors?.[error.errors.length - 1]
    if (lastErr instanceof Error)
      return isNetworkError(lastErr)
  }

  // Unwrap AI SDK APICallError — no status code means network failure
  if (APICallError.isInstance(error)) {
    if (error.statusCode == null)
      return true // no status = network-level failure
    return false // has status = HTTP error, not network
  }

  const msg = error.message.toLowerCase()
  const name = error.name.toLowerCase()
  return (
    (name === 'typeerror' && msg.includes('failed')) // fetch TypeError
    || msg.includes('network')
    || msg.includes('fetch')
    || msg.includes('econnrefused')
    || msg.includes('econnreset')
    || msg.includes('etimedout')
    || msg.includes('enotfound')
    || msg.includes('timeout')
    || msg.includes('networkerror')
    || msg.includes('network request failed')
    || msg.includes('load failed')
    || msg.includes('internet')
    || msg.includes('offline')
  )
}

function getRetryDelay(attempt: number): number {
  const base = 5000
  const factor = 1.5
  const maxDelay = 120_000
  const delay = Math.min(base * factor ** attempt, maxDelay)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1)
  return Math.round(delay + jitter)
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSendMessage(
  tabs: Ref<ChatTab[]>,
  activeId: Ref<string>,
  activeTab: ComputedRef<ChatTab>,
  abortControllers: Map<string, AbortController>,
  questionResolvers: Map<string, (answers: QuestionAnswer[]) => void>,
  requestToolPermission: (tabId: string, request: Parameters<RequestToolPermission>[0]) => Promise<ToolPermissionDecision>,
) {
  async function sendMessage(content: string, _mode: ChatMode = 'build', attachments?: import('./types').Attachment[], modelOverride?: string | null): Promise<void> {
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
      import('./toolLabels'),
      import('@/utils/tools/permissions'),
      import('@/utils/tools/sequential'),
      import('./runContext'),
      import('./streamHandlers'),
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
    const resolvedModelUid = modelOverride ?? tab.modelUid ?? settings.activeModelUid
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
    await checkpointStore.createCheckpoint(tab.id, tab.conversationId, tab.messages.length, text)

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

    // ── User message ──────────────────────────────────────────────────────
    let mentionContext = await buildMentionContext(text, effectiveProjectPath, tab.readRegistry, mode, tab.designs).catch(() => '')
    if (skillContentToInject)
      mentionContext = mentionContext ? `${mentionContext}\n\n${skillContentToInject}` : skillContentToInject

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date(now),
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
    })
    await dbTouchConversation(tab.conversationId!)

    // ── Assistant message (pre-inserted for crash safety) ─────────────────
    const assistantId = makeId()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), toolEvents: [], parts: [], modelUid: resolvedModelUid ?? null, modelName: activeModel?.name ?? null }
    tab.messages.push(assistantMsg)
    setStatus(tab, STATUS_INITIALIZING)

    await dbInsertMessage({ id: assistantId, conversation_id: tab.conversationId!, role: 'assistant', content: '', created_at: Date.now(), is_complete: 0, model_uid: resolvedModelUid ?? null, model_name: activeModel?.name ?? null })
      .catch(e => console.error('[sendMessage] Failed to pre-insert assistant row:', e))

    // ── Build run context (model, system prompt, api messages, cache) ─────
    let runCtx: Awaited<ReturnType<typeof buildRunContext>>
    try {
      runCtx = await buildRunContext({ tab, settings: settings as import('./runContext').SettingsForContext, requestText: text, mentionContext, modelOverride: modelOverride ?? null, ...(osInfo ? { osInfo: osInfo as { shell?: 'sh' | 'powershell' } } : {}) })
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

    function requestPermissionForTool(request: Parameters<RequestToolPermission>[0]) {
      if ((tab.permissionMode ?? settings.agent.permissionMode) === 'auto')
        return Promise.resolve('allow-once' as const)
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
    }

    // ── Network retry state ──────────────────────────────────────────────
    let attempt = 0
    let finalError: Error | null = null

    // ── onError ───────────────────────────────────────────────────────────
    function onError(error: Error) {
      streamHandlers.flushLive()
      liveMsg.error = error.message
      setStatus(tab, statusError(error.message))
      abortControllers.delete(tabId)
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
          retryable: isNetworkError(error),
          attemptCount: attempt,
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

    // ── Stream (with network retry) ──────────────────────────────────────

    while (attempt <= MAX_NETWORK_RETRIES) {
      if (ac.signal.aborted)
        break

      if (attempt > 0) {
        const delay = getRetryDelay(attempt - 1)
        setStatus(tab, statusReconnecting(attempt, MAX_NETWORK_RETRIES, delay))

        const aborted = await new Promise<boolean>(resolve => {
          const timer = setTimeout(resolve, delay, false)
          ac.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve(true)
          }, { once: true })
        })
        if (aborted)
          break

        // Reset live message for fresh attempt
        liveMsg.content = ''
        liveMsg.parts = []
        liveMsg.toolEvents = []
        delete liveMsg.error
      }

      setStatus(tab, STATUS_STREAMING)

      // Per-attempt error handler: flush live output but don't finalize on network errors
      // (we may retry). For non-network errors, call the real onError immediately.
      let caughtError: Error | null = null
      const perAttemptOnError = (error: Error) => {
        caughtError = error
        streamHandlers.flushLive()
        if (!isNetworkError(error)) {
          onError(error)
        }
      }

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
          onError: perAttemptOnError,
          signal: ac.signal,
          ...(providerOptions ? { providerOptions: providerOptions as Record<string, Record<string, import('ai').JSONValue>> } : {}),
          ...(tools ? { tools } : {}),
        })
        // Success
        finalError = null
        break
      }
      catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        if (!isNetworkError(err) || ac.signal.aborted) {
          // Non-retryable or user stopped: call onError if not already called
          if (!caughtError)
            onError(err)
          finalError = null
          break
        }

        finalError = err
        attempt++
      }
    }

    // Final failure after exhausting retries
    if (finalError) {
      onError(finalError)
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
