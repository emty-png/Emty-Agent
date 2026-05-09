/**
 * src/stores/chat.ts
 */

import type { LanguageModel } from 'ai'
import type { ChatMode, ChatTab, Message, SubAgentPersonality, TodoItem, ToolEvent } from './chat/types'
import type { StreamChatOptions, ToolCallEvent, ToolResultEvent } from '@/utils/ai'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbTouchConversation,
  dbUpdateConversationTitle,
} from '@/db/database'
import { buildMentionContext } from './chat/mentions'
import { runSubAgentStream } from './chat/subagent'
import { makeId, newTab, toApiMessages } from './chat/utils'
import { useCheckpointStore } from './checkpoints'
import { useHistoryStore } from './history'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

export type { ChatMode, ChatTab, Message, MessagePart, SubAgentInfo, SubAgentPersonality, ToolEvent } from './chat/types'
export type { TodoItem } from '@/utils/tools/todos'

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref(tabs.value[0]!.id)
  const abortControllers = new Map<string, AbortController>()

  const activeTab = computed(
    () => tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0]!,
  )

  function addTab(): void {
    if (tabs.value.length >= 9)
      return
    const tab = newTab()
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function closeTab(id: string): void {
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)

    // Clean up checkpoints for this tab
    useCheckpointStore().clearTab(id)

    const idx = tabs.value.findIndex(t => t.id === id)
    if (tabs.value.length === 1) {
      tabs.value = [newTab()]
      activeId.value = tabs.value[0]!.id
      return
    }
    tabs.value.splice(idx, 1)
    if (activeId.value === id)
      activeId.value = tabs.value[Math.max(0, idx - 1)]!.id
  }

  function openConversation(payload: {
    conversationId: string
    title: string
    messages: Message[]
  }): void {
    if (tabs.value.length >= 9) {
      const blankIdx = tabs.value.findIndex(t => t.messages.length === 0)
      if (blankIdx !== -1) {
        tabs.value[blankIdx] = {
          id: tabs.value[blankIdx]!.id,
          title: payload.title,
          messages: payload.messages,
          conversationId: payload.conversationId,
          isStreaming: false,
          todos: [],
        }
        activeId.value = tabs.value[blankIdx]!.id
        return
      }
    }
    tabs.value.push({
      id: makeId(),
      title: payload.title,
      messages: payload.messages,
      conversationId: payload.conversationId,
      isStreaming: false,
      todos: [],
    })
    activeId.value = tabs.value.at(-1)!.id

    // Load checkpoints for this conversation
    useCheckpointStore().loadForConversation(
      tabs.value.at(-1)!.id,
      payload.conversationId,
    )
  }

  function stopGeneration(tabId?: string): void {
    const id = tabId ?? activeId.value
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      tab.isStreaming = false
      if (tab.subAgent)
        tab.subAgent.status = 'error'
    }
  }

  // ── send message ──────────────────────────────────────────────────────────────

  async function sendMessage(content: string, mode: ChatMode = 'build'): Promise<void> {
    const tab = activeTab.value
    if (!content.trim() || tab.isStreaming)
      return

    const [
      { buildLanguageModel, buildProviderOptions, buildSystemPrompt, streamChat },
      { createQuestionsTool, questionsToolDisplayLabel },
      { createFilesystemTools, toolDisplayLabel },
      { createShellTools, shellToolDisplayLabel },
      { createWebTools, webToolDisplayLabel },
      { createCreateArtifactTool, artifactToolDisplayLabel },
      { createWriteTodoTool, todosToolDisplayLabel },
      { createSpawnSubAgentTool, subAgentDisplayLabel, buildSubAgentSystemPrompt },
      { getOsInfo },
    ] = await Promise.all([
      import('@/utils/ai'),
      import('@/utils/tools/questions'),
      import('@/utils/tools/filesystem'),
      import('@/utils/tools/shell'),
      import('@/utils/tools/web'),
      import('@/utils/tools/artifact'),
      import('@/utils/tools/todos'),
      import('@/utils/tools/subagent'),
      import('@/utils/os'),
    ])

    const settings = useSettingsStore()
    const project = useProjectStore()
    const activeModel = settings.activeModel

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
      const webLabel = webToolDisplayLabel(name, args)
      if (webLabel !== `Called ${name}`)
        return webLabel
      const artifactLabel = artifactToolDisplayLabel(name, args)
      if (artifactLabel !== `Called ${name}`)
        return artifactLabel
      const todoLabel = todosToolDisplayLabel(name, args)
      if (todoLabel !== `Called ${name}`)
        return todoLabel
      return subAgentDisplayLabel(name, args)
    }

    const now = Date.now()
    const text = content.trim()

    tab.todos = []

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
      useHistoryStore().prepend({ id: convId, title, created_at: now, updated_at: now, msg_count: 0 })
    }

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date(now),
    }
    await dbInsertMessage({
      id: userMsg.id,
      conversation_id: tab.conversationId!,
      role: 'user',
      content: text,
      created_at: now,
    })
    await dbTouchConversation(tab.conversationId!)
    tab.messages.push(userMsg)

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

    const systemPrompt = buildSystemPrompt(project.projectPath, mode, osInfo)
    const ac = new AbortController()
    abortControllers.set(tab.id, ac)

    const liveMsg = tab.messages.find(m => m.id === assistantId)!

    const handleToolCall = (event: ToolCallEvent) => {
      const metadata = event.name === 'create_artifact'
        ? { artifact: event.args.artifact }
        : undefined
      liveMsg.toolEvents ??= []
      liveMsg.toolEvents.push({
        id: event.id,
        name: event.name,
        label: allToolDisplayLabel(event.name, event.args),
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

    const mentionContext = await buildMentionContext(text, project.projectPath).catch(() => '')
    const baseApiMessages = toApiMessages(tab.messages.slice(0, -1))
    const apiMessages = mentionContext && baseApiMessages.length > 0
      ? [
          ...baseApiMessages.slice(0, -1),
          { role: 'user' as const, content: `${mentionContext}\n\n${baseApiMessages.at(-1)!.content}` },
        ]
      : baseApiMessages

    const todoCallback = (items: TodoItem[]) => { tab.todos = items }

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
        subAgent: {
          personality,
          mission,
          parentTabId: tab.id,
          status: 'running',
        },
      }

      tabs.value.push(subTab)
      activeId.value = subTabId

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
        artifactToolDisplayLabel,
        createFilesystemTools,
        createShellTools,
        createWebTools,
        createCreateArtifactTool,
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

    const tools = activeModel.supportsToolCalls
      ? {
          ask_questions: createQuestionsTool(),
          write_todo: createWriteTodoTool(todoCallback),
          spawn_subagent: createSpawnSubAgentTool(subAgentSpawnCallback, subAgentAbortCallback),
          create_artifact: createCreateArtifactTool(),
          ...createWebTools(),
          ...(project.projectPath
            ? {
                ...createFilesystemTools(project.projectPath, snapshotCallback),
                ...createShellTools(project.projectPath, osInfo?.shell),
              }
            : {}),
        }
      : undefined

    const providerOptions = buildProviderOptions({
      providerId: activeModel.providerId,
      modelId: activeModel.id,
      supportsThinking: activeModel.supportsThinking,
      thinkingEffort: activeModel.thinkingEffort,
    })

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
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onFinish: async (fullText: string) => {
        liveMsg.content = fullText
        tab.isStreaming = false
        abortControllers.delete(tab.id)
        if (tab.conversationId) {
          const serializedTools = liveMsg.toolEvents?.length ? JSON.stringify(liveMsg.toolEvents) : null
          const serializedParts = liveMsg.parts?.length ? JSON.stringify(liveMsg.parts) : null
          await dbInsertMessage({
            id: assistantId,
            conversation_id: tab.conversationId,
            role: 'assistant',
            content: fullText,
            created_at: Date.now(),
            tool_events: serializedTools,
            parts: serializedParts,
          })
          await dbTouchConversation(tab.conversationId)
        }
        await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
      },
      onError: (error: Error) => {
        liveMsg.error = error.message
        tab.isStreaming = false
        abortControllers.delete(tab.id)
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
      abortControllers.delete(tab.id)
      await checkpointStore.finalizeCheckpoint(tab.conversationId).catch(() => { })
    }
  }

  async function renameTab(tabId: string, newTitle: string): Promise<void> {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return
    tab.title = newTitle
    if (tab.conversationId)
      await dbUpdateConversationTitle(tab.conversationId, newTitle)
  }

  async function restoreToCheckpoint(tabId: string, checkpointId: string): Promise<{ ok: boolean; error?: string }> {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab)
      return { ok: false, error: 'Tab not found' }
    if (tab.isStreaming)
      return { ok: false, error: 'Cannot restore while streaming' }

    const { useCheckpointStore } = await import('./checkpoints')
    const result = await useCheckpointStore().restoreToCheckpoint(tab, checkpointId)
    return result
  }

  return {
    tabs,
    activeId,
    activeTab,
    addTab,
    closeTab,
    openConversation,
    sendMessage,
    stopGeneration,
    renameTab,
    restoreToCheckpoint,
  }
})
