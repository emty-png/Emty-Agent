import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
}

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

function newTab(): ChatTab {
  return { id: makeId(), title: 'New chat', messages: [] }
}

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([newTab()])
  const activeId = ref(tabs.value[0]!.id)

  const activeTab = computed(() =>
    tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0]!,
  )

  function addTab() {
    if (tabs.value.length >= 9)
      return
    const tab = newTab()
    tabs.value.push(tab)
    activeId.value = tab.id
  }

  function closeTab(id: string) {
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

  function sendMessage(content: string) {
    const tab = activeTab.value
    if (!content.trim())
      return

    // set tab title from first message
    if (tab.messages.length === 0) {
      tab.title = content.slice(0, 28) + (content.length > 28 ? '…' : '')
    }

    tab.messages.push({
      id: makeId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    })

    // stub assistant reply
    setTimeout(() => {
      tab.messages.push({
        id: makeId(),
        role: 'assistant',
        content: '...',
        timestamp: new Date(),
      })
    }, 600)
  }

  return { tabs, activeId, activeTab, addTab, closeTab, sendMessage }
})
