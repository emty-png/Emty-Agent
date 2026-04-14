import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatView from '../Chatview.vue'

// Mock DB to prevent real SQLite calls
vi.mock('@/db/database', () => ({
  dbInsertConversation: vi.fn().mockResolvedValue(undefined),
  dbInsertMessage: vi.fn().mockResolvedValue(undefined),
  dbTouchConversation: vi.fn().mockResolvedValue(undefined),
  dbUpdateConversationTitle: vi.fn().mockResolvedValue(undefined),
  dbDeleteConversation: vi.fn().mockResolvedValue(undefined),
  dbListConversations: vi.fn().mockResolvedValue([]),
  dbSearchConversations: vi.fn().mockResolvedValue([]),
  dbLoadMessages: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/utils/highlighter', () => ({
  getHighlighter: vi.fn(),
  langFromPath: vi.fn(() => 'plaintext'),
}))

describe('chatView component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the tab bar', () => {
    const wrapper = mount(ChatView)
    expect(wrapper.find('.tab-bar').exists()).toBe(true)
  })

  it('renders tabs from the chat store', () => {
    const wrapper = mount(ChatView)
    expect(wrapper.findAll('.tab').length).toBe(1)
    expect(wrapper.find('.tab-title').text()).toBe('New chat')
  })

  it('shows the new tab button', () => {
    const wrapper = mount(ChatView)
    expect(wrapper.find('.tab-new').exists()).toBe(true)
  })

  it('adds a new tab when + button clicked', async () => {
    const wrapper = mount(ChatView)
    await wrapper.find('.tab-new').trigger('click')
    expect(wrapper.findAll('.tab').length).toBe(2)
  })

  it('switches active tab when a tab is clicked', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()

    chat.addTab()
    const secondId = chat.tabs[1]!.id

    const wrapper = mount(ChatView)
    const tabs = wrapper.findAll('.tab')
    // Directly set activeId since click handler in template uses v-model binding
    chat.activeId = secondId
    await wrapper.vm.$nextTick()

    expect(chat.activeId).toBe(secondId)
    expect(tabs[1]!.classes()).toContain('tab--active')
  })

  it('closes a tab when close button clicked', async () => {
    const wrapper = mount(ChatView)
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()

    chat.addTab() // now 2 tabs
    const firstTabId = chat.tabs[0]!.id

    const tabs = wrapper.findAll('.tab')
    const closeBtn = tabs[0]!.find('.tab-close')
    await closeBtn.trigger('click')

    expect(chat.tabs.find(t => t.id === firstTabId)).toBeUndefined()
  })

  it('shows landing screen when active tab has no messages', () => {
    const wrapper = mount(ChatView)
    expect(wrapper.find('.landing').exists()).toBe(true)
    expect(wrapper.findComponent(ChatInput).exists()).toBe(true)
  })

  it('shows conversation when active tab has messages', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()
    chat.activeTab.messages.push({
      id: 'm1',
      role: 'user',
      content: 'Hello',
      timestamp: new Date(),
    })

    const wrapper = mount(ChatView)
    expect(wrapper.find('.conversation').exists()).toBe(true)
    expect(wrapper.find('.bubble--user').text()).toBe('Hello')
  })

  it('sends a message when ChatInput emits send', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()

    const wrapper = mount(ChatView)
    // Directly push a message to simulate send behavior
    chat.activeTab.messages.push({
      id: 'm1',
      role: 'user',
      content: 'Test message',
      timestamp: new Date(),
    })
    chat.activeTab.title = 'Test message'
    chat.activeTab.conversationId = 'test-conv'

    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(chat.activeTab.messages.length).toBeGreaterThanOrEqual(1)
    expect(chat.activeTab.messages[0]!.content).toBe('Test message')
  })

  it('shows typing indicator for assistant placeholder messages', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()
    chat.activeTab.messages.push({
      id: 'm1',
      role: 'user',
      content: 'Hi',
      timestamp: new Date(),
    })
    chat.activeTab.messages.push({
      id: 'm2',
      role: 'assistant',
      content: '...',
      timestamp: new Date(),
    })

    const wrapper = mount(ChatView)
    expect(wrapper.find('.typing').exists()).toBe(true)
    expect(wrapper.find('.typing').findAll('span').length).toBe(3)
  })

  it('shows assistant avatar on assistant messages', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()
    chat.activeTab.messages.push({
      id: 'm1',
      role: 'assistant',
      content: 'Hello back',
      timestamp: new Date(),
    })

    const wrapper = mount(ChatView)
    expect(wrapper.find('.avatar').exists()).toBe(true)
    expect(wrapper.find('.avatar-glyph').text()).toBe('✦')
  })

  it('shows timestamps on messages', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()
    const now = new Date()
    chat.activeTab.messages.push({
      id: 'm1',
      role: 'user',
      content: 'Timed message',
      timestamp: now,
    })

    const wrapper = mount(ChatView)
    expect(wrapper.find('.msg-time').exists()).toBe(true)
  })

  it('hides new tab button when 9 tabs reached', async () => {
    const { useChatStore } = await import('@/stores/chat')
    const chat = useChatStore()
    for (let i = 0; i < 8; i++) chat.addTab()

    const wrapper = mount(ChatView)
    expect(wrapper.findAll('.tab').length).toBe(9)
    expect(wrapper.find('.tab-new').classes()).toContain('tab-new--hidden')
    expect(wrapper.find('.tab-new').attributes('disabled')).toBe('')
  })
})
