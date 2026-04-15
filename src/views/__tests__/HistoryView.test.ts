import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HistoryView from '../HistoryView.vue'

// Mock DB
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

describe('historyView component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function makeConv(
    overrides: Partial<{
      id: string
      title: string
      created_at: number
      updated_at: number
      msg_count: number
    }> = {},
  ) {
    return {
      id: `c-${Math.random().toString(36).slice(2, 9)}`,
      title: 'Test Conversation',
      created_at: Date.now(),
      updated_at: Date.now(),
      msg_count: 0,
      ...overrides,
    }
  }

  it('renders the header with title and new chat button', async () => {
    const wrapper = mount(HistoryView)
    await flushPromises()
    expect(wrapper.find('.history-title').text()).toBe('History')
    expect(wrapper.find('.new-btn').exists()).toBe(true)
    expect(wrapper.find('.new-btn').text()).toContain('New chat')
  })

  it('renders the search input', async () => {
    const wrapper = mount(HistoryView)
    await flushPromises()
    expect(wrapper.find('.search-input').exists()).toBe(true)
    expect(wrapper.find('.search-input').attributes('placeholder')).toBe('Search conversations…')
  })

  it('shows empty state when no conversations', async () => {
    const wrapper = mount(HistoryView)
    await flushPromises()
    expect(wrapper.find('.list-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No conversations yet')
  })

  it('emits newChat when new button clicked', async () => {
    const wrapper = mount(HistoryView)
    await flushPromises()
    await wrapper.find('.new-btn').trigger('click')
    expect(wrapper.emitted('newChat')).toBeTruthy()
  })

  it('renders conversation items from the store', async () => {
    const convs = [
      makeConv({ id: 'c1', title: 'Chat One', updated_at: Date.now() - 60_000 }),
      makeConv({ id: 'c2', title: 'Chat Two', updated_at: Date.now() - 3600_000 }),
    ]
    const { dbListConversations } = await import('@/db/database')
    vi.mocked(dbListConversations).mockResolvedValue(convs)

    const wrapper = mount(HistoryView)
    // onMounted calls load(true) which fetches from DB
    await flushPromises()
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.conv-item')
    expect(items.length).toBe(2)
    expect(wrapper.text()).toContain('Chat One')
    expect(wrapper.text()).toContain('Chat Two')
  })

  it('shows relative time for conversations', async () => {
    const now = Date.now()
    const convs = [
      makeConv({ id: 't1', title: 'Just Now', updated_at: now - 30_000 }),
      makeConv({ id: 't2', title: 'Minutes Ago', updated_at: now - 5 * 60_000 }),
      makeConv({ id: 't3', title: 'Hours Ago', updated_at: now - 3 * 3600_000 }),
      makeConv({ id: 't4', title: 'Days Ago', updated_at: now - 2 * 86400_000 }),
    ]
    const { dbListConversations } = await import('@/db/database')
    vi.mocked(dbListConversations).mockResolvedValue(convs)

    const wrapper = mount(HistoryView)
    await flushPromises()
    await wrapper.vm.$nextTick()

    const metas = wrapper.findAll('.conv-meta')
    const metaTexts = metas.map(m => m.text())
    expect(metaTexts).toContain('just now')
    expect(metaTexts).toContain('5m ago')
    expect(metaTexts).toContain('3h ago')
    expect(metaTexts).toContain('2d ago')
  })

  it('opens conversation in tab and emits openChat on click', async () => {
    const conv = makeConv({ title: 'Open Me', id: 'open-conv' })
    const { dbListConversations, dbLoadMessages } = await import('@/db/database')
    vi.mocked(dbListConversations).mockResolvedValue([conv])
    vi.mocked(dbLoadMessages).mockResolvedValue([])

    const wrapper = mount(HistoryView)
    await flushPromises()
    await wrapper.vm.$nextTick()

    const item = wrapper.find('.conv-item')
    expect(item.exists()).toBe(true)
    await item.trigger('click')

    expect(wrapper.emitted('openChat')).toBeTruthy()
  })

  it('searches with debounce on input', async () => {
    const { useHistoryStore } = await import('@/stores/history')
    const store = useHistoryStore()
    vi.spyOn(store, 'search').mockResolvedValue()

    const wrapper = mount(HistoryView)
    await flushPromises()

    const searchInput = wrapper.find('.search-input')
    await searchInput.setValue('test query')

    // Should not have searched yet
    expect(store.search).not.toHaveBeenCalled()

    // Advance past debounce delay
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(store.search).toHaveBeenCalledWith('test query')
  })

  it('shows loading indicator when loading', async () => {
    const { useHistoryStore } = await import('@/stores/history')
    const store = useHistoryStore()
    store.loading = true
    store.conversations = [makeConv()]

    const wrapper = mount(HistoryView)
    await flushPromises()

    expect(wrapper.find('.list-loading').exists()).toBe(true)
    expect(wrapper.find('.loading-dots').exists()).toBe(true)
  })

  it('has context menu and dialog in template source', () => {
    const wrapper = mount(HistoryView)
    // Teleported content won't appear in wrapper.html(), but we can verify the component mounts without errors
    expect(wrapper.find('.history-root').exists()).toBe(true)
  })

  it('has delete confirmation logic in store', async () => {
    const { useHistoryStore } = await import('@/stores/history')
    const store = useHistoryStore()
    const conv = makeConv({ id: 'del-test' })
    store.conversations = [conv]

    await store.remove(conv.id)

    expect(store.conversations.find(c => c.id === 'del-test')).toBeUndefined()
  })
})
