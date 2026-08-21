/**
 * src/utils/tools/todos.ts
 *
 * Four granular task tools that replace the monolithic write_todo tool.
 *
 * Design:
 * - State lives entirely inside the closure returned by createTaskTools().
 * - The agent operates on individual tasks by stable auto-increment ID,
 *   eliminating the full-list replacement problem of the old write_todo.
 * - onUpdate fires after every mutation so Vue reactivity in the chat store
 *   propagates changes to TaskOverlay without any module-level singletons.
 *
 * Tools:
 * - create_task  — add a new task and return its assigned ID
 * - update_task  — mutate status / subject / description / activeForm, or delete
 * - list_tasks   — read all tasks
 * - get_task     — read one task in full detail
 */

import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

// ── types ─────────────────────────────────────────────────────────────────────

export interface TaskItem {
  /** Stable auto-increment identifier: "1", "2", "3"… */
  id: string

  /** Brief, actionable title in imperative form. */
  subject: string

  /** Full detail of what needs to be done. */
  description: string

  /** Present-continuous label shown in the UI while status === 'in_progress'. */
  activeForm?: string

  status: 'pending' | 'in_progress' | 'completed'
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Create the four task tools bound to an update callback.
 *
 * @param onUpdate Called after every mutation with a snapshot of current tasks.
 *                 Chat store writes it to the active tab; Vue reactivity updates
 *                 TaskOverlay automatically.
 */
export function createTaskTools(
  onUpdate: (items: TaskItem[]) => void,
  initialTasks?: TaskItem[],
) {
  let tasks: TaskItem[] = initialTasks ? initialTasks.map(t => ({ ...t })) : []
  let nextId = 1

  if (tasks.length > 0) {
    const maxId = Math.max(...tasks.map(t => Number.parseInt(t.id, 10) || 0))
    nextId = maxId + 1
  }

  function notify(): void {
    onUpdate([...tasks])
  }

  function findById(id: string): TaskItem | undefined {
    return tasks.find(t => t.id === id)
  }

  // ── create_task ─────────────────────────────────────────────────────────────

  const create_task = tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.create_task,
    inputSchema: z.object({
      subject: z
        .string()
        .min(1)
        .max(200)
        .describe('Brief, actionable title in imperative form. Example: "Fix auth bug".'),
      description: z
        .string()
        .min(1)
        .describe('Complete explanation of the work required to finish the task.'),
      activeForm: z
        .string()
        .optional()
        .describe('Present-continuous label shown in the UI while the task is in progress. Example: "Fixing auth bug".'),
    }),
    execute: async ({ subject, description, activeForm }) => {
      const task: TaskItem = {
        id: String(nextId++),
        subject: subject.trim(),
        description: description.trim(),
        ...(activeForm?.trim() ? { activeForm: activeForm.trim() } : {}),
        status: 'pending',
      }

      tasks.push(task)
      notify()

      return `Task #${task.id} created: ${task.subject}`
    },
  })

  // ── update_task ─────────────────────────────────────────────────────────────

  const update_task = tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.update_task,
    inputSchema: z.object({
      taskId: z
        .string()
        .describe('The ID of the task to update, as returned by create_task or list_tasks.'),
      status: z
        .enum(['pending', 'in_progress', 'completed', 'deleted'])
        .optional()
        .describe('New task status. Use "deleted" to permanently remove the task.'),
      subject: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('New subject for the task.'),
      description: z
        .string()
        .min(1)
        .optional()
        .describe('New description for the task.'),
      activeForm: z
        .string()
        .optional()
        .describe('New activeForm. Pass an empty string to clear it.'),
    }),
    execute: async ({ taskId, status, subject, description, activeForm }) => {
      const task = findById(taskId)

      if (!task)
        return `Task #${taskId} not found`

      if (status === 'deleted') {
        tasks = tasks.filter(t => t.id !== taskId)
        notify()
        return `Deleted task #${taskId}`
      }

      const updated: string[] = []

      if (status !== undefined && status !== task.status) {
        task.status = status
        updated.push('status')
      }

      if (subject !== undefined && subject.trim() !== task.subject) {
        task.subject = subject.trim()
        updated.push('subject')
      }

      if (description !== undefined && description.trim() !== task.description) {
        task.description = description.trim()
        updated.push('description')
      }

      // activeForm: empty string intentionally clears it
      if (activeForm !== undefined) {
        const trimmed = activeForm.trim()
        const next = trimmed || undefined

        if (next !== task.activeForm) {
          if (next === undefined) {
            delete task.activeForm
          }
          else {
            task.activeForm = next
          }

          updated.push('activeForm')
        }
      }

      notify()

      return updated.length === 0
        ? `Task #${taskId}: no changes`
        : `Updated task #${taskId}: ${updated.join(', ')}`
    },
  })

  // ── list_tasks ──────────────────────────────────────────────────────────────

  const list_tasks = tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.list_tasks,
    inputSchema: z.object({}),
    execute: async () => {
      if (tasks.length === 0)
        return 'No tasks'

      return tasks.map(t => `#${t.id} [${t.status}] ${t.subject}`).join('\n')
    },
  })

  // ── get_task ────────────────────────────────────────────────────────────────

  const get_task = tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.get_task,
    inputSchema: z.object({
      taskId: z
        .string()
        .describe('The ID of the task to retrieve.'),
    }),
    execute: async ({ taskId }) => {
      const task = findById(taskId)

      if (!task)
        return `Task #${taskId} not found`

      const lines = [
        `Task #${task.id}: ${task.subject}`,
        `Status: ${task.status}`,
        `Description: ${task.description}`,
      ]

      if (task.activeForm)
        lines.push(`Active form: ${task.activeForm}`)

      return lines.join('\n')
    },
  })

  // ── reset ───────────────────────────────────────────────────────────────────

  function reset(): void {
    tasks = []
    nextId = 1
    notify()
  }

  return {
    create_task,
    update_task,
    list_tasks,
    get_task,
    reset,
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

export type TaskTools = ReturnType<typeof createTaskTools>

// ── display labels ────────────────────────────────────────────────────────────

export function taskToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'create_task':
      return typeof args.subject === 'string'
        ? `New task: ${args.subject}`
        : 'Created task'

    case 'update_task': {
      const id = String(args.taskId ?? '?')
      const status = typeof args.status === 'string' ? args.status : undefined

      if (status === 'deleted')
        return `Deleted task #${id}`

      if (status === 'completed')
        return `Completed task #${id}`

      if (status === 'in_progress')
        return `Started task #${id}`

      return `Updated task #${id}`
    }

    case 'list_tasks':
      return 'Listed tasks'

    case 'get_task':
      return `Got task #${String(args.taskId ?? '?')}`

    default:
      return `Called ${toolName}`
  }
}
