import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  dbInsertConversation,
  dbInsertMessage,
  dbTouchConversation,
  dbUpdateConversationTitle,
} from '@/db/database'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface ChatTab {
  id: string
  title: string
  messages: Message[]
  conversationId: string | null
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function newTab(): ChatTab {
  return { id: makeId(), title: 'New chat', messages: [], conversationId: null }
}

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref(tabs.value[0]!.id)

  const activeTab = computed(
    () => tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0]!
  )

  function addTab(): void {
    if (tabs.value.length >= 9) return
    const tab = newTab()
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function closeTab(id: string): void {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (tabs.value.length === 1) {
      tabs.value = [newTab()]
      activeId.value = tabs.value[0]!.id
      return
    }
    tabs.value.splice(idx, 1)
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.max(0, idx - 1)]!.id
    }
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
        }
        activeId.value = tabs.value[blankIdx]!.id
        return
      }
    }
    const tab: ChatTab = {
      id: makeId(),
      title: payload.title,
      messages: payload.messages,
      conversationId: payload.conversationId,
    }
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  async function sendMessage(content: string): Promise<void> {
    const tab = activeTab.value
    if (!content.trim()) return
    const now = Date.now()
    const text = content.trim()

    if (!tab.conversationId) {
      const title = text.slice(0, 60) + (text.length > 60 ? '\u2026' : '')
      const convId = makeId()
      await dbInsertConversation({ id: convId, title, created_at: now, updated_at: now })
      tab.conversationId = convId
      tab.title = title
      const { useHistoryStore } = await import('./history')
      useHistoryStore().prepend({ id: convId, title, created_at: now, updated_at: now, msg_count: 0 })
    }

    const userMsg: Message = { id: makeId(), role: 'user', content: text, timestamp: new Date(now) }
    await dbInsertMessage({ id: userMsg.id, conversation_id: tab.conversationId!, role: 'user', content: text, created_at: now })
    await dbTouchConversation(tab.conversationId!)
    tab.messages.push(userMsg)

    const assistantId = makeId()
    setTimeout(async () => {
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '...', timestamp: new Date() }
      if (tab.conversationId) {
        await dbInsertMessage({ id: assistantId, conversation_id: tab.conversationId, role: 'assistant', content: '...', created_at: Date.now() })
        await dbTouchConversation(tab.conversationId)
      }
      tab.messages.push(assistantMsg)
    }, 600)
  }

  async function renameTab(tabId: string, newTitle: string): Promise<void> {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    tab.title = newTitle
    if (tab.conversationId) await dbUpdateConversationTitle(tab.conversationId, newTitle)
  }

  return { tabs, activeId, activeTab, addTab, closeTab, openConversation, sendMessage, renameTab }
})