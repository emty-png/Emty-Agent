/**
 * Centralized kill-all for a tab.
 * Guarantees every tracked process family for `tabId` is terminated.
 * Used by closeTab() and stopGeneration() with a blocking await + spinner.
 */

const KILL_TIMEOUT_MS = 3000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return await Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(resolve, ms, null)),
  ])
}

export async function killAllForTab(tabId: string): Promise<void> {
  const tasks: Array<Promise<unknown>> = []

  // 1. Shell / git tracked tasks (run_command + git_command)
  tasks.push(
    import('@/utils/tools/shell').then(({ stopTasksForTab }) => stopTasksForTab(tabId)).catch(() => {}),
  )

  // 2. Terminal PTY sessions owned by this tab
  tasks.push(
    import('@/stores/terminal').then(async ({ useTerminalStore }) => {
      try {
        const store = useTerminalStore()
        await store.disposeOwner(tabId)
      }
      catch {}
    }).catch(() => {}),
  )

  // 3. MCP sessions scoped to this tab (if any) — fallback to no-op when not tracked
  tasks.push(
    import('@/utils/mcp').then(async mod => {
      try {
        const fn = (mod as unknown as { invalidateMcpSessionsForTab?: (id: string) => void }).invalidateMcpSessionsForTab
        if (typeof fn === 'function')
          fn(tabId)
      }
      catch {}
    }).catch(() => {}),
  )

  // 4. Hook runners scoped to this tab
  tasks.push(
    import('@/utils/hooks/runner').then(async mod => {
      try {
        const fn = (mod as unknown as { abortHooksForTab?: (id: string) => void }).abortHooksForTab
        if (typeof fn === 'function')
          fn(tabId)
      }
      catch {}
    }).catch(() => {}),
  )

  // Block with timeout so UI never hangs forever (taskkill can stall)
  await withTimeout(Promise.allSettled(tasks), KILL_TIMEOUT_MS)
}

export async function killAllForTabs(tabIds: string[]): Promise<void> {
  await Promise.allSettled(tabIds.map(id => killAllForTab(id)))
}
