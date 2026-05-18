import type { WorkspaceSnapshot } from './worktrees'
import type { MemoryRow } from '@/db/database'
import type { Message, ToolEvent } from '@/stores/chat/types'
import {
  dbListMemories,
  dbSaveMemory,
} from '@/db/database'

export interface MemorySettings {
  enabled: boolean
}

type MemoryScope = 'global' | 'project'
type MemoryKind = 'preference' | 'task' | 'note'

function compact(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
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
    ...memories.map(memory => `- ${memory.title}: ${memory.content}`),
  ]
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

export async function buildMemoryPromptContext(
  settings: MemorySettings,
  workspace: WorkspaceSnapshot | null,
): Promise<string> {
  if (!settings.enabled)
    return ''

  const [globalPreferences, projectPreferences, lastTask] = await Promise.all([
    dbListMemories({
      scope: 'global',
      kind: 'preference',
      limit: 8,
    }),
    workspace?.projectKey
      ? dbListMemories({
          scope: 'project',
          projectKey: workspace.projectKey,
          kind: 'preference',
          limit: 8,
        })
      : Promise.resolve([]),
    workspace?.projectKey
      ? dbListMemories({
          scope: 'project',
          projectKey: workspace.projectKey,
          kind: 'task',
          key: 'last-task',
          limit: 1,
        })
      : Promise.resolve([]),
  ])

  const sections = [
    ...formatMemoryList('## Global Memory', globalPreferences),
    ...formatMemoryList('## Project Memory', projectPreferences),
    ...formatMemoryList('## Last Project Task', lastTask),
  ]

  return sections.join('\n')
}

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

  await dbSaveMemory({
    scope,
    project_key: scope === 'project' ? workspace?.projectKey ?? null : null,
    kind,
    key: key ?? null,
    title: trimmedTitle,
    content: trimmedContent,
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
