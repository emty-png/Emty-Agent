import type { WorkspaceSnapshot } from './worktrees'
import type { MemoryRow } from '@/db/database'
import type { Message, ToolEvent } from '@/stores/chat/core/types'
import {
  dbCountMemories,
  dbDeleteMemoriesByScope,
  dbDeleteMemoryByKey,
  dbListMemories,
  dbSaveMemory,
  dbTouchMemory,
  dbUpdateMemoryByKey,
} from '@/db/database'
import { minifyMarkdown } from '@/utils/agentContext'

export interface MemorySettings {
  enabled: boolean
}

export type MemoryScope = 'global' | 'project'
export type MemoryKind = 'preference' | 'task' | 'note'

// ── budgets ─────────────────────────────────────────────────────────────────

export const MEMORY_BUDGET = {
  globalPreferences: { count: 8, charLimit: 2400 },
  projectPreferences: { count: 8, charLimit: 2400 },
  agentNotes: { count: 12, charLimit: 3600 },
} as const

export interface BudgetStatus {
  count: number
  maxCount: number
  chars: number
  maxChars: number
}

// ── injection defense ───────────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /^#{1,3}\s*(system|assistant|user)\s*:/im,
  /<\|(?:im_start|im_end|system|user|assistant)\|>/i,
  /\[system\]/i,
  /(?:IGNORE|DISREGARD|OVERRIDE)\s+(?:ALL\s+)?(?:PREVIOUS|EARLIER|ABOVE)\s+(?:INSTRUCTIONS|PROMPTS)/i,
  /(?:you are now|act as|pretend to be|roleplay as)\s+(?:a|an|the)\s+(?:different|new|other)/i,
]

export function sanitizeMemoryContent(text: string): { safe: string; blocked: boolean } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text))
      return { safe: '[BLOCKED: content matched injection pattern]', blocked: true }
  }
  return { safe: text, blocked: false }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function compact(value: string, max = 180): string {
  const normalized = minifyMarkdown(value).replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function firstSentence(value: string, max = 220): string {
  const sentence = value.split(/(?<=[.!?])\s+/)[0] ?? value
  return compact(sentence, max)
}

function formatMemoryList(title: string, memories: MemoryRow[]): string[] {
  if (memories.length === 0)
    return []

  return [
    title,
    ...memories.map(memory => `- ${memory.title}: ${minifyMarkdown(memory.content).replace(/\s+/g, ' ')}`),
  ]
}

function budgetStatusLine(label: string, status: BudgetStatus): string {
  const countPct = `${status.count}/${status.maxCount}`
  const charPct = `${status.chars}/${status.maxChars}`
  return `${label}: ${countPct} entries, ${charPct} chars`
}

function extractTouchedTargets(events: ToolEvent[] | undefined): string[] {
  if (!events?.length)
    return []

  const labels = events
    .filter(event => event.status === 'done')
    .map(event => compact(event.label, 80))

  return [...new Set(labels)].slice(0, 4)
}

function buildTaskSummary(userMessage: Message, assistantMessage: Message): {
  title: string
  content: string
} {
  const userSummary = firstSentence(userMessage.content || 'Continued working in the project', 120)
  const touched = extractTouchedTargets(assistantMessage.toolEvents)
  const outcome = assistantMessage.error
    ? `Outcome: blocked by ${compact(assistantMessage.error, 120)}.`
    : assistantMessage.content.trim()
      ? `Outcome: ${firstSentence(assistantMessage.content, 180)}`
      : 'Outcome: work completed without a final text summary.'

  const toolLine = touched.length > 0
    ? ` Actions: ${touched.join('; ')}.`
    : ''

  return {
    title: 'Last task',
    content: `Previous task: ${userSummary}.${toolLine} ${outcome}`.trim(),
  }
}

function projectKeyFor(
  scope: MemoryScope,
  workspace: WorkspaceSnapshot | null,
): string | null {
  if (scope === 'global')
    return null
  return workspace?.projectKey ?? null
}

// ── build prompt context ────────────────────────────────────────────────────

export async function buildMemoryPromptContext(
  settings: MemorySettings,
  workspace: WorkspaceSnapshot | null,
): Promise<string> {
  if (!settings.enabled)
    return ''

  const [globalPrefs, projectPrefs, globalNotes, projectNotes, lastTask] = await Promise.all([
    dbListMemories({ scope: 'global', kind: 'preference', limit: MEMORY_BUDGET.globalPreferences.count }),
    workspace?.projectKey
      ? dbListMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'preference', limit: MEMORY_BUDGET.projectPreferences.count })
      : Promise.resolve([]),
    dbListMemories({ scope: 'global', kind: 'note', limit: MEMORY_BUDGET.agentNotes.count }),
    workspace?.projectKey
      ? dbListMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'note', limit: MEMORY_BUDGET.agentNotes.count })
      : Promise.resolve([]),
    workspace?.projectKey
      ? dbListMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'task', key: 'last-task', limit: 1 })
      : Promise.resolve([]),
  ])

  // touch all fetched memories so last_used_at stays current
  const allFetched = [...globalPrefs, ...projectPrefs, ...globalNotes, ...projectNotes, ...lastTask]
  if (allFetched.length > 0) {
    Promise.all(allFetched.map(m => dbTouchMemory(m.id))).catch(() => {})
  }

  const globalPrefsBudget = await dbCountMemories({ scope: 'global', kind: 'preference' })
  const projectPrefsBudget = workspace?.projectKey
    ? await dbCountMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'preference' })
    : { count: 0, totalChars: 0 }
  const globalNotesBudget = await dbCountMemories({ scope: 'global', kind: 'note' })
  const projectNotesBudget = workspace?.projectKey
    ? await dbCountMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'note' })
    : { count: 0, totalChars: 0 }

  const budgetLines = [
    budgetStatusLine('User Preferences', {
      count: globalPrefsBudget.count + projectPrefsBudget.count,
      maxCount: MEMORY_BUDGET.globalPreferences.count + MEMORY_BUDGET.projectPreferences.count,
      chars: globalPrefsBudget.totalChars + projectPrefsBudget.totalChars,
      maxChars: MEMORY_BUDGET.globalPreferences.charLimit + MEMORY_BUDGET.projectPreferences.charLimit,
    }),
    budgetStatusLine('Agent Notes', {
      count: globalNotesBudget.count + projectNotesBudget.count,
      maxCount: MEMORY_BUDGET.agentNotes.count * 2,
      chars: globalNotesBudget.totalChars + projectNotesBudget.totalChars,
      maxChars: MEMORY_BUDGET.agentNotes.charLimit * 2,
    }),
  ]

  const sections = [
    ...formatMemoryList('## User Preferences', [...globalPrefs, ...projectPrefs]),
    ...formatMemoryList('## Agent Notes', [...globalNotes, ...projectNotes]),
    ...formatMemoryList('## Last Project Task', lastTask),
    '',
    `[Memory Budget: ${budgetLines.join(' | ')}]`,
  ]

  return sections.filter(Boolean).join('\n')
}

// ── memory nudge ────────────────────────────────────────────────────────────

export function buildMemoryNudge(
  turnCount: number,
  budgetStatus?: { prefsUsed: number; prefsMax: number; notesUsed: number; notesMax: number },
): string {
  if (turnCount <= 0 || turnCount % 10 !== 0)
    return ''

  const lines = ['## Memory Reminder']
  lines.push('Use `remember_memory` to save important findings from this conversation.')
  lines.push('Use `list_memories` to review existing entries before duplicating.')
  lines.push('Use `update_memory` to edit an existing entry. Use `consolidate_memories` if stores are near capacity.')

  if (budgetStatus) {
    if (budgetStatus.prefsUsed >= budgetStatus.prefsMax - 2)
      lines.push(`User preferences are near capacity (${budgetStatus.prefsUsed}/${budgetStatus.prefsMax}). Consider consolidating or updating existing entries.`)
    if (budgetStatus.notesUsed >= budgetStatus.notesMax - 2)
      lines.push(`Agent notes are near capacity (${budgetStatus.notesUsed}/${budgetStatus.notesMax}). Consider consolidating or updating existing entries.`)
  }

  return lines.join('\n')
}

// ── conversation turn memory ────────────────────────────────────────────────

export async function saveConversationTurnMemory(options: {
  settings: MemorySettings
  workspace: WorkspaceSnapshot | null
  userMessage: Message
  assistantMessage: Message
}): Promise<void> {
  const { settings, workspace, userMessage, assistantMessage } = options
  if (!settings.enabled || !workspace?.projectKey)
    return

  const task = buildTaskSummary(userMessage, assistantMessage)
  await dbSaveMemory({
    scope: 'project',
    project_key: workspace.projectKey,
    kind: 'task',
    key: 'last-task',
    title: task.title,
    content: task.content,
    source: 'system',
    metadata: JSON.stringify({
      workspacePath: workspace.path,
      branch: workspace.branch,
      conversationRole: assistantMessage.role,
    }),
  })
}

// ── agent-facing CRUD ───────────────────────────────────────────────────────

export async function saveAgentMemory(options: {
  scope: MemoryScope
  workspace: WorkspaceSnapshot | null
  kind: Exclude<MemoryKind, 'task'>
  title: string
  content: string
  key?: string
  source?: 'agent' | 'user' | 'system'
}): Promise<{ ok: boolean; reason?: string }> {
  const { scope, workspace, kind, title, content, key, source = 'agent' } = options
  const trimmedTitle = compact(title, 80)
  const trimmedContent = compact(content, 300)

  if (!trimmedTitle || !trimmedContent)
    return { ok: false, reason: 'Title and content are required.' }

  if (scope === 'project' && !workspace?.projectKey)
    return { ok: false, reason: 'No active project memory scope is available.' }

  // injection defense
  const titleCheck = sanitizeMemoryContent(trimmedTitle)
  const contentCheck = sanitizeMemoryContent(trimmedContent)
  if (titleCheck.blocked)
    return { ok: false, reason: `Title blocked: ${titleCheck.safe}` }
  if (contentCheck.blocked)
    return { ok: false, reason: `Content blocked: ${contentCheck.safe}` }

  await dbSaveMemory({
    scope,
    project_key: projectKeyFor(scope, workspace),
    kind,
    key: key ?? null,
    title: titleCheck.safe,
    content: contentCheck.safe,
    source,
    metadata: workspace
      ? JSON.stringify({
          workspacePath: workspace.path,
          branch: workspace.branch,
        })
      : null,
  })

  return { ok: true }
}

export async function deleteAgentMemory(options: {
  scope: MemoryScope
  workspace: WorkspaceSnapshot | null
  key: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { scope, workspace, key } = options

  if (scope === 'project' && !workspace?.projectKey)
    return { ok: false, reason: 'No active project memory scope is available.' }

  await dbDeleteMemoryByKey(scope, projectKeyFor(scope, workspace), key)

  return { ok: true }
}

export async function updateAgentMemory(options: {
  scope: MemoryScope
  workspace: WorkspaceSnapshot | null
  key: string
  title?: string
  content?: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { scope, workspace, key, title, content } = options

  if (scope === 'project' && !workspace?.projectKey)
    return { ok: false, reason: 'No active project memory scope is available.' }

  if (title === undefined && content === undefined)
    return { ok: false, reason: 'At least one of title or content must be provided.' }

  const updates: { title?: string; content?: string } = {}
  if (title !== undefined) {
    const trimmed = compact(title, 80)
    if (!trimmed)
      return { ok: false, reason: 'Title cannot be empty.' }
    const check = sanitizeMemoryContent(trimmed)
    if (check.blocked)
      return { ok: false, reason: `Title blocked: ${check.safe}` }
    updates.title = check.safe
  }
  if (content !== undefined) {
    const trimmed = compact(content, 300)
    if (!trimmed)
      return { ok: false, reason: 'Content cannot be empty.' }
    const check = sanitizeMemoryContent(trimmed)
    if (check.blocked)
      return { ok: false, reason: `Content blocked: ${check.safe}` }
    updates.content = check.safe
  }

  await dbUpdateMemoryByKey(scope, projectKeyFor(scope, workspace), key, updates)

  return { ok: true }
}

export async function listAgentMemories(options: {
  scope: 'global' | 'project' | 'all'
  kind?: 'preference' | 'note' | 'all'
  workspace: WorkspaceSnapshot | null
}): Promise<{
  entries: Array<{ scope: string; kind: string; key: string | null; title: string; content: string; updatedAt: number }>
  budgets: { preferences: BudgetStatus; notes: BudgetStatus }
}> {
  const { scope, kind, workspace } = options

  const queries: Array<Promise<MemoryRow[]>> = []
  const scopesToQuery: MemoryScope[] = scope === 'all' ? ['global', 'project'] : [scope as MemoryScope]
  const kindsToQuery: MemoryKind[] = !kind || kind === 'all' ? ['preference', 'note'] : [kind as MemoryKind]

  for (const s of scopesToQuery) {
    for (const k of kindsToQuery) {
      if (s === 'project' && !workspace?.projectKey)
        continue
      queries.push(dbListMemories({
        scope: s,
        projectKey: s === 'project' ? (workspace?.projectKey ?? null) : null,
        kind: k,
        limit: 50,
      }))
    }
  }

  const results = await Promise.all(queries)
  const memories = results.flat()

  const entries = memories.map(m => ({
    scope: m.scope,
    kind: m.kind,
    key: m.key,
    title: m.title,
    content: m.content,
    updatedAt: m.updated_at,
  }))

  const [gp, pp, gn, pn] = await Promise.all([
    dbCountMemories({ scope: 'global', kind: 'preference' }),
    workspace?.projectKey ? dbCountMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'preference' }) : Promise.resolve({ count: 0, totalChars: 0 }),
    dbCountMemories({ scope: 'global', kind: 'note' }),
    workspace?.projectKey ? dbCountMemories({ scope: 'project', projectKey: workspace.projectKey, kind: 'note' }) : Promise.resolve({ count: 0, totalChars: 0 }),
  ])

  const budgets = {
    preferences: {
      count: gp.count + pp.count,
      maxCount: MEMORY_BUDGET.globalPreferences.count + MEMORY_BUDGET.projectPreferences.count,
      chars: gp.totalChars + pp.totalChars,
      maxChars: MEMORY_BUDGET.globalPreferences.charLimit + MEMORY_BUDGET.projectPreferences.charLimit,
    },
    notes: {
      count: gn.count + pn.count,
      maxCount: MEMORY_BUDGET.agentNotes.count * 2,
      chars: gn.totalChars + pn.totalChars,
      maxChars: MEMORY_BUDGET.agentNotes.charLimit * 2,
    },
  }

  return { entries, budgets }
}

export async function consolidateMemories(options: {
  scope: MemoryScope
  workspace: WorkspaceSnapshot | null
  kind: 'preference' | 'note'
  summary: string
}): Promise<{ ok: boolean; reason?: string; removed: number }> {
  const { scope, workspace, kind, summary } = options

  if (scope === 'project' && !workspace?.projectKey)
    return { ok: false, reason: 'No active project memory scope is available.', removed: 0 }

  const trimmed = compact(summary, 400)
  if (!trimmed)
    return { ok: false, reason: 'Summary cannot be empty.', removed: 0 }

  const check = sanitizeMemoryContent(trimmed)
  if (check.blocked)
    return { ok: false, reason: `Summary blocked: ${check.safe}`, removed: 0 }

  const existing = await dbListMemories({
    scope,
    projectKey: projectKeyFor(scope, workspace),
    kind,
    limit: 100,
  })

  if (existing.length === 0)
    return { ok: false, reason: 'No memories to consolidate.', removed: 0 }

  const projKey = projectKeyFor(scope, workspace)
  await dbDeleteMemoriesByScope(scope, projKey, kind)

  await dbSaveMemory({
    scope,
    project_key: projKey,
    kind,
    key: null,
    title: `Consolidated ${kind}`,
    content: check.safe,
    source: 'agent',
  })

  return { ok: true, removed: existing.length }
}
