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
    created_at      INTEGER NOT NULL,
    tool_events     TEXT
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

  // v2 — checkpoint / restore-point schema
  `CREATE TABLE IF NOT EXISTS checkpoints (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_index   INTEGER NOT NULL,
    label           TEXT    NOT NULL,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_checkpoint_conv
    ON checkpoints (conversation_id, created_at ASC)`,

  `CREATE TABLE IF NOT EXISTS checkpoint_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_id   TEXT    NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    relative_path   TEXT    NOT NULL,
    absolute_path   TEXT    NOT NULL,
    content         TEXT,
    existed         INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cpfile_checkpoint
    ON checkpoint_files (checkpoint_id)`,
]

async function migrate(instance: Database): Promise<void> {
  const rows = await instance
    .select<{ version: number }[]>('SELECT version FROM schema_version LIMIT 1')
    .catch(() => [] as { version: number }[])

  const current = rows[0]?.version ?? 0

  // Ensure created_at exists in messages table for existing databases
  // that were created before the column was added to the schema
  const msgsInfo = await instance
    .select<{ name: string }[]>('PRAGMA table_info(messages)')
    .catch(() => [])

  if (msgsInfo.length > 0 && !msgsInfo.some(c => c.name.toLowerCase() === 'created_at')) {
    await instance.execute('ALTER TABLE messages ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
  }
  if (msgsInfo.length > 0 && !msgsInfo.some(c => c.name.toLowerCase() === 'tool_events')) {
    await instance.execute('ALTER TABLE messages ADD COLUMN tool_events TEXT')
  }
  if (msgsInfo.length > 0 && !msgsInfo.some(c => c.name.toLowerCase() === 'parts')) {
    await instance.execute('ALTER TABLE messages ADD COLUMN parts TEXT')
  }

  const convsInfo = await instance
    .select<{ name: string }[]>('PRAGMA table_info(conversations)')
    .catch(() => [])
  if (convsInfo.length > 0 && !convsInfo.some(c => c.name === 'created_at')) {
    await instance.execute(
      'ALTER TABLE conversations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0',
    )
  }
  if (convsInfo.length > 0 && !convsInfo.some(c => c.name === 'updated_at')) {
    await instance.execute(
      'ALTER TABLE conversations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0',
    )
  }

  if (current >= MIGRATIONS.length)
    return

  for (let i = current; i < MIGRATIONS.length; i++) {
    await instance.execute(MIGRATIONS[i]!)
  }

  await instance.execute('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [
    MIGRATIONS.length,
  ])
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
  tool_events?: string | null
  parts?: string | null
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

export async function dbUpdateConversationTitle(id: string, title: string): Promise<void> {
  const d = await getDb()
  await d.execute('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
    title,
    Date.now(),
    id,
  ])
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
    `INSERT INTO messages (id, conversation_id, role, content, created_at, tool_events, parts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at, msg.tool_events ?? null, msg.parts ?? null],
  )
}

export async function dbListConversations(limit = 50, offset = 0): Promise<ConversationRow[]> {
  const d = await getDb()
  return d.select<ConversationRow[]>(
    'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  )
}

export async function dbSearchConversations(query: string, limit = 50): Promise<ConversationRow[]> {
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

export async function dbLoadMessages(conversationId: string): Promise<MessageRow[]> {
  const d = await getDb()
  return d.select<MessageRow[]>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  )
}

export async function dbDeleteMessages(ids: string[]): Promise<void> {
  if (ids.length === 0)
    return
  const d = await getDb()
  const placeholders = ids.map(() => '?').join(', ')
  await d.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, ids)
}

// ── checkpoint helpers ────────────────────────────────────────────────────────

export interface CheckpointRow {
  id: string
  conversation_id: string
  message_index: number
  label: string
  created_at: number
}

export interface CheckpointFileRow {
  id?: number
  checkpoint_id: string
  relative_path: string
  absolute_path: string
  content: string | null
  existed: number
}

export async function dbInsertCheckpoint(cp: CheckpointRow): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO checkpoints (id, conversation_id, message_index, label, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [cp.id, cp.conversation_id, cp.message_index, cp.label, cp.created_at],
  )
}

export async function dbInsertCheckpointFile(f: Omit<CheckpointFileRow, 'id'>): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO checkpoint_files (checkpoint_id, relative_path, absolute_path, content, existed)
     VALUES (?, ?, ?, ?, ?)`,
    [f.checkpoint_id, f.relative_path, f.absolute_path, f.content, f.existed],
  )
}

export async function dbLoadCheckpoints(conversationId: string): Promise<CheckpointRow[]> {
  const d = await getDb()
  return d.select<CheckpointRow[]>(
    'SELECT * FROM checkpoints WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  )
}

export async function dbLoadCheckpointFiles(checkpointId: string): Promise<CheckpointFileRow[]> {
  const d = await getDb()
  return d.select<CheckpointFileRow[]>(
    'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?',
    [checkpointId],
  )
}

export async function dbDeleteCheckpointsFrom(
  conversationId: string,
  fromTimestamp: number,
): Promise<void> {
  const d = await getDb()
  // FK cascade deletes checkpoint_files automatically
  await d.execute(
    'DELETE FROM checkpoints WHERE conversation_id = ? AND created_at >= ?',
    [conversationId, fromTimestamp],
  )
}

export async function dbUpdateConversationMsgCount(
  conversationId: string,
  msgCount: number,
): Promise<void> {
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET msg_count = ?, updated_at = ? WHERE id = ?',
    [msgCount, Date.now(), conversationId],
  )
}
