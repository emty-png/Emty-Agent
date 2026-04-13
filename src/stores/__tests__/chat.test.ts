import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat'

describe('chat store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with one empty tab', () => {
    const store = useChatStore()
    expect(store.tabs.length).toBe(1)
    expect(store.tabs[0]!.title).toBe('New chat')
    expect(store.tabs[0]!.messages).toEqual([])
  })

  it('has the first tab as active', () => {
    const store = useChatStore()
    expect(store.activeTab).toBe(store.tabs[0])
    expect(store.activeId).toBe(store.tabs[0]!.id)
  })

  it('adds a new tab and switches to it', () => {
    const store = useChatStore()
    store.addTab()
    expect(store.tabs.length).toBe(2)
    expect(store.activeTab.title).toBe('New chat')
    expect(store.activeId).toBe(store.tabs[1]!.id)
  })

  it('caps tabs at 9', () => {
    const store = useChatStore()
    // already has 1, add 8 more = 9
    for (let i = 0; i < 8; i++) {
      store.addTab()
    }
    expect(store.tabs.length).toBe(9)
    // 10th should be ignored
    store.addTab()
    expect(store.tabs.length).toBe(9)
  })

  it('closes a tab and switches to the previous one', () => {
    const store = useChatStore()
    store.addTab()
    store.addTab()
    const thirdId = store.activeId
    // 3 tabs total, active is the 3rd (idx=2)
    store.closeTab(thirdId)
    expect(store.tabs.length).toBe(2)
    // should have switched to the previous tab (idx=1, which is the 2nd tab now)
    expect(store.activeId).toBe(store.tabs[1]!.id)
  })

  it('creates a fresh tab when closing the last remaining tab', () => {
    const store = useChatStore()
    const firstId = store.tabs[0]!.id
    store.closeTab(firstId)
    expect(store.tabs.length).toBe(1)
    expect(store.activeTab.title).toBe('New chat')
    expect(store.activeTab.messages).toEqual([])
  })

  it('adds a user message and sets tab title from first message', () => {
    const store = useChatStore()
    store.sendMessage('Hello world')
    expect(store.activeTab.messages.length).toBe(1)
    expect(store.activeTab.messages[0]!.role).toBe('user')
    expect(store.activeTab.messages[0]!.content).toBe('Hello world')
    expect(store.activeTab.title).toBe('Hello world')
  })

  it('truncates tab title to 28 chars with ellipsis', () => {
    const store = useChatStore()
    const long = 'a'.repeat(50)
    store.sendMessage(long)
    expect(store.activeTab.title).toBe(`${'a'.repeat(28)}…`)
  })

  it('does not change tab title after the first message', () => {
    const store = useChatStore()
    store.sendMessage('First message')
    store.sendMessage('Second message')
    expect(store.activeTab.title).toBe('First message')
  })

  it('ignores blank input', () => {
    const store = useChatStore()
    store.sendMessage('   ')
    expect(store.activeTab.messages.length).toBe(0)
  })

  it('schedules an assistant reply after user message', () => {
    const store = useChatStore()
    store.sendMessage('Hey')
    expect(store.activeTab.messages.length).toBe(1)
    vi.advanceTimersByTime(700)
    expect(store.activeTab.messages.length).toBe(2)
    expect(store.activeTab.messages[1]!.role).toBe('assistant')
  })
})
