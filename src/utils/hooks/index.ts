import type { HookConfig, HookDecision, HookEvent, HookInput, HookLogEntry as LogEntry } from './types'
import { readonly, ref } from 'vue'
import { loadHooksConfig, matchesHookEntry } from './config'
import { makeHookId, runHooksForEntries } from './runner'

export { createDefaultHooksConfig, getHooksConfigPath, hooksConfigExists, invalidateCache, loadHooksConfig } from './config'
export type { HookConfig, HookDecision, HookEvent, HookInput } from './types'
export type { HookLogEntry, HookLogStatus } from './types'

// ── Execution log (reactive, in-memory) ──────────────────────────────────────

const MAX_LOG_ENTRIES = 200
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
    return input.toolName
  if ('filePath' in input)
    return input.filePath
  if ('command' in input && typeof input.command === 'string')
    return input.command
  return ''
}

/**
 * Resolve which hooks to run for a given event and input.
 */
function resolveHookEntries(config: HookConfig, event: HookEvent, input: HookInput) {
  const entries = config.hooks[event]
  if (!entries || entries.length === 0)
    return []

  const target = getMatcherTarget(event, input)
  const matched: Array<{ command: { command: string; timeoutSec?: number } }> = []

  for (const entry of entries) {
    if (!matchesHookEntry(entry, target))
      continue
    for (const hookCmd of entry.hooks) {
      matched.push({ command: hookCmd })
    }
  }

  return matched
}

/**
 * Run hooks for a lifecycle event.
 * Loads config from the workspace path, resolves matching hooks, and executes them.
 * Returns a decision (allowed/deny + messages).
 * Fail-open: returns allow on any error.
 */
export async function runHooks(
  event: HookEvent,
  input: HookInput,
  options?: { eventTimeoutMs?: number },
): Promise<HookDecision> {
  console.warn(`[hooks] runHooks() called — event=${event} workspace=${input.workspacePath ?? '(none)'}`)
  const config = await loadHooksConfig(input.workspacePath)
  if (!config) {
    console.warn('[hooks] No config loaded — returning allow (no hooks)')
    return { allowed: true, systemMessages: [], additionalContexts: [] }
  }

  const entries = resolveHookEntries(config, event, input)
  console.warn(`[hooks] Resolved ${entries.length} matching hook entry(ies) for ${event}`)
  if (entries.length === 0)
    return { allowed: true, systemMessages: [], additionalContexts: [] }

  const logId = makeHookId()
  const startedAt = Date.now()
  const commandStr = entries.map(e => e.command.command).join(' | ')

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
  })

  try {
    const decision = await runHooksForEntries({
      event,
      input,
      workspacePath: input.workspacePath,
      entries,
      ...(options?.eventTimeoutMs !== undefined ? { eventTimeoutMs: options.eventTimeoutMs } : {}),
    })

    const outputParts: string[] = []
    if (decision.systemMessages.length > 0)
      outputParts.push(...decision.systemMessages)
    if (decision.additionalContexts.length > 0)
      outputParts.push(...decision.additionalContexts)

    const finishedAt = Date.now()
    updateLogEntry(logId, {
      finishedAt,
      exitCode: decision.allowed ? 0 : 2,
      allowed: decision.allowed,
      status: decision.allowed ? 'completed' : 'denied',
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(outputParts.length > 0 ? { output: outputParts.join('\n') } : {}),
    })

    console.warn(`[hooks] runHooks() done — status=${decision.allowed ? 'completed' : 'denied'} timing=${finishedAt - startedAt}ms`)
    return decision
  }
  catch (error) {
    const finishedAt = Date.now()
    const errMsg = error instanceof Error ? error.message : String(error)
    console.warn(`[hooks] runHooks() error — timing=${finishedAt - startedAt}ms error=${errMsg}`)
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
  console.warn(`[hooks] fireHooks() (fire-and-forget) — event=${event}`)
  void runHooks(event, input).catch(err => {
    console.warn('[hooks] Unhandled error in fireHooks:', err)
  })
}

/**
 * Convenience: get project name from a workspace path.
 */
export function projectNameFromPath(workspacePath: string | null): string | null {
  if (!workspacePath)
    return null
  return workspacePath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
}
