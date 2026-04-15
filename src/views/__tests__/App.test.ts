import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'

// Mock database init
vi.mock('@/db/database', () => ({
  getDb: vi.fn().mockResolvedValue({}),
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

describe('app component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the TitleBar', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.titlebar').exists()).toBe(true)
  })

  it('renders the Sidebar', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.sidebar').exists()).toBe(true)
  })

  it('shows ChatView by default', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.chat-root').exists()).toBe(true)
  })

  it('switches to HistoryView when activeView changes', async () => {
    const wrapper = mount(App)
    // Get the component instance to change activeView
    const vm = wrapper.vm as unknown as { activeView: string }
    vm.activeView = 'history'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.history-root').exists()).toBe(true)
    expect(wrapper.find('.chat-root').exists()).toBe(false)
  })

  it('switches to ProjectView when activeView changes', async () => {
    const wrapper = mount(App)
    const vm = wrapper.vm as unknown as { activeView: string }
    vm.activeView = 'projects'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.project-root').exists()).toBe(true)
    expect(wrapper.find('.chat-root').exists()).toBe(false)
  })

  it('switches back to chat from history', async () => {
    const wrapper = mount(App)
    const vm = wrapper.vm as unknown as { activeView: string }
    vm.activeView = 'history'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.history-root').exists()).toBe(true)

    vm.activeView = 'chat'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.chat-root').exists()).toBe(true)
    expect(wrapper.find('.history-root').exists()).toBe(false)
  })

  it('initializes database on mount', async () => {
    const { getDb } = await import('@/db/database')
    mount(App)
    await flushPromises()

    expect(getDb).toHaveBeenCalled()
  })

  it('has activeView reactive state', () => {
    const wrapper = mount(App)
    const vm = wrapper.vm as unknown as { activeView: string }
    expect(vm.activeView).toBe('chat')
  })
})
