import type { ConversationRow } from '@/db/database'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {

  dbDeleteConversation,
  dbListConversations,
  dbLoadMessages,
  dbSearchConversations,
  dbUpdateConversationTitle,
} from '@/db/database'
import { useChatStore } from './chat'

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

  // ── open in tab ──────────────────────────────────────────────────────────────
  async function openInTab(conv: ConversationRow): Promise<void> {
    const chat = useChatStore()

    // if already open in a tab, just switch to it
    const existing = chat.tabs.find(t => t.conversationId === conv.id)
    if (existing) {
      chat.activeId = existing.id
      return
    }

    // load messages from DB
    const rows = await dbLoadMessages(conv.id)

    chat.openConversation({
      conversationId: conv.id,
      title: conv.title,
      messages: rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        timestamp: new Date(r.created_at),
      })),
    })
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
    openInTab,
    prepend,
  }
})
