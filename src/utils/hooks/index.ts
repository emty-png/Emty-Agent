import type { HookConfig, HookDecision, HookEvent, HookInput, HookLogEntry as LogEntry } from './types'
import { readonly, ref } from 'vue'
import { loadGlobalHooksConfig, loadHooksConfig, matchesHookEntry } from './config'
import { makeHookId, runHooksForEntries } from './runner'

export {
  createDefaultGlobalHooksConfig,
  createDefaultHooksConfig,
  getGlobalHooksConfigPath,
  getHooksConfigPath,
  globalHooksConfigExists,
  hooksConfigExists,
  invalidateCache,
  invalidateGlobalCache,
  loadGlobalHooksConfig,
  loadHooksConfig,
} from './config'
export type { HookConfig, HookDecision, HookEvent, HookInput, KnownHookEvent } from './types'
export type { HookLogEntry, HookLogStatus } from './types'

// ── Execution log (reactive, in-memory) ──────────────────────────────────────

const MAX_LOG_ENTRIES = 500
const _logEntries = ref<LogEntry[]>([])

/** Reactive hook log — components can watch this directly. */
export const hookLog = readonly(_logEntries)

export function getHookLog(): readonly LogEntry[] {
  return _logEntries.value
}

function addLogEntry(entry: LogEntry): void {
  _logEntries.value.unshift(entry)
  if (_logEntries.value.length > MAX_LOG_ENTRIES)
    _logEntries.value.pop()
}

function updateLogEntry(id: string, patch: Partial<LogEntry>): void {
  const entry = _logEntries.value.find(e => e.id === id)
  if (entry)
    Object.assign(entry, patch)
}

export function clearHookLog() {
  _logEntries.value = []
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * Determine the matcher target for a hook event.
 * For tool events: the tool name.
 * For file events: the file path.
 * For shell events: the command string.
 * For other events: empty string (matches everything).
 */
function getMatcherTarget(_event: HookEvent, input: HookInput): string {
  if ('toolName' in input)
    return (input as unknown as { toolName: string }).toolName
  if ('filePath' in input)
    return (input as unknown as { filePath: string }).filePath
  if ('command' in input && typeof (input as unknown as { command: unknown }).command === 'string')
    return (input as unknown as { command: string }).command
  return ''
}

/**
 * Resolve which hooks to run for a given event and input.
 * Returns flat list sorted by priority desc (priority override).
 */
function resolveHookEntries(config: HookConfig, event: HookEvent, input: HookInput) {
  const entries = config.hooks[event]
  if (!entries || entries.length === 0)
    return []

  const target = getMatcherTarget(event, input)
  const matched: Array<{ command: { command: string; timeoutSec?: number; cwd?: string; env?: Record<string, string>; type?: string; file?: string; enabled?: boolean }; priority?: number; runMode?: string }> = []

  for (const entry of entries) {
    if (entry.enabled === false)
      continue
    if (!matchesHookEntry(entry, target, input))
      continue
    const prio = entry.priority ?? 0
    const runMode = entry.runMode
    for (const hookCmd of entry.hooks) {
      if (hookCmd.enabled === false)
        continue
      matched.push({ command: hookCmd as unknown as { command: string; timeoutSec?: number }, priority: prio, ...(runMode ? { runMode } : {}) })
    }
  }

  return matched
}

/**
 * Run hooks for a lifecycle event.
 * Loads global + project configs, resolves matching hooks (global first, then project), and executes them.
 * Returns a decision (allowed/deny + messages).
 * Fail-open: returns allow on any error.
 */
export async function runHooks(
  event: HookEvent,
  input: HookInput,
  options?: { eventTimeoutMs?: number },
): Promise<HookDecision> {
  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalHooksConfig(),
    loadHooksConfig(input.workspacePath),
  ])

  const globalEntries = globalConfig ? resolveHookEntries(globalConfig, event, input) : []
  const projectEntries = projectConfig ? resolveHookEntries(projectConfig, event, input) : []
  const entriesUnsorted = [...globalEntries, ...projectEntries]

  // Priority overrides: higher priority first, stable sort
  const entries = entriesUnsorted.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

  if (entries.length === 0)
    return { allowed: true, systemMessages: [], additionalContexts: [] }

  const logId = makeHookId()
  const startedAt = Date.now()
  const commandStr = entries.map(e => (e.command as unknown as { command: string }).command).join(' | ')

  // Resolve custom events registry and event timeout
  const customEvents = { ...(globalConfig?.customEvents ?? {}), ...(projectConfig?.customEvents ?? {}) }
  const eventTimeoutMs = options?.eventTimeoutMs ?? globalConfig?.eventTimeoutMs?.[event] ?? projectConfig?.eventTimeoutMs?.[event]

  // Add a running entry immediately so the UI shows it live
  addLogEntry({
    id: logId,
    event,
    command: commandStr,
    startedAt,
    finishedAt: null,
    exitCode: null,
    allowed: true,
    status: 'running',
    tabId: input.tabId,
    workspacePath: input.workspacePath,
  })

  try {
    const decision = await runHooksForEntries({
      event,
      input,
      workspacePath: input.workspacePath,
      entries: entries as unknown as Array<{ command: { command: string; timeoutSec?: number } }>,
      ...(eventTimeoutMs !== undefined ? { eventTimeoutMs } : {}),
      ...(Object.keys(customEvents).length > 0 ? { customEvents } : {}),
    })

    const outputParts: string[] = []
    if (decision.systemMessages.length > 0)
      outputParts.push(...decision.systemMessages)
    if (decision.additionalContexts.length > 0)
      outputParts.push(...decision.additionalContexts)
    if (decision.toolInputPatch)
      outputParts.push(`[toolInputPatch] ${JSON.stringify(decision.toolInputPatch).slice(0, 300)}`)

    const finishedAt = Date.now()
    updateLogEntry(logId, {
      finishedAt,
      exitCode: decision.allowed ? 0 : 2,
      allowed: decision.allowed,
      status: decision.allowed ? 'completed' : 'denied',
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(outputParts.length > 0 ? { output: outputParts.join('\n') } : {}),
    })

    return decision
  }
  catch (error) {
    const finishedAt = Date.now()
    const errMsg = error instanceof Error ? error.message : String(error)
    updateLogEntry(logId, {
      finishedAt,
      exitCode: null,
      allowed: true,
      status: 'error',
      error: errMsg,
    })
    return { allowed: true, systemMessages: [], additionalContexts: [] }
  }
}

/**
 * Fire-and-forget variant for post-events.
 * Runs hooks in the background without blocking.
 */
export function fireHooks(event: HookEvent, input: HookInput): void {
  void runHooks(event, input).catch(() => {})
}

/**
 * Run a custom event directly (for user-defined events).
 */
export function fireCustomHook(event: string, input: HookInput & { payload?: Record<string, unknown> }): void {
  void runHooks(event as HookEvent, input as unknown as HookInput).catch(() => {})
}

export async function runCustomHook(event: string, input: HookInput & { payload?: Record<string, unknown> }): Promise<HookDecision> {
  return runHooks(event as HookEvent, input as unknown as HookInput)
}

/**
 * Test a matcher without executing (for UI dry-run).
 */
export function testHookMatcher(entry: import('./types').HookEntry, input: HookInput): boolean {
  const target = getMatcherTarget(entry as unknown as string as HookEvent, input)
  return matchesHookEntry(entry, target, input)
}

/**
 * Convenience: get project name from a workspace path.
 */
export function projectNameFromPath(workspacePath: string | null): string | null {
  if (!workspacePath)
    return null
  return workspacePath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
}
