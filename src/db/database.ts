/**
 * src/db/database.ts
 *
 * SQLite persistence layer via @tauri-apps/plugin-sql.
 *
 * Design decisions:
 * - Single DB singleton, initialised once, re-used everywhere.
 * - Migrations are append-only; never mutate existing statements.
 * - All column additions guard with PRAGMA table_info() so they are safe
 *   to run against pre-existing databases from any prior schema version.
 * - Public helpers throw descriptive errors on failure so callers can
 *   surface them in the UI instead of silently corrupting state.
 */

import Database from '@tauri-apps/plugin-sql'

// ── singleton ─────────────────────────────────────────────────────────────────

let db: Database | null = null
let initPromise: Promise<Database> | null = null

export async function getDb(): Promise<Database> {
  if (db)
    return db
  if (initPromise)
    return initPromise

  initPromise = Database.load('sqlite:emty.db')
    .then(async instance => {
      await migrate(instance)
      db = instance
      return instance
    })
    .catch(e => {
      // Reset so the next call can try again
      initPromise = null
      throw new Error(`Failed to open database: ${e instanceof Error ? e.message : String(e)}`)
    })

  return initPromise
}

// ── schema migrations ─────────────────────────────────────────────────────────
// Append-only. Never mutate existing entries — just add new ones.

const MIGRATIONS: string[] = [
  // v1 — initial schema
  'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',

  `CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT    PRIMARY KEY,
    title       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    msg_count   INTEGER NOT NULL DEFAULT 0
  )`,

  'CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations (updated_at DESC)',

  `CREATE TABLE IF NOT EXISTS messages (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK(role IN ('user','assistant')),
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    tool_events     TEXT,
    attachments     TEXT
  )`,

  'CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages (conversation_id, created_at ASC)',

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

  // v2 — checkpoints
  `CREATE TABLE IF NOT EXISTS checkpoints (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_index   INTEGER NOT NULL,
    label           TEXT    NOT NULL,
    created_at      INTEGER NOT NULL
  )`,

  'CREATE INDEX IF NOT EXISTS idx_checkpoint_conv ON checkpoints (conversation_id, created_at ASC)',

  `CREATE TABLE IF NOT EXISTS checkpoint_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_id   TEXT    NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    relative_path   TEXT    NOT NULL,
    absolute_path   TEXT    NOT NULL,
    content         TEXT,
    existed         INTEGER NOT NULL DEFAULT 1
  )`,

  'CREATE INDEX IF NOT EXISTS idx_cpfile_checkpoint ON checkpoint_files (checkpoint_id)',

  // v3 — created_at index for faster timeline queries
  'CREATE INDEX IF NOT EXISTS idx_msg_created_at ON messages (created_at)',
]

// ── column existence helper ───────────────────────────────────────────────────

async function ensureColumns(
  instance: Database,
  table: string,
  columns: Array<{ name: string; definition: string }>,
): Promise<void> {
  const info = await instance
    .select<{ name: string }[]>(`PRAGMA table_info(${table})`)
    .catch(() => [] as { name: string }[])

  if (!info.length)
    return // Table doesn't exist yet — migrations will create it

  const existing = new Set(info.map(r => r.name.toLowerCase()))
  for (const col of columns) {
    if (!existing.has(col.name.toLowerCase())) {
      await instance.execute(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.definition}`)
    }
  }
}

// ── migration runner ──────────────────────────────────────────────────────────

async function migrate(instance: Database): Promise<void> {
  // Ensure schema_version exists before reading it
  await instance.execute(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
  )

  const rows = await instance
    .select<{ version: number }[]>('SELECT version FROM schema_version LIMIT 1')
    .catch(() => [] as { version: number }[])

  const current = rows[0]?.version ?? 0

  // ── ensure all optional columns exist on pre-existing tables ─────────────
  // These guards handle databases created before a column was introduced.
  await ensureColumns(instance, 'messages', [
    { name: 'created_at', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'tool_events', definition: 'TEXT' },
    { name: 'parts', definition: 'TEXT' },
    { name: 'attachments', definition: 'TEXT' },
    { name: 'cache_stats', definition: 'TEXT' },
    { name: 'mention_context', definition: 'TEXT' },
  ])

  await ensureColumns(instance, 'conversations', [
    { name: 'created_at', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'updated_at', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ])

  // ── apply pending migrations ──────────────────────────────────────────────
  if (current < MIGRATIONS.length) {
    for (let i = current; i < MIGRATIONS.length; i++) {
      await instance.execute(MIGRATIONS[i]!)
    }

    await instance.execute(
      'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
      [MIGRATIONS.length],
    )
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

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
  mention_context?: string | null
  tool_events?: string | null
  parts?: string | null
  attachments?: string | null
  cache_stats?: string | null
}

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

// ── conversation helpers ──────────────────────────────────────────────────────

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
  if (!id || !title?.trim())
    throw new Error('dbUpdateConversationTitle: id and title are required')
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?',
    [title.trim(), Date.now(), id],
  )
}

export async function dbTouchConversation(id: string): Promise<void> {
  if (!id)
    throw new Error('dbTouchConversation: id is required')
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET updated_at = ?, msg_count = msg_count + 1 WHERE id = ?',
    [Date.now(), id],
  )
}

export async function dbDeleteConversation(id: string): Promise<void> {
  if (!id)
    throw new Error('dbDeleteConversation: id is required')
  const d = await getDb()
  // ON DELETE CASCADE removes messages and checkpoints automatically
  await d.execute('DELETE FROM conversations WHERE id = ?', [id])
}

export async function dbListConversations(
  limit = 50,
  offset = 0,
): Promise<ConversationRow[]> {
  const d = await getDb()
  return d.select<ConversationRow[]>(
    'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [Math.max(1, limit), Math.max(0, offset)],
  )
}

export async function dbSearchConversations(
  query: string,
  limit = 50,
): Promise<ConversationRow[]> {
  if (!query?.trim())
    return []
  const d = await getDb()
  // Escape FTS5 special characters to avoid syntax errors
  const safe = query.replace(/["*^()]/g, '')
  if (!safe.trim())
    return []
  return d.select<ConversationRow[]>(
    `SELECT c.* FROM conversations c
     JOIN conversations_fts f ON c.id = f.id
     WHERE conversations_fts MATCH ?
     ORDER BY rank LIMIT ?`,
    [`${safe}*`, Math.max(1, limit)],
  )
}

export async function dbUpdateConversationMsgCount(
  conversationId: string,
  msgCount: number,
): Promise<void> {
  if (!conversationId)
    throw new Error('dbUpdateConversationMsgCount: conversationId is required')
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET msg_count = ?, updated_at = ? WHERE id = ?',
    [Math.max(0, msgCount), Date.now(), conversationId],
  )
}

// ── message helpers ───────────────────────────────────────────────────────────

export async function dbInsertMessage(msg: MessageRow): Promise<void> {
  if (!msg.id || !msg.conversation_id)
    throw new Error('dbInsertMessage: id and conversation_id are required')
  const d = await getDb()
  await d.execute(
    `INSERT INTO messages
       (id, conversation_id, role, content, created_at,
        mention_context, tool_events, parts, attachments, cache_stats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.conversation_id,
      msg.role,
      msg.content ?? '',
      msg.created_at || Date.now(),
      msg.mention_context ?? null,
      msg.tool_events ?? null,
      msg.parts ?? null,
      msg.attachments ?? null,
      msg.cache_stats ?? null,
    ],
  )
}

export async function dbLoadMessages(conversationId: string): Promise<MessageRow[]> {
  if (!conversationId)
    throw new Error('dbLoadMessages: conversationId is required')
  const d = await getDb()
  return d.select<MessageRow[]>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  )
}

export async function dbDeleteMessages(ids: string[]): Promise<void> {
  if (!ids.length)
    return
  const d = await getDb()
  const placeholders = ids.map(() => '?').join(', ')
  await d.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, ids)
}

// ── checkpoint helpers ────────────────────────────────────────────────────────

export async function dbInsertCheckpoint(cp: CheckpointRow): Promise<void> {
  if (!cp.id || !cp.conversation_id)
    throw new Error('dbInsertCheckpoint: id and conversation_id are required')
  const d = await getDb()
  await d.execute(
    `INSERT INTO checkpoints (id, conversation_id, message_index, label, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [cp.id, cp.conversation_id, cp.message_index, cp.label, cp.created_at],
  )
}

export async function dbInsertCheckpointFile(
  f: Omit<CheckpointFileRow, 'id'>,
): Promise<void> {
  if (!f.checkpoint_id || !f.relative_path)
    throw new Error('dbInsertCheckpointFile: checkpoint_id and relative_path are required')
  const d = await getDb()
  await d.execute(
    `INSERT INTO checkpoint_files
       (checkpoint_id, relative_path, absolute_path, content, existed)
     VALUES (?, ?, ?, ?, ?)`,
    [f.checkpoint_id, f.relative_path, f.absolute_path, f.content, f.existed],
  )
}

export async function dbLoadCheckpoints(conversationId: string): Promise<CheckpointRow[]> {
  if (!conversationId)
    throw new Error('dbLoadCheckpoints: conversationId is required')
  const d = await getDb()
  return d.select<CheckpointRow[]>(
    'SELECT * FROM checkpoints WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  )
}

export async function dbLoadCheckpointFiles(
  checkpointId: string,
): Promise<CheckpointFileRow[]> {
  if (!checkpointId)
    throw new Error('dbLoadCheckpointFiles: checkpointId is required')
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
  if (!conversationId)
    throw new Error('dbDeleteCheckpointsFrom: conversationId is required')
  const d = await getDb()
  // FK cascade removes checkpoint_files automatically
  await d.execute(
    'DELETE FROM checkpoints WHERE conversation_id = ? AND created_at >= ?',
    [conversationId, fromTimestamp],
  )
}
