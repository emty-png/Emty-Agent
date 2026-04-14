import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Import after mocking
import {
  dbDeleteConversation,
  dbInsertConversation,
  dbInsertMessage,
  dbListConversations,
  dbLoadMessages,
  dbSearchConversations,
  dbTouchConversation,
  dbUpdateConversationTitle,
  getDb,
} from '@/db/database'

// Mock the SQL plugin before any imports
const mockSelect = vi.fn().mockResolvedValue([])
const mockExecute = vi.fn().mockResolvedValue({})

vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({}),
  }
  return {
    default: class Database {
      static load = vi.fn(() => Promise.resolve(mockDb))
    },
    mockDb,
  }
})

describe('database', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── getDb ───────────────────────────────────────────────────────────────────

  it('returns a database instance from getDb', async () => {
    const db = await getDb()
    expect(db).toBeDefined()
  })

  it('returns cached instance on subsequent calls', async () => {
    const db1 = await getDb()
    const db2 = await getDb()
    // getDb caches the instance, so both calls return the same object
    expect(db1).toBe(db2)
  })

  // ── dbInsertConversation ────────────────────────────────────────────────────

  it('inserts a conversation row', async () => {
    const conv = {
      id: 'conv-1',
      title: 'Test Chat',
      created_at: 1000,
      updated_at: 1000,
    }

    await dbInsertConversation(conv)

    const db = await getDb()
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO conversations'),
      [conv.id, conv.title, conv.created_at, conv.updated_at],
    )
  })

  // ── dbUpdateConversationTitle ───────────────────────────────────────────────

  it('updates title and timestamp', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)

    await dbUpdateConversationTitle('conv-1', 'New Title')

    const db = await getDb()
    expect(db.execute).toHaveBeenCalledWith(
      'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?',
      ['New Title', now, 'conv-1'],
    )
  })

  // ── dbTouchConversation ─────────────────────────────────────────────────────

  it('increments msg_count and updates timestamp', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)

    await dbTouchConversation('conv-1')

    const db = await getDb()
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE conversations'),
      [now, 'conv-1'],
    )
  })

  // ── dbDeleteConversation ────────────────────────────────────────────────────

  it('deletes conversation by id', async () => {
    await dbDeleteConversation('conv-1')

    const db = await getDb()
    expect(db.execute).toHaveBeenCalledWith(
      'DELETE FROM conversations WHERE id = ?',
      ['conv-1'],
    )
  })

  // ── dbInsertMessage ─────────────────────────────────────────────────────────

  it('inserts a message row', async () => {
    const msg = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      role: 'user' as const,
      content: 'Hello',
      created_at: 2000,
    }

    await dbInsertMessage(msg)

    const db = await getDb()
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at],
    )
  })

  // ── dbListConversations ─────────────────────────────────────────────────────

  it('selects conversations ordered by updated_at DESC with default limit/offset', async () => {
    const rows = [
      { id: 'a', title: 'A', created_at: 1, updated_at: 2, msg_count: 1 },
      { id: 'b', title: 'B', created_at: 3, updated_at: 4, msg_count: 2 },
    ]
    const db = await getDb()
    db.select.mockResolvedValueOnce(rows)

    const result = await dbListConversations()

    expect(db.select).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
      [50, 0],
    )
    expect(result).toEqual(rows)
  })

  it('passes custom limit and offset', async () => {
    const db = await getDb()
    db.select.mockResolvedValueOnce([])

    await dbListConversations(10, 20)

    expect(db.select).toHaveBeenCalledWith(
      expect.any(String),
      [10, 20],
    )
  })

  // ── dbSearchConversations ───────────────────────────────────────────────────

  it('searches using FTS5 with wildcard and strips special chars', async () => {
    const results = [{ id: 'a', title: 'About cats', created_at: 1, updated_at: 2, msg_count: 1 }]
    const db = await getDb()
    db.select.mockResolvedValueOnce(results)

    const found = await dbSearchConversations('cats', 20)

    expect(db.select).toHaveBeenCalledWith(
      expect.stringContaining('conversations_fts MATCH ?'),
      ['cats*', 20],
    )
    expect(found).toEqual(results)
  })

  it('escapes double quotes and asterisks from query', async () => {
    const db = await getDb()
    db.select.mockResolvedValueOnce([])

    await dbSearchConversations('he"llo*')

    expect(db.select).toHaveBeenCalledWith(
      expect.any(String),
      ['hello*', 50],
    )
  })

  // ── dbLoadMessages ──────────────────────────────────────────────────────────

  it('loads messages for a conversation ordered by created_at ASC', async () => {
    const msgs = [
      { id: 'm1', conversation_id: 'conv-1', role: 'user', content: 'Hi', created_at: 100 },
      { id: 'm2', conversation_id: 'conv-1', role: 'assistant', content: 'Hey', created_at: 200 },
    ]
    const db = await getDb()
    db.select.mockResolvedValueOnce(msgs)

    const result = await dbLoadMessages('conv-1')

    expect(db.select).toHaveBeenCalledWith(
      expect.stringContaining('WHERE conversation_id = ?'),
      ['conv-1'],
    )
    expect(result).toEqual(msgs)
  })
})
