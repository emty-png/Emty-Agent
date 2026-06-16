import type { ToolSet } from '@/utils/ai'
import { tool } from 'ai'

/**
 * Ensures tool calls execute one by one in registration order.
 *
 * The AI SDK uses `Promise.all` to execute tool calls in parallel. By wrapping
 * each tool's `execute` with `queue.enqueue()`, all tools still register
 * synchronously (preserving model order), but each waits for the previous one
 * to finish before starting.
 */
export class SequentialToolQueue {
  private _chain: Promise<void> = Promise.resolve()

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._chain.then(fn, fn)
    this._chain = result.then(() => {}, () => {})
    return result
  }
}

/**
 * Wraps every tool in a `ToolSet` so its `execute` runs through the given
 * `SequentialToolQueue`. Call this *after* `wrapToolSetWithPermissions` so the
 * permission check itself is also serialised.
 */
export function wrapToolSetSequentially(
  tools: ToolSet,
  queue: SequentialToolQueue,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, toolDef]) => [
      toolName,
      tool({
        description: toolDef.description ?? '',
        inputSchema: toolDef.inputSchema,
        execute: (args, execOptions) =>
          queue.enqueue(() => toolDef.execute?.(args, execOptions) as Promise<unknown>),
      }),
    ]),
  ) as ToolSet
}
