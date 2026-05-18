/**
 * src/utils/tools/todos.ts
 *
 * The write_todo tool lets the agent maintain a live task list in the UI
 * to track progress on complex multi-step work.
 *
 * Design:
 *   The agent sends the COMPLETE current state of the todo list on every call.
 *   This is intentionally simple — no partial diffs, no ID management.
 *   The agent replaces the whole list, updating done states as work completes.
 *
 *   The tool receives an `onUpdate` callback (provided by the chat store at
 *   stream time) that writes the processed items to the active ChatTab's
 *   `todos` array. Vue's reactivity propagates the change to TodoOverlay
 *   automatically — no module-level singleton refs needed.
 *
 * Usage pattern the agent should follow:
 *   1. At the start of any complex task: call write_todo with all items done=false
 *   2. After completing each item: re-call with that item's done=true
 *   3. When all done, the final call has all done=true
 *   4. Never call for trivial single-step tasks
 */

import { tool } from 'ai'
import { z } from 'zod'

// ── types ─────────────────────────────────────────────────────────────────────

export interface TodoItem {
  /** Stable identifier — generated from insertion order + text hash. */
  id: string
  text: string
  done: boolean
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Simple deterministic ID: index + first 8 chars of text (no crypto needed). */
function makeItemId(index: number, text: string): string {
  const slug = text.toLowerCase().replace(/\W+/g, '').slice(0, 8)
  return `todo-${index}-${slug}`
}

// ── tool factory ──────────────────────────────────────────────────────────────

/**
 * Create the write_todo tool bound to a callback.
 *
 * @param onUpdate  Called every time the agent writes todos.
 *                  Receives the full processed list. Chat store writes it to
 *                  the active tab; Vue reactivity updates TodoOverlay.
 */
export function createWriteTodoTool(onUpdate: (items: TodoItem[]) => void) {
  return tool({
    description: `Maintain a live task list in the UI for complex multi-step work.

Use for tasks with 3+ sequential steps. Never use for trivial single-step tasks.

How it works:
- Call BEFORE starting work so the user sees the plan upfront.
- Send the COMPLETE list every call — this fully replaces the previous state.
- Start with all items done=false. After finishing each step, re-call with that item done=true.
- Empty array clears the list.`,

    inputSchema: z.object({
      items: z
        .array(
          z.object({
            text: z.string().min(1).max(200).describe(
              'Short, concrete task description. Use an action verb. E.g. "Read auth.ts", "Add input validation".',
            ),
            done: z.boolean().describe(
              'true = task is complete. false = not yet started or in progress.',
            ),
          }),
        )
        .max(20)
        .describe(
          'The FULL current todo list. Replaces any previous list. '
          + 'Send all items every call, updating done states as you complete them. '
          + 'Empty array clears the list.',
        ),
    }),

    execute: async ({ items }) => {
      const processed: TodoItem[] = items.map((item, i) => ({
        id: makeItemId(i, item.text),
        text: item.text.trim(),
        done: item.done,
      }))

      onUpdate(processed)

      const doneCount = processed.filter(t => t.done).length
      const total = processed.length

      if (total === 0) {
        return { status: 'cleared' }
      }

      return {
        status: doneCount === total ? 'all_done' : 'in_progress',
        total,
        done: doneCount,
        remaining: total - doneCount,
      }
    },
  })
}

// ── factory shorthand ─────────────────────────────────────────────────────────

export type WriteTodoTool = ReturnType<typeof createWriteTodoTool>

// ── display labels ────────────────────────────────────────────────────────────

export function todosToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'write_todo')
    return `Called ${toolName}`

  const items = args.items as { text: string; done: boolean }[] | undefined

  if (!items || items.length === 0)
    return 'Cleared todos'

  const done = items.filter(i => i.done).length
  const total = items.length

  if (done === total)
    return `All ${total} todo${total === 1 ? '' : 's'} complete`

  if (done === 0)
    return `Set ${total} todo${total === 1 ? '' : 's'}`

  return `Todos: ${done}/${total} done`
}
