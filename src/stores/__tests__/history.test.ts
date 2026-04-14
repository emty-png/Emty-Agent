import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '@/db/database'
import { useHistoryStore } from '../history'

// Mock DB module
vi.mock('@/db/database', () => ({
  dbListConversations: vi.fn(),
  dbSearchConversations: vi.fn(),
  dbUpdateConversationTitle: vi.fn(),
  dbDeleteConversation: vi.fn(),
  dbLoadMessages: vi.fn(),
  dbInsertConversation: vi.fn(),
  dbInsertMessage: vi.fn(),
  dbTouchConversation: vi.fn(),
}))

function makeConv(overrides: Partial<db.ConversationRow> = {}): db.ConversationRow {
  return {
    id: `conv-${Math.random().toString(36).slice(2, 9)}`,
    title: 'Test Conversation',
    created_at: Date.now(),
    updated_at: Date.now(),
    msg_count: 0,
    ...overrides,
  }
}

describe('history store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── initial state ───────────────────────────────────────────────────────────

  it('starts with empty conversations', () => {
    const store = useHistoryStore()
    expect(store.conversations).toEqual([])
    expect(store.isEmpty).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.hasMore).toBe(true)
    expect(store.error).toBeNull()
    expect(store.searchQuery).toBe('')
  })

  // ── load (no search) ────────────────────────────────────────────────────────

  it('loads conversations from DB on first call', async () => {
    const convs = [makeConv({ title: 'First' }), makeConv({ title: 'Second' })]
    vi.mocked(db.dbListConversations).mockResolvedValue(convs)

    const store = useHistoryStore()
    await store.load()

    expect(db.dbListConversations).toHaveBeenCalledWith(50, 0)
    expect(store.conversations).toHaveLength(2)
    expect(store.conversations[0]!.title).toBe('First')
    expect(store.loading).toBe(false)
  })

  it('sets hasMore to false when fewer than PAGE_SIZE returned', async () => {
    vi.mocked(db.dbListConversations).mockResolvedValue([makeConv()])

    const store = useHistoryStore()
    await store.load()

    expect(store.hasMore).toBe(false)
  })

  it('sets hasMore to true when PAGE_SIZE returned', async () => {
    const page = Array.from({ length: 50 }, (_, i) => makeConv({ id: `c-${i}` }))
    vi.mocked(db.dbListConversations).mockResolvedValue(page)

    const store = useHistoryStore()
    await store.load()

    expect(store.hasMore).toBe(true)
  })

  it('appends on second load with correct offset', async () => {
    const page1 = [makeConv({ id: 'a' })]
    const page2 = [makeConv({ id: 'b' })]
    vi.mocked(db.dbListConversations)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)

    const store = useHistoryStore()
    await store.load()
    await store.load()

    expect(db.dbListConversations).toHaveBeenNthCalledWith(2, 50, 1)
    expect(store.conversations).toHaveLength(2)
    expect(store.conversations.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('deduplicates conversations on append', async () => {
    const conv = makeConv({ id: 'dup' })
    vi.mocked(db.dbListConversations)
      .mockResolvedValueOnce([conv])
      .mockResolvedValueOnce([conv, makeConv({ id: 'new' })])

    const store = useHistoryStore()
    await store.load()
    await store.load()

    expect(store.conversations).toHaveLength(2)
    expect(store.conversations.map(c => c.id)).toEqual(['dup', 'new'])
  })

  it('resets conversations when called with reset=true', async () => {
    vi.mocked(db.dbListConversations)
      .mockResolvedValueOnce([makeConv({ id: 'old1' }), makeConv({ id: 'old2' })])
      .mockResolvedValueOnce([makeConv({ id: 'fresh' })])

    const store = useHistoryStore()
    await store.load()
    expect(store.conversations).toHaveLength(2)

    await store.load(true)
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0]!.id).toBe('fresh')
    expect(db.dbListConversations).toHaveBeenNthCalledWith(2, 50, 0)
  })

  it('respects existing searchQuery on reset load', async () => {
    const searchResult = [makeConv({ title: 'Found' })]
    vi.mocked(db.dbSearchConversations).mockResolvedValue(searchResult)

    const store = useHistoryStore()
    store.searchQuery = 'Found'
    await store.load(true)

    expect(db.dbSearchConversations).toHaveBeenCalledWith('Found', 50)
    expect(db.dbListConversations).not.toHaveBeenCalled()
    expect(store.conversations[0]!.title).toBe('Found')
  })

  it('does not run concurrent loads', async () => {
    let resolveFn: (v: db.ConversationRow[]) => void
    vi.mocked(db.dbListConversations).mockReturnValue(
      new Promise(resolve => { resolveFn = resolve }),
    )

    const store = useHistoryStore()
    const p1 = store.load()
    const p2 = store.load()

    resolveFn!([makeConv()])
    await Promise.all([p1, p2])

    expect(db.dbListConversations).toHaveBeenCalledTimes(1)
  })

  it('sets error on load failure', async () => {
    vi.mocked(db.dbListConversations).mockRejectedValue(new Error('DB error'))

    const store = useHistoryStore()
    await store.load()

    expect(store.error).toBe('Error: DB error')
    expect(store.loading).toBe(false)
  })

  // ── search ──────────────────────────────────────────────────────────────────

  it('search sets query and resets conversations', async () => {
    const results = [makeConv({ title: 'Match' })]
    vi.mocked(db.dbSearchConversations).mockResolvedValue(results)

    const store = useHistoryStore()
    store.conversations = [makeConv({ id: 'prev' })]
    await store.search('Match')

    expect(store.searchQuery).toBe('Match')
    expect(db.dbSearchConversations).toHaveBeenCalledWith('Match', 50)
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0]!.title).toBe('Match')
  })

  // ── rename ──────────────────────────────────────────────────────────────────

  it('renames a conversation in DB and in local state', async () => {
    const conv = makeConv({ id: 'r1', title: 'Old Title' })
    const store = useHistoryStore()
    store.conversations.push(conv)

    await store.rename('r1', 'New Title')

    expect(db.dbUpdateConversationTitle).toHaveBeenCalledWith('r1', 'New Title')
    expect(store.conversations.find(c => c.id === 'r1')!.title).toBe('New Title')
  })

  it('ignores rename with blank title', async () => {
    const conv = makeConv({ id: 'r2', title: 'Keep Me' })
    const store = useHistoryStore()
    store.conversations.push(conv)

    await store.rename('r2', '   ')

    expect(db.dbUpdateConversationTitle).not.toHaveBeenCalled()
    expect(store.conversations.find(c => c.id === 'r2')!.title).toBe('Keep Me')
  })

  it('ignores rename for unknown id in local state', async () => {
    const store = useHistoryStore()
    await store.rename('nonexistent', 'Whatever')
    // DB call still happens but no local state to update
    expect(db.dbUpdateConversationTitle).toHaveBeenCalledWith('nonexistent', 'Whatever')
  })

  // ── remove ──────────────────────────────────────────────────────────────────

  it('removes a conversation from DB and local state', async () => {
    const conv = makeConv({ id: 'del' })
    const store = useHistoryStore()
    store.conversations.push(conv)

    await store.remove('del')

    expect(db.dbDeleteConversation).toHaveBeenCalledWith('del')
    expect(store.conversations).toHaveLength(0)
  })

  it('closes any open tab for the removed conversation', async () => {
    const conv = makeConv({ id: 'del-tab' })
    const store = useHistoryStore()
    store.conversations.push(conv)

    // Simulate an open tab via chat store
    const { useChatStore } = await import('../chat')
    const chat = useChatStore()
    chat.tabs.push({
      id: 'tab-1',
      title: conv.title,
      messages: [],
      conversationId: conv.id,
    })
    chat.activeId = 'tab-1'

    await store.remove(conv.id)

    expect(chat.tabs.find(t => t.conversationId === conv.id)).toBeUndefined()
  })

  // ── openInTab ───────────────────────────────────────────────────────────────

  it('loads messages and opens a conversation in a new tab', async () => {
    const conv = makeConv({ id: 'open1', title: 'Open Me' })
    const msgs = [
      { id: 'm1', conversation_id: 'open1', role: 'user' as const, content: 'Hi', created_at: 1000 },
      { id: 'm2', conversation_id: 'open1', role: 'assistant' as const, content: 'Hello', created_at: 2000 },
    ]
    vi.mocked(db.dbLoadMessages).mockResolvedValue(msgs)

    const store = useHistoryStore()
    await store.openInTab(conv)

    expect(db.dbLoadMessages).toHaveBeenCalledWith('open1')
    const { useChatStore } = await import('../chat')
    const chat = useChatStore()
    const tab = chat.tabs.find(t => t.conversationId === 'open1')
    expect(tab).toBeDefined()
    expect(tab!.messages).toHaveLength(2)
    expect(chat.activeId).toBe(tab!.id)
  })

  it('switches to existing tab instead of creating a duplicate', async () => {
    const conv = makeConv({ id: 'dup-tab', title: 'Dup' })
    const { useChatStore } = await import('../chat')
    const chat = useChatStore()

    // Pre-populate a tab
    chat.tabs.push({
      id: 'existing-tab',
      title: conv.title,
      messages: [],
      conversationId: conv.id,
    })
    chat.activeId = 'some-other-tab'

    await useHistoryStore().openInTab(conv)

    expect(db.dbLoadMessages).not.toHaveBeenCalled()
    expect(chat.activeId).toBe('existing-tab')
    expect(chat.tabs.filter(t => t.conversationId === conv.id)).toHaveLength(1)
  })

  // ── prepend ─────────────────────────────────────────────────────────────────

  it('prepends a conversation to the top of the list', () => {
    const existing = makeConv({ id: 'old' })
    const newConv = makeConv({ id: 'new' })
    const store = useHistoryStore()
    store.conversations.push(existing)

    store.prepend(newConv)

    expect(store.conversations[0]!.id).toBe('new')
    expect(store.conversations[1]!.id).toBe('old')
  })
})
