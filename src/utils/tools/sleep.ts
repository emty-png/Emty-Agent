import { tool } from 'ai'
import { z } from 'zod'
import { refreshManagedCommandTask } from './shell'

export function createSleepTool() {
  return tool({
    description: `Pause execution for a specified duration. Use when you need to wait — for example, after starting a background server, before checking if a service is ready, or to space out retry attempts.

Do NOT use for long waits when you could poll with action: "status" instead. This tool blocks your execution for the full duration.`,
    inputSchema: z.object({
      durationMs: z.number().int().min(100).max(300_000).describe(
        'How long to sleep in milliseconds. Range: 100–300,000 (5 minutes max).',
      ),
      reason: z.string().max(200).optional().describe(
        'Optional short reason for the sleep, for logging. E.g. "waiting for dev server startup".',
      ),
      wakeOnTaskIds: z.array(z.string().min(1)).max(5).optional().describe(
        'Optional tracked command task IDs. Sleep wakes early if any listed task finishes or fails.',
      ),
      checkEveryMs: z.number().int().min(250).max(5000).optional().describe(
        'Polling interval for wakeOnTaskIds. Default: 1000.',
      ),
    }),
    execute: async ({ durationMs, wakeOnTaskIds, checkEveryMs }, { abortSignal }) => {
      if (abortSignal?.aborted)
        return { slept: 0, aborted: true }

      const start = Date.now()
      const pollMs = checkEveryMs ?? 1000

      return new Promise<{
        slept: number
        aborted: boolean
        wokeByTaskId?: string
        taskStatus?: string
      }>(resolve => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let pollTimer: ReturnType<typeof setInterval> | null = null

        function settle(payload: {
          slept: number
          aborted: boolean
          wokeByTaskId?: string
          taskStatus?: string
        }) {
          if (settled)
            return
          settled = true
          if (timer != null)
            clearTimeout(timer)
          if (pollTimer != null)
            clearInterval(pollTimer)
          abortSignal?.removeEventListener('abort', onAbort)
          resolve(payload)
        }

        function onAbort() {
          settle({ slept: Date.now() - start, aborted: true })
        }

        timer = setTimeout(() => {
          settle({ slept: Date.now() - start, aborted: false })
        }, durationMs)

        if (wakeOnTaskIds?.length) {
          pollTimer = setInterval(() => {
            void (async () => {
              for (const taskId of wakeOnTaskIds) {
                const task = await refreshManagedCommandTask(taskId)
                if (task && task.status !== 'running') {
                  settle({
                    slept: Date.now() - start,
                    aborted: false,
                    wokeByTaskId: taskId,
                    taskStatus: task.status,
                  })
                  return
                }
              }
            })()
          }, pollMs)
        }

        abortSignal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  })
}

export type SleepTool = ReturnType<typeof createSleepTool>

export function sleepToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'sleep')
    return `Called ${toolName}`

  const ms = typeof args.durationMs === 'number' ? args.durationMs : 0
  const seconds = Math.round(ms / 1000)
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  const taskCount = Array.isArray(args.wakeOnTaskIds) ? args.wakeOnTaskIds.length : 0
  const base = reason ? `Sleep ${seconds}s (${reason})` : `Sleep ${seconds}s`
  return taskCount > 0 ? `${base} until task${taskCount === 1 ? '' : 's'}` : base
}
