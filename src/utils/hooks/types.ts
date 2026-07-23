// ── Hook events ──────────────────────────────────────────────────────────────

export type HookEvent
  = | 'SessionStart'
    | 'SessionEnd'
    | 'TurnStart'
    | 'TurnEnd'
    | 'StopFailure'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PreFileWrite'
    | 'PostFileWrite'
    | 'PreShellExec'
    | 'PostShellExec'

/** Events that can block execution by returning a deny decision. */
export const BLOCKABLE_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'PreToolUse',
  'PreFileWrite',
  'PreShellExec',
  'TurnStart',
])

// ── Configuration ────────────────────────────────────────────────────────────

export interface HookCommand {
  /** Shell command to run. Supports $EMTY_* env vars. */
  command: string
  /** Timeout in seconds (default: 5). */
  timeoutSec?: number
}

export interface HookEntry {
  /** Matcher pattern: tool name, pipe-separated names, or glob for file events. Empty/omit = match all. */
  matcher?: string
  /** Commands to execute when the matcher fires. */
  hooks: HookCommand[]
}

export interface HookConfig {
  hooks: Partial<Record<HookEvent, HookEntry[]>>
}

// ── Hook input (passed as JSON on stdin) ─────────────────────────────────────

export interface HookInputBase {
  event: HookEvent
  tabId: string
  workspacePath: string | null
  projectName: string | null
}

export interface SessionStartInput extends HookInputBase {
  event: 'SessionStart'
  conversationId: string
  mode: string
}

export interface SessionEndInput extends HookInputBase {
  event: 'SessionEnd'
  conversationId: string | null
  toolCallsCount: number
}

export interface TurnStartInput extends HookInputBase {
  event: 'TurnStart'
  prompt: string
  mode: string
}

export interface TurnEndInput extends HookInputBase {
  event: 'TurnEnd'
  conversationId: string
  toolCallsCount: number
  error?: string
}

export interface StopFailureInput extends HookInputBase {
  event: 'StopFailure'
  conversationId: string | null
  errorMessage: string
  errorCategory: string
  retryable: boolean
  attemptCount: number
  toolCallsCount: number
}

export interface PreToolUseInput extends HookInputBase {
  event: 'PreToolUse'
  toolName: string
  toolInput: Record<string, unknown>
}

export interface PostToolUseInput extends HookInputBase {
  event: 'PostToolUse'
  toolName: string
  toolInput: Record<string, unknown>
  toolResult: unknown
}

export interface PreFileWriteInput extends HookInputBase {
  event: 'PreFileWrite'
  filePath: string
}

export interface PostFileWriteInput extends HookInputBase {
  event: 'PostFileWrite'
  filePath: string
  added: number | null
  removed: number | null
}

export interface PreShellExecInput extends HookInputBase {
  event: 'PreShellExec'
  command: string
  isBackground: boolean
}

export interface PostShellExecInput extends HookInputBase {
  event: 'PostShellExec'
  command: string
  exitCode: number | null
}

export type HookInput
  = | SessionStartInput
    | SessionEndInput
    | TurnStartInput
    | TurnEndInput
    | StopFailureInput
    | PreToolUseInput
    | PostToolUseInput
    | PreFileWriteInput
    | PostFileWriteInput
    | PreShellExecInput
    | PostShellExecInput

// ── Hook output (parsed from stdout JSON) ────────────────────────────────────

export type PermissionDecision = 'allow' | 'deny'

export interface HookOutput {
  permissionDecision?: PermissionDecision
  permissionDecisionReason?: string
  systemMessage?: string
  additionalContext?: string
}

// ── Aggregated result from running all hooks for an event ─────────────────────

export interface HookDecision {
  allowed: boolean
  reason?: string
  systemMessages: string[]
  additionalContexts: string[]
}

// ── Execution log entry ──────────────────────────────────────────────────────

export type HookLogStatus = 'running' | 'completed' | 'error' | 'denied'

export interface HookLogEntry {
  id: string
  event: HookEvent
  command: string
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  allowed: boolean
  status: HookLogStatus
  reason?: string
  error?: string
  output?: string
  tabId: string
}

// ── Environment variables injected into hook commands ────────────────────────
// Access via $VARNAME (sh/bash) or $env:VARNAME (PowerShell)

export const HOOK_ENV_KEYS = {
  EVENT: 'EMTY_EVENT',
  INPUT: 'EMTY_INPUT',
  TAB_ID: 'EMTY_TAB_ID',
  WORKSPACE: 'EMTY_WORKSPACE',
  PROJECT_NAME: 'EMTY_PROJECT_NAME',
  TOOL_NAME: 'EMTY_TOOL_NAME',
  FILE_PATH: 'EMTY_FILE_PATH',
  COMMAND: 'EMTY_COMMAND',
} as const
