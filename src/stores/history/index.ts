import type { ConversationRow } from '@/db/database'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  dbDeleteConversation,
  dbDeleteConversationsByWorkspace,
  dbListConversations,
  dbLoadMessages,
  dbSearchConversations,
  dbUpdateConversationTitle,
} from '@/db/database'
import { useChatStore } from '@/stores/chat'
import { useProjectStore } from '@/stores/project'

const PAGE_SIZE = 50

export const useHistoryStore = defineStore('history', () => {
  const conversations = ref<ConversationRow[]>([])
  const searchQuery = ref('')
  const loading = ref(false)
  const hasMore = ref(true)
  const error = ref<string | null>(null)

  // ── derived ─────────────────────────────────────────────────────────────────
  const isEmpty = computed(() => !loading.value && conversations.value.length === 0)

  // ── load / search ────────────────────────────────────────────────────────────
  async function load(reset = false): Promise<void> {
    if (loading.value)
      return
    loading.value = true
    error.value = null

    try {
      const offset = reset ? 0 : conversations.value.length
      const rows = searchQuery.value.trim()
        ? await dbSearchConversations(searchQuery.value, PAGE_SIZE)
        : await dbListConversations(PAGE_SIZE, offset)

      if (reset) {
        conversations.value = rows
      }
      else {
        // deduplicate by id in case of concurrent appends
        const existing = new Set(conversations.value.map(c => c.id))
        conversations.value.push(...rows.filter(r => !existing.has(r.id)))
      }

      hasMore.value = rows.length === PAGE_SIZE
    }
    catch (e) {
      error.value = String(e)
    }
    finally {
      loading.value = false
    }
  }

  async function search(query: string): Promise<void> {
    searchQuery.value = query
    await load(true)
  }

  // ── mutations ────────────────────────────────────────────────────────────────
  async function rename(id: string, newTitle: string): Promise<void> {
    const trimmed = newTitle.trim()
    if (!trimmed)
      return
    await dbUpdateConversationTitle(id, trimmed)
    const conv = conversations.value.find(c => c.id === id)
    if (conv)
      conv.title = trimmed
  }

  async function remove(id: string): Promise<void> {
    await dbDeleteConversation(id)
    conversations.value = conversations.value.filter(c => c.id !== id)

    // also close any open tab for this conversation
    const chat = useChatStore()
    const tab = chat.tabs.find(t => t.conversationId === id)
    if (tab)
      chat.closeTab(tab.id)
  }

  async function removeByWorkspace(workspacePath: string): Promise<void> {
    // collect ids of conversations belonging to this workspace so we can close open tabs
    const convIds = conversations.value
      .filter(c => c.workspace_path === workspacePath)
      .map(c => c.id)

    await dbDeleteConversationsByWorkspace(workspacePath)
    conversations.value = conversations.value.filter(c => c.workspace_path !== workspacePath)

    // close any open tabs for the deleted conversations
    const chat = useChatStore()
    for (const id of convIds) {
      const tab = chat.tabs.find(t => t.conversationId === id)
      if (tab)
        chat.closeTab(tab.id)
    }
  }

  // ── open in tab ──────────────────────────────────────────────────────────────
  async function openInTab(conv: ConversationRow): Promise<void> {
    const chat = useChatStore()
    const project = useProjectStore()

    // if already open in a tab, just switch to it
    const existing = chat.tabs.find(t => t.conversationId === conv.id)
    if (existing) {
      chat.activeId = existing.id
      if (existing.workspacePath)
        project.setProject(existing.workspacePath)
      return
    }

    // load messages from DB
    const rows = await dbLoadMessages(conv.id)

    let workspaceMeta
    if (conv.workspace_meta) {
      try {
        workspaceMeta = JSON.parse(conv.workspace_meta)
      }
      catch { }
    }

    chat.openConversation({
      conversationId: conv.id,
      title: conv.title,
      workspacePath: conv.workspace_path ?? null,
      ...(workspaceMeta ? { workspaceMeta } : {}),
      ...(conv.is_design_tab ? { isDesignTab: true, mode: 'design' as const } : {}),
      ...(conv.designs ? { designs: JSON.parse(conv.designs) } : {}),
      messages: rows.map(r => {
        let toolEvents
        if (r.tool_events) {
          try {
            toolEvents = JSON.parse(r.tool_events)
          }
          catch {
            // silent catch
          }
        }
        let parts
        if (r.parts) {
          try {
            parts = JSON.parse(r.parts)
          }
          catch { }
        }
        let cacheStats
        if (r.cache_stats) {
          try {
            cacheStats = JSON.parse(r.cache_stats)
          }
          catch { }
        }
        let attachments
        if (r.attachments) {
          try {
            attachments = JSON.parse(r.attachments)
          }
          catch { }
        }
        if (!r.parts && r.content && r.role === 'assistant') {
          // Fallback legacy migration
          parts = [{ type: 'text', text: r.content }]
        }
        return {
          id: r.id,
          role: r.role,
          content: r.content,
          timestamp: new Date(r.created_at),
          ...(r.mention_context ? { mentionContext: r.mention_context } : {}),
          ...(toolEvents ? { toolEvents } : {}),
          ...(parts ? { parts } : {}),
          ...(attachments ? { attachments } : {}),
          ...(cacheStats ? { cacheStats } : {}),
          ...(r.elapsed_sec != null ? { elapsedSec: r.elapsed_sec } : {}),
          ...(r.model_uid ? { modelUid: r.model_uid } : {}),
          ...(r.model_name ? { modelName: r.model_name } : {}),
          ...(r.is_complete === 0 ? { error: 'Interrupted during generation.' } : {}),
          ...(r.is_bg_notification === 1 ? { isBgNotification: true } : {}),
        }
      }),
    })

    if (conv.workspace_path)
      project.setProject(conv.workspace_path)
  }

  // ── push a newly-created conversation into the top of the list ────────────────
  function prepend(conv: ConversationRow): void {
    conversations.value.unshift(conv)
  }

  return {
    conversations,
    searchQuery,
    loading,
    hasMore,
    error,
    isEmpty,
    load,
    search,
    rename,
    remove,
    removeByWorkspace,
    openInTab,
    prepend,
  }
})
