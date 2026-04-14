import Database from '@tauri-apps/plugin-sql'

// ── singleton ─────────────────────────────────────────────────────────────────
let db: Database | null = null
let initPromise: Promise<Database> | null = null

export async function getDb(): Promise<Database> {
  if (db)
    return db
  if (initPromise)
    return initPromise

  initPromise = Database.load('sqlite:emty.db').then(async instance => {
    await migrate(instance)
    db = instance
    return instance
  })

  return initPromise
}

// ── schema migrations ─────────────────────────────────────────────────────────
// Add new statements to the end — never mutate existing ones.
const MIGRATIONS: string[] = [
  // v1 — initial schema
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT    PRIMARY KEY,
    title       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    msg_count   INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_conv_updated
    ON conversations (updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK(role IN ('user','assistant')),
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_msg_conv
    ON messages (conversation_id, created_at ASC)`,

  // full-text search on conversation titles
  `CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts
    USING fts5(id UNINDEXED, title, content=conversations, content_rowid=rowid)`,

  `CREATE TRIGGER IF NOT EXISTS conv_fts_insert
    AFTER INSERT ON conversations BEGIN
      INSERT INTO conversations_fts(rowid, id, title) VALUES (new.rowid, new.id, new.title);
    END`,

  `CREATE TRIGGER IF NOT EXISTS conv_fts_delete
    AFTER DELETE ON conversations BEGIN
      INSERT INTO conversations_fts(conversations_fts, rowid, id, title)
        VALUES ('delete', old.rowid, old.id, old.title);
    END`,

  `CREATE TRIGGER IF NOT EXISTS conv_fts_update
    AFTER UPDATE OF title ON conversations BEGIN
      INSERT INTO conversations_fts(conversations_fts, rowid, id, title)
        VALUES ('delete', old.rowid, old.id, old.title);
      INSERT INTO conversations_fts(rowid, id, title) VALUES (new.rowid, new.id, new.title);
    END`,
]

async function migrate(instance: Database): Promise<void> {
  const rows = await instance.select<{ version: number }[]>(
    'SELECT version FROM schema_version LIMIT 1',
  ).catch(() => [] as { version: number }[])

  const current = rows[0]?.version ?? 0

  // Ensure created_at exists in messages table for existing databases
  // that were created before the column was added to the schema
  const msgsInfo = await instance.select<{ name: string }[]>(
    'PRAGMA table_info(messages)',
  ).catch(() => [])
  if (msgsInfo.length > 0 && !msgsInfo.some(c => c.name === 'created_at')) {
    await instance.execute('ALTER TABLE messages ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
  }

  const convsInfo = await instance.select<{ name: string }[]>(
    'PRAGMA table_info(conversations)',
  ).catch(() => [])
  if (convsInfo.length > 0 && !convsInfo.some(c => c.name === 'created_at')) {
    await instance.execute('ALTER TABLE conversations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
  }
  if (convsInfo.length > 0 && !convsInfo.some(c => c.name === 'updated_at')) {
    await instance.execute('ALTER TABLE conversations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
  }

  if (current >= MIGRATIONS.length)
    return

  for (let i = current; i < MIGRATIONS.length; i++) {
    await instance.execute(MIGRATIONS[i]!)
  }

  await instance.execute(
    'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
    [MIGRATIONS.length],
  )
}

// ── typed query helpers ───────────────────────────────────────────────────────
export interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  msg_count: number
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export async function dbInsertConversation(
  conv: Omit<ConversationRow, 'msg_count'>,
): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO conversations (id, title, created_at, updated_at, msg_count)
     VALUES (?, ?, ?, ?, 0)`,
    [conv.id, conv.title, conv.created_at, conv.updated_at],
  )
}

export async function dbUpdateConversationTitle(
  id: string,
  title: string,
): Promise<void> {
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?',
    [title, Date.now(), id],
  )
}

export async function dbTouchConversation(id: string): Promise<void> {
  const d = await getDb()
  await d.execute(
    `UPDATE conversations
     SET updated_at = ?, msg_count = msg_count + 1
     WHERE id = ?`,
    [Date.now(), id],
  )
}

export async function dbDeleteConversation(id: string): Promise<void> {
  const d = await getDb()
  // cascade deletes messages via FK
  await d.execute('DELETE FROM conversations WHERE id = ?', [id])
}

export async function dbInsertMessage(msg: MessageRow): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at],
  )
}

export async function dbListConversations(
  limit = 50,
  offset = 0,
): Promise<ConversationRow[]> {
  const d = await getDb()
  return d.select<ConversationRow[]>(
    'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  )
}

export async function dbSearchConversations(
  query: string,
  limit = 50,
): Promise<ConversationRow[]> {
  const d = await getDb()
  // FTS5 with rank ordering; escape special chars
  const safe = query.replace(/["*]/g, '')
  return d.select<ConversationRow[]>(
    `SELECT c.* FROM conversations c
     JOIN conversations_fts f ON c.id = f.id
     WHERE conversations_fts MATCH ?
     ORDER BY rank LIMIT ?`,
    [`${safe}*`, limit],
  )
}

export async function dbLoadMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const d = await getDb()
  return d.select<MessageRow[]>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  )
}
