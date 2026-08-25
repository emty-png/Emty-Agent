// ── Hook events ──────────────────────────────────────────────────────────────

export type KnownHookEvent
  = | 'SessionStart'
    | 'SessionEnd'
    | 'TurnStart'
    | 'TurnEnd'
    | 'StopFailure'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PreFileWrite'
    | 'PostFileWrite'
    | 'PreFileEdit'
    | 'PostFileEdit'
    | 'PreFileRead'
    | 'PostFileRead'
    | 'PreShellExec'
    | 'PostShellExec'
    | 'PreMcpUse'
    | 'PostMcpUse'
    | 'BeforePromptBuild'
    | 'AfterPromptBuild'
    | 'PreCompact'
    | 'PostCompact'
    | 'SubagentStart'
    | 'SubagentEnd'
    | 'PermissionRequest'

/** Allows custom user-defined events (string & {}) while keeping autocomplete for known ones. */
export type HookEvent = KnownHookEvent | (string & {})

/** Events that can block execution by returning a deny decision. */
export const BLOCKABLE_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'TurnStart',
  'PreToolUse',
  'PreFileWrite',
  'PreFileEdit',
  'PreFileRead',
  'PreShellExec',
  'PreMcpUse',
  'BeforePromptBuild',
  'PreCompact',
  'PermissionRequest',
])

export function isBlockableEvent(event: HookEvent, customEvents?: Record<string, CustomEventDef>): boolean {
  if (BLOCKABLE_EVENTS.has(event))
    return true
  if (customEvents && customEvents[event]?.blockable)
    return true
  return false
}

// ── Configuration ────────────────────────────────────────────────────────────

export type HookCommandType = 'shell' | 'node' | 'js'

export interface HookCommand {
  /** Shell command to run. Supports $EMTY_* env vars. */
  command: string
  /** Timeout in seconds (default: 5). */
  timeoutSec?: number
  /** Override working directory (defaults to workspacePath). */
  cwd?: string
  /** Extra env vars merged over EMTY_ */
  env?: Record<string, string>
  /** Execution type: shell (default), node (run file with node), js (inline JS) */
  type?: HookCommandType
  /** For type node/js: path to file (node) or inline code (js). If omitted, uses command. */
  file?: string
  /** Whether this command is enabled (default true). */
  enabled?: boolean
}

export interface HookMatcher {
  /** Tool name glob/regex (e.g. "write_file" or "/^mcp__/") */
  toolName?: string
  /** File path glob/regex (relative to workspace + absolute both tested) */
  filePath?: string
  /** Shell command glob/regex */
  command?: string
  /** Project name glob/regex */
  projectName?: string
  /** Mode (e.g. build/plan) glob/regex */
  mode?: string
  /** Prompt regex (for TurnStart/BeforePrompt) */
  prompt?: string
  /**
   * Key-value matchers against toolInput (stringified). Value is glob or /regex/.
   * Example: { "file_path": "*.ts", "pattern": "/TODO/" }
   */
  input?: Record<string, string>
}

export interface HookEntry {
  /** Legacy matcher pattern: tool name, pipe-separated names, or glob for file events. Empty/omit = match all. */
  matcher?: string
  /** Structured matcher (preferred, AND semantics). If present, both matcher and match must pass. */
  match?: HookMatcher
  /** Commands to execute when the matcher fires. */
  hooks: HookCommand[]
  /** User-visible name */
  name?: string
  /** Description */
  description?: string
  /** Whether entry is enabled (default true) */
  enabled?: boolean
  /** Priority — higher runs first. Global+project are merged and sorted by priority desc. */
  priority?: number
  /** How hooks inside this entry run */
  runMode?: 'sequential' | 'parallel' | 'race'
}

export interface CustomEventDef {
  /** Description shown in UI */
  description?: string
  /** Whether deny can block */
  blockable?: boolean
}

export interface HookConfig {
  /** Config version for migrations */
  version?: number
  /** Inherit from other JSON files (relative to .emty folder or absolute) */
  extends?: string[]
  hooks: Partial<Record<HookEvent, HookEntry[]>>
  /** User-defined custom events */
  customEvents?: Record<string, CustomEventDef>
  /** Per-event timeout caps (ms) */
  eventTimeoutMs?: Partial<Record<HookEvent, number>>
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

export interface PreFileEditInput extends HookInputBase {
  event: 'PreFileEdit'
  filePath: string
}

export interface PostFileEditInput extends HookInputBase {
  event: 'PostFileEdit'
  filePath: string
  added: number | null
  removed: number | null
}

export interface PreFileReadInput extends HookInputBase {
  event: 'PreFileRead'
  filePath: string
  toolName: string
}

export interface PostFileReadInput extends HookInputBase {
  event: 'PostFileRead'
  filePath: string
  toolName: string
  fileCount?: number
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

export interface PreMcpUseInput extends HookInputBase {
  event: 'PreMcpUse'
  toolName: string
  toolInput: Record<string, unknown>
  serverName?: string
}

export interface PostMcpUseInput extends HookInputBase {
  event: 'PostMcpUse'
  toolName: string
  toolInput: Record<string, unknown>
  toolResult: unknown
  serverName?: string
}

export interface BeforePromptBuildInput extends HookInputBase {
  event: 'BeforePromptBuild'
  prompt: string
  mode: string
  conversationId: string
  systemPrompt?: string
}

export interface AfterPromptBuildInput extends HookInputBase {
  event: 'AfterPromptBuild'
  prompt: string
  mode: string
  conversationId: string
  systemPrompt: string
}

export interface PreCompactInput extends HookInputBase {
  event: 'PreCompact'
  conversationId: string
  tokenCount?: number
}

export interface PostCompactInput extends HookInputBase {
  event: 'PostCompact'
  conversationId: string
  tokenCount?: number
}

export interface SubagentStartInput extends HookInputBase {
  event: 'SubagentStart'
  subagentId: string
  personality?: string
  mission?: string
}

export interface SubagentEndInput extends HookInputBase {
  event: 'SubagentEnd'
  subagentId: string
  status?: string
}

export interface PermissionRequestInput extends HookInputBase {
  event: 'PermissionRequest'
  toolName: string
  toolInput: Record<string, unknown>
}

export interface CustomHookInput extends HookInputBase {
  event: string
  payload?: Record<string, unknown>
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
    | PreFileEditInput
    | PostFileEditInput
    | PreFileReadInput
    | PostFileReadInput
    | PreShellExecInput
    | PostShellExecInput
    | PreMcpUseInput
    | PostMcpUseInput
    | BeforePromptBuildInput
    | AfterPromptBuildInput
    | PreCompactInput
    | PostCompactInput
    | SubagentStartInput
    | SubagentEndInput
    | PermissionRequestInput
    | CustomHookInput

// ── Hook output (parsed from stdout JSON) ────────────────────────────────────

export type PermissionDecision = 'allow' | 'deny'

export interface HookOutput {
  permissionDecision?: PermissionDecision
  permissionDecisionReason?: string
  systemMessage?: string
  additionalContext?: string
  /** Patch toolInput before execution (only for blockable Pre* events) */
  toolInputPatch?: Record<string, unknown>
  /** Patch env for subsequent hooks / context */
  envPatch?: Record<string, string>
  /** Custom payload for custom events */
  payload?: Record<string, unknown>
}

// ── Aggregated result from running all hooks for an event ─────────────────────

export interface HookDecision {
  allowed: boolean
  reason?: string
  systemMessages: string[]
  additionalContexts: string[]
  /** Merged toolInputPatch from hooks (last wins, shallow merge) */
  toolInputPatch?: Record<string, unknown>
  /** Merged envPatch */
  envPatch?: Record<string, string>
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
  workspacePath?: string | null
}

// ── Environment variables injected into hook commands ────────────────────────
// Access via $VARNAME (sh/bash) or $env:VARNAME (PowerShell)

export const HOOK_ENV_KEYS = {
  EVENT: 'EMTY_EVENT',
  INPUT: 'EMTY_INPUT',
  INPUT_FILE: 'EMTY_INPUT_FILE',
  TAB_ID: 'EMTY_TAB_ID',
  WORKSPACE: 'EMTY_WORKSPACE',
  PROJECT_NAME: 'EMTY_PROJECT_NAME',
  TOOL_NAME: 'EMTY_TOOL_NAME',
  FILE_PATH: 'EMTY_FILE_PATH',
  COMMAND: 'EMTY_COMMAND',
  CONVERSATION_ID: 'EMTY_CONVERSATION_ID',
  MODE: 'EMTY_MODE',
  PROMPT: 'EMTY_PROMPT',
} as const
