/**
 * src/db/database.ts
 *
 * SQLite persistence layer via @tauri-apps/plugin-sql.
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

  // v4 — conversation workspace metadata
  'ALTER TABLE conversations ADD COLUMN workspace_path TEXT',
  'ALTER TABLE conversations ADD COLUMN workspace_meta TEXT',

  // v5 — durable memory
  `CREATE TABLE IF NOT EXISTS memories (
    id            TEXT    PRIMARY KEY,
    scope         TEXT    NOT NULL CHECK(scope IN ('global','project')),
    project_key   TEXT,
    kind          TEXT    NOT NULL CHECK(kind IN ('preference','task','note')),
    memory_key    TEXT,
    title         TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    source        TEXT    NOT NULL DEFAULT 'agent',
    metadata      TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_used_at  INTEGER NOT NULL,
    pinned        INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_memory_scope_project ON memories (scope, project_key, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_memory_key ON memories (scope, memory_key)',

  // v6 — replay harness
  `CREATE TABLE IF NOT EXISTS replay_runs (
    id                 TEXT    PRIMARY KEY,
    conversation_id    TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    workspace_key      TEXT,
    workspace_path     TEXT,
    model_uid          TEXT,
    prompt_fingerprint TEXT    NOT NULL,
    request_text       TEXT    NOT NULL,
    system_prompt      TEXT    NOT NULL,
    messages_json      TEXT    NOT NULL,
    provider_options   TEXT,
    tool_names         TEXT    NOT NULL,
    tool_trace         TEXT    NOT NULL,
    usage_json         TEXT,
    status             TEXT    NOT NULL CHECK(status IN ('started','completed','error','aborted')),
    error_code         TEXT,
    error_message      TEXT,
    created_at         INTEGER NOT NULL,
    finished_at        INTEGER,
    duration_ms        INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_replay_conv_created ON replay_runs (conversation_id, created_at DESC)',

  // v7 — failure recovery history
  `CREATE TABLE IF NOT EXISTS failure_events (
    id              TEXT    PRIMARY KEY,
    replay_id       TEXT    REFERENCES replay_runs(id) ON DELETE SET NULL,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    category        TEXT    NOT NULL,
    severity        TEXT    NOT NULL CHECK(severity IN ('warning','error')),
    message         TEXT    NOT NULL,
    recovery_hint   TEXT    NOT NULL,
    details         TEXT,
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_failure_conv_created ON failure_events (conversation_id, created_at DESC)',

  // v8 — sub-agent conversations
  'ALTER TABLE conversations ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0',

  // v9 — elapsed seconds for assistant messages
  'ALTER TABLE messages ADD COLUMN elapsed_sec INTEGER',

  // v10 — model UID per assistant message
  'ALTER TABLE messages ADD COLUMN model_uid TEXT',

  // v11 — model name per assistant message
  'ALTER TABLE messages ADD COLUMN model_name TEXT',

  // v12 — design tab persistence
  'ALTER TABLE conversations ADD COLUMN is_design_tab INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE conversations ADD COLUMN designs TEXT DEFAULT NULL',

  // v13 — bg task notification flag on messages
  'ALTER TABLE messages ADD COLUMN is_bg_notification INTEGER NOT NULL DEFAULT 0',
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

function isIgnorableMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('duplicate column name')
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
    // is_complete = 0 means streaming was interrupted; 1 means fully saved.
    // DEFAULT 1 so all pre-existing rows are treated as complete.
    { name: 'is_complete', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'elapsed_sec', definition: 'INTEGER' },
    { name: 'model_uid', definition: 'TEXT' },
    { name: 'model_name', definition: 'TEXT' },
    { name: 'is_bg_notification', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ])

  await ensureColumns(instance, 'conversations', [
    { name: 'created_at', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'updated_at', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'is_subagent', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'is_design_tab', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'designs', definition: 'TEXT DEFAULT NULL' },
  ])

  await ensureColumns(instance, 'memories', [
    { name: 'memory_key', definition: 'TEXT' },
  ])

  // ── apply pending migrations ──────────────────────────────────────────────
  if (current < MIGRATIONS.length) {
    for (let i = current; i < MIGRATIONS.length; i++) {
      try {
        await instance.execute(MIGRATIONS[i]!)
      }
      catch (error) {
        if (!isIgnorableMigrationError(error))
          throw error
      }
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
  workspace_path?: string | null
  workspace_meta?: string | null
  is_subagent?: number
  is_design_tab?: number
  designs?: string | null
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
  /**
   * 0 = inserted at stream-start but never completed (app crashed mid-stream).
   * 1 = fully saved by onFinish (default for all pre-existing rows).
   * Callers loading messages should check this field and surface a truncation
   * indicator when is_complete === 0.
   */
  is_complete?: number
  elapsed_sec?: number | null
  model_uid?: string | null
  model_name?: string | null
  /** 1 = injected by the bg-task notification system; hidden in the UI. */
  is_bg_notification?: number
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

export interface MemoryRow {
  id: string
  scope: 'global' | 'project'
  project_key: string | null
  kind: 'preference' | 'task' | 'note'
  key: string | null
  title: string
  content: string
  source: 'agent' | 'user' | 'system'
  metadata: string | null
  created_at: number
  updated_at: number
  last_used_at: number
  pinned: number
  disabled: number
}

export interface ReplayRunRow {
  id: string
  conversation_id: string
  workspace_key: string | null
  workspace_path: string | null
  model_uid: string | null
  prompt_fingerprint: string
  request_text: string
  system_prompt: string
  messages_json: string
  provider_options: string | null
  tool_names: string
  tool_trace: string
  usage_json?: string | null
  status: 'started' | 'completed' | 'error' | 'aborted'
  error_code: string | null
  error_message: string | null
  created_at: number
  finished_at: number | null
  duration_ms: number | null
}

export interface FailureEventRow {
  id: string
  replay_id: string | null
  conversation_id: string
  category: string
  severity: 'warning' | 'error'
  message: string
  recovery_hint: string
  details: string | null
  created_at: number
  resolved_at: number | null
}

// ── conversation helpers ──────────────────────────────────────────────────────

export async function dbInsertConversation(
  conv: Omit<ConversationRow, 'msg_count'>,
): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO conversations (id, title, created_at, updated_at, msg_count, workspace_path, workspace_meta, is_subagent, is_design_tab, designs)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.created_at,
      conv.updated_at,
      conv.workspace_path ?? null,
      conv.workspace_meta ?? null,
      conv.is_subagent ?? 0,
      conv.is_design_tab ?? 0,
      conv.designs ?? null,
    ],
  )
}

export async function dbUpdateConversationWorkspace(
  id: string,
  patch: {
    workspace_path?: string | null
    workspace_meta?: string | null
  },
): Promise<void> {
  if (!id)
    throw new Error('dbUpdateConversationWorkspace: id is required')

  const sets: string[] = []
  const values: unknown[] = []

  if ('workspace_path' in patch) {
    sets.push('workspace_path = ?')
    values.push(patch.workspace_path ?? null)
  }

  if ('workspace_meta' in patch) {
    sets.push('workspace_meta = ?')
    values.push(patch.workspace_meta ?? null)
  }

  if (sets.length === 0)
    return

  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  const d = await getDb()
  await d.execute(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values)
}

export async function dbUpdateConversationDesigns(id: string, designs: string | null): Promise<void> {
  if (!id)
    throw new Error('dbUpdateConversationDesigns: id is required')
  const d = await getDb()
  await d.execute(
    'UPDATE conversations SET designs = ?, updated_at = ? WHERE id = ?',
    [designs, Date.now(), id],
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
    'SELECT * FROM conversations WHERE is_subagent = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [Math.max(1, limit), Math.max(0, offset)],
  )
}

export async function dbGetConversation(id: string): Promise<ConversationRow | undefined> {
  if (!id)
    throw new Error('dbGetConversation: id is required')
  const d = await getDb()
  const rows = await d.select<ConversationRow[]>('SELECT * FROM conversations WHERE id = ? LIMIT 1', [id])
  return rows[0]
}

export async function dbFindSubAgentConversation(
  title: string,
  nearTimestamp?: number,
): Promise<ConversationRow | undefined> {
  const d = await getDb()

  if (nearTimestamp && nearTimestamp > 0) {
    const rows = await d.select<ConversationRow[]>(
      `SELECT * FROM conversations
       WHERE is_subagent = 1 AND title = ?
       ORDER BY ABS(created_at - ?) ASC LIMIT 1`,
      [title, nearTimestamp],
    )
    if (rows.length > 0) {
      return rows[0]
    }
  }

  // Fallback: just get the most recent one with this title
  const rows = await d.select<ConversationRow[]>(
    `SELECT * FROM conversations
     WHERE is_subagent = 1 AND title = ?
     ORDER BY created_at DESC LIMIT 1`,
    [title],
  )
  return rows[0]
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
     WHERE conversations_fts MATCH ? AND c.is_subagent = 0
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
         mention_context, tool_events, parts, attachments, cache_stats, is_complete, elapsed_sec, model_uid, model_name, is_bg_notification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      msg.is_complete ?? 1,
      msg.elapsed_sec ?? null,
      msg.model_uid ?? null,
      msg.model_name ?? null,
      msg.is_bg_notification ?? 0,
    ],
  )
}

/**
 * Partially update a message row during or after streaming.
 *
 * Only the fields present in `patch` are written; omitting a key leaves the
 * stored value unchanged. This is intentionally lightweight so it can be
 * called on every tool-call event and on a ~1.5 s throttle during text/
 * reasoning deltas without redundant full-row rewrites.
 *
 * Set `is_complete: 1` in the final onFinish call to mark the message as
 * fully saved. Rows with `is_complete: 0` were interrupted mid-stream.
 */
export async function dbUpdateMessage(
  id: string,
  patch: {
    content?: string
    parts?: string | null
    tool_events?: string | null
    cache_stats?: string | null
    is_complete?: number
    elapsed_sec?: number | null
  },
): Promise<void> {
  if (!id)
    throw new Error('dbUpdateMessage: id is required')

  const sets: string[] = []
  const values: unknown[] = []

  if (patch.content !== undefined) {
    sets.push('content = ?')
    values.push(patch.content)
  }
  if ('parts' in patch) {
    sets.push('parts = ?')
    values.push(patch.parts ?? null)
  }
  if ('tool_events' in patch) {
    sets.push('tool_events = ?')
    values.push(patch.tool_events ?? null)
  }
  if ('cache_stats' in patch) {
    sets.push('cache_stats = ?')
    values.push(patch.cache_stats ?? null)
  }
  if (patch.is_complete !== undefined) {
    sets.push('is_complete = ?')
    values.push(patch.is_complete)
  }
  if ('elapsed_sec' in patch) {
    sets.push('elapsed_sec = ?')
    values.push(patch.elapsed_sec ?? null)
  }

  if (sets.length === 0)
    return

  values.push(id)
  const d = await getDb()
  await d.execute(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, values)
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

// —— memory helpers ————————————————————————————————————————————————————————————————

export async function dbListMemories(options: {
  scope: MemoryRow['scope']
  projectKey?: string | null
  kind?: MemoryRow['kind']
  key?: string
  limit?: number
}): Promise<MemoryRow[]> {
  const d = await getDb()
  const conditions = ['scope = ?']
  const values: unknown[] = [options.scope]

  if (options.projectKey === null) {
    conditions.push('project_key IS NULL')
  }
  else if (options.projectKey !== undefined) {
    conditions.push('project_key = ?')
    values.push(options.projectKey)
  }

  if (options.kind) {
    conditions.push('kind = ?')
    values.push(options.kind)
  }

  if (options.key) {
    conditions.push('memory_key = ?')
    values.push(options.key)
  }

  values.push(Math.max(1, options.limit ?? 50))

  return d.select<MemoryRow[]>(
    `SELECT id, scope, project_key, kind, memory_key AS key, title, content, source, metadata,
            created_at, updated_at, last_used_at, pinned, disabled
     FROM memories
     WHERE ${conditions.join(' AND ')}
       AND disabled = 0
     ORDER BY pinned DESC, updated_at DESC
     LIMIT ?`,
    values,
  )
}

export async function dbSaveMemory(input: {
  scope: MemoryRow['scope']
  project_key: string | null
  kind: MemoryRow['kind']
  key?: string | null
  title: string
  content: string
  source: MemoryRow['source']
  metadata?: string | null
  pinned?: number
  disabled?: number
}): Promise<MemoryRow> {
  const d = await getDb()
  const now = Date.now()

  let existing: MemoryRow | undefined
  if (input.key) {
    const existingRows = await d.select<MemoryRow[]>(
      `SELECT id, scope, project_key, kind, memory_key AS key, title, content, source, metadata,
              created_at, updated_at, last_used_at, pinned, disabled
       FROM memories
       WHERE scope = ?
         AND ${input.project_key == null ? 'project_key IS NULL' : 'project_key = ?'}
         AND memory_key = ?
       LIMIT 1`,
      input.project_key == null
        ? [input.scope, input.key]
        : [input.scope, input.project_key, input.key],
    )
    existing = existingRows[0]
  }

  if (existing) {
    await d.execute(
      `UPDATE memories
       SET kind = ?, title = ?, content = ?, source = ?, metadata = ?, updated_at = ?, last_used_at = ?, disabled = 0
       WHERE id = ?`,
      [
        input.kind,
        input.title,
        input.content,
        input.source,
        input.metadata ?? null,
        now,
        now,
        existing.id,
      ],
    )

    return {
      ...existing,
      kind: input.kind,
      title: input.title,
      content: input.content,
      source: input.source,
      metadata: input.metadata ?? null,
      updated_at: now,
      last_used_at: now,
      disabled: 0,
    }
  }

  const row: MemoryRow = {
    id: `memory-${Math.random().toString(36).slice(2, 10)}`,
    scope: input.scope,
    project_key: input.project_key,
    kind: input.kind,
    key: input.key ?? null,
    title: input.title,
    content: input.content,
    source: input.source,
    metadata: input.metadata ?? null,
    created_at: now,
    updated_at: now,
    last_used_at: now,
    pinned: input.pinned ?? 0,
    disabled: input.disabled ?? 0,
  }

  await d.execute(
    `INSERT INTO memories
      (id, scope, project_key, kind, memory_key, title, content, source, metadata, created_at, updated_at, last_used_at, pinned, disabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.scope,
      row.project_key,
      row.kind,
      row.key,
      row.title,
      row.content,
      row.source,
      row.metadata,
      row.created_at,
      row.updated_at,
      row.last_used_at,
      row.pinned,
      row.disabled,
    ],
  )

  return row
}

// —— replay helpers ————————————————————————————————————————————————————————————————

export async function dbDeleteMemoryByKey(
  scope: MemoryRow['scope'],
  project_key: string | null,
  memory_key: string,
): Promise<void> {
  const d = await getDb()
  await d.execute(
    `DELETE FROM memories
     WHERE scope = ?
       AND ${project_key == null ? 'project_key IS NULL' : 'project_key = ?'}
       AND memory_key = ?`,
    project_key == null ? [scope, memory_key] : [scope, project_key, memory_key],
  )
}

export async function dbCountMemories(options: {
  scope: MemoryRow['scope']
  projectKey?: string | null
  kind?: MemoryRow['kind']
}): Promise<{ count: number; totalChars: number }> {
  const d = await getDb()
  const conditions = ['scope = ?', 'disabled = 0']
  const values: unknown[] = [options.scope]

  if (options.projectKey === null) {
    conditions.push('project_key IS NULL')
  }
  else if (options.projectKey !== undefined) {
    conditions.push('project_key = ?')
    values.push(options.projectKey)
  }

  if (options.kind) {
    conditions.push('kind = ?')
    values.push(options.kind)
  }

  const rows = await d.select<{ count: number; totalChars: number }[]>(
    `SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(title) + LENGTH(content)), 0) as totalChars
     FROM memories
     WHERE ${conditions.join(' AND ')}`,
    values,
  )

  return rows[0] ?? { count: 0, totalChars: 0 }
}

export async function dbUpdateMemoryByKey(
  scope: MemoryRow['scope'],
  project_key: string | null,
  memory_key: string,
  updates: { title?: string; content?: string; pinned?: number; disabled?: number },
): Promise<void> {
  const d = await getDb()
  const setClauses: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (updates.title !== undefined) {
    setClauses.push('title = ?')
    values.push(updates.title)
  }
  if (updates.content !== undefined) {
    setClauses.push('content = ?')
    values.push(updates.content)
  }
  if (updates.pinned !== undefined) {
    setClauses.push('pinned = ?')
    values.push(updates.pinned)
  }
  if (updates.disabled !== undefined) {
    setClauses.push('disabled = ?')
    values.push(updates.disabled)
  }

  const projCondition = project_key == null ? 'project_key IS NULL' : 'project_key = ?'
  if (project_key != null)
    values.push(project_key)
  values.push(memory_key)

  await d.execute(
    `UPDATE memories
     SET ${setClauses.join(', ')}
     WHERE scope = ?
       AND ${projCondition}
       AND memory_key = ?`,
    [scope, ...values],
  )
}

export async function dbTouchMemory(id: string): Promise<void> {
  const d = await getDb()
  await d.execute(
    'UPDATE memories SET last_used_at = ? WHERE id = ?',
    [Date.now(), id],
  )
}

export async function dbDeleteMemoriesByScope(
  scope: MemoryRow['scope'],
  project_key: string | null,
  kind: MemoryRow['kind'],
): Promise<void> {
  const d = await getDb()
  await d.execute(
    `DELETE FROM memories
     WHERE scope = ?
       AND ${project_key == null ? 'project_key IS NULL' : 'project_key = ?'}
       AND kind = ?
       AND disabled = 0`,
    project_key == null ? [scope, kind] : [scope, project_key, kind],
  )
}

export async function dbInsertReplayRun(row: ReplayRunRow): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO replay_runs
      (id, conversation_id, workspace_key, workspace_path, model_uid, prompt_fingerprint, request_text,
       system_prompt, messages_json, provider_options, tool_names, tool_trace, usage_json, status,
       error_code, error_message, created_at, finished_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.conversation_id,
      row.workspace_key,
      row.workspace_path,
      row.model_uid,
      row.prompt_fingerprint,
      row.request_text,
      row.system_prompt,
      row.messages_json,
      row.provider_options,
      row.tool_names,
      row.tool_trace,
      row.usage_json ?? null,
      row.status,
      row.error_code,
      row.error_message,
      row.created_at,
      row.finished_at,
      row.duration_ms,
    ],
  )
}

export async function dbUpdateReplayRun(
  id: string,
  patch: {
    usage_json?: string | null
    tool_trace?: string | null
    status?: ReplayRunRow['status']
    error_code?: string | null
    error_message?: string | null
    finished_at?: number | null
    duration_ms?: number | null
  },
): Promise<void> {
  if (!id)
    throw new Error('dbUpdateReplayRun: id is required')

  const sets: string[] = []
  const values: unknown[] = []

  if ('usage_json' in patch) {
    sets.push('usage_json = ?')
    values.push(patch.usage_json ?? null)
  }
  if ('tool_trace' in patch) {
    sets.push('tool_trace = ?')
    values.push(patch.tool_trace ?? null)
  }
  if (patch.status) {
    sets.push('status = ?')
    values.push(patch.status)
  }
  if ('error_code' in patch) {
    sets.push('error_code = ?')
    values.push(patch.error_code ?? null)
  }
  if ('error_message' in patch) {
    sets.push('error_message = ?')
    values.push(patch.error_message ?? null)
  }
  if ('finished_at' in patch) {
    sets.push('finished_at = ?')
    values.push(patch.finished_at ?? null)
  }
  if ('duration_ms' in patch) {
    sets.push('duration_ms = ?')
    values.push(patch.duration_ms ?? null)
  }

  if (sets.length === 0)
    return

  values.push(id)

  const d = await getDb()
  await d.execute(`UPDATE replay_runs SET ${sets.join(', ')} WHERE id = ?`, values)
}

// ── project sidebar helpers ──────────────────────────────────────────────────

export interface ProjectWithLatestChat {
  workspace_path: string
  project_name: string
  latest_chat_id: string
  latest_chat_title: string
  latest_chat_updated_at: number
}

export async function dbListProjectsWithLatestChat(
  limit = 10,
): Promise<ProjectWithLatestChat[]> {
  const d = await getDb()
  const rows = await d.select<Array<{
    workspace_path: string
    latest_chat_id: string
    latest_chat_title: string
    latest_chat_updated_at: number
  }>>(
    `SELECT c.workspace_path,
           c.id          AS latest_chat_id,
           c.title       AS latest_chat_title,
           c.updated_at  AS latest_chat_updated_at
     FROM conversations c
     INNER JOIN (
       SELECT workspace_path, MAX(updated_at) AS max_updated
       FROM conversations
       WHERE is_subagent = 0
         AND workspace_path IS NOT NULL
         AND workspace_path != ''
       GROUP BY workspace_path
     ) latest
       ON c.workspace_path = latest.workspace_path
      AND c.updated_at = latest.max_updated
     WHERE c.is_subagent = 0
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [Math.max(1, limit)],
  )
  return rows.map(r => ({
    ...r,
    project_name:
      r.workspace_path
        .replace(/[/\\]+$/, '')
        .split(/[/\\]/)
        .pop() ?? r.workspace_path,
  }))
}

export async function dbListConversationsByWorkspace(
  workspacePath: string,
  limit = 5,
): Promise<ConversationRow[]> {
  const d = await getDb()
  return d.select<ConversationRow[]>(
    `SELECT * FROM conversations
     WHERE workspace_path = ? AND is_subagent = 0
     ORDER BY updated_at DESC
     LIMIT ?`,
    [workspacePath, Math.max(1, limit)],
  )
}

export async function dbListConversationsByWorkspaceAll(
  workspacePath: string,
): Promise<ConversationRow[]> {
  const d = await getDb()
  return d.select<ConversationRow[]>(
    `SELECT * FROM conversations
     WHERE workspace_path = ? AND is_subagent = 0
     ORDER BY updated_at DESC`,
    [workspacePath],
  )
}

export async function dbCountConversationsByWorkspace(
  workspacePath: string,
): Promise<number> {
  const d = await getDb()
  const rows = await d.select<Array<{ cnt: number }>>(
    `SELECT COUNT(*) AS cnt FROM conversations
     WHERE workspace_path = ? AND is_subagent = 0`,
    [workspacePath],
  )
  return rows[0]?.cnt ?? 0
}

// —— failure recovery helpers ————————————————————————————————————————————————————————

export async function dbInsertFailureEvent(row: FailureEventRow): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT INTO failure_events
      (id, replay_id, conversation_id, category, severity, message, recovery_hint, details, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.replay_id,
      row.conversation_id,
      row.category,
      row.severity,
      row.message,
      row.recovery_hint,
      row.details,
      row.created_at,
      row.resolved_at,
    ],
  )
}

export async function dbListFailureEvents(
  conversationId: string,
  limit = 10,
): Promise<FailureEventRow[]> {
  const d = await getDb()
  return d.select<FailureEventRow[]>(
    `SELECT *
     FROM failure_events
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [conversationId, Math.max(1, limit)],
  )
}

export async function dbResolveFailureEvents(conversationId: string): Promise<void> {
  const d = await getDb()
  await d.execute(
    `UPDATE failure_events
     SET resolved_at = ?
     WHERE conversation_id = ?
       AND resolved_at IS NULL`,
    [Date.now(), conversationId],
  )
}
