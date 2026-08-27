import type { AgentStatus, AgentToolCategory } from '@/stores/chat/core/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sentinel values so call sites don't need to construct objects inline. */
export const STATUS_IDLE: AgentStatus = { type: 'idle' }
export const STATUS_INITIALIZING: AgentStatus = { type: 'initializing' }
export const STATUS_STREAMING: AgentStatus = { type: 'streaming' }
export const STATUS_COMPACTING: AgentStatus = { type: 'compacting' }
export const STATUS_WAITING_QUESTIONS: AgentStatus = { type: 'waiting-questions' }

export function statusInitializing(): AgentStatus {
  return STATUS_INITIALIZING
}

export function statusCompacting(): AgentStatus {
  return STATUS_COMPACTING
}

export function statusWaitingQuestions(): AgentStatus {
  return STATUS_WAITING_QUESTIONS
}

export function statusToolRunning(toolName: string): AgentStatus {
  return { type: 'tool-running', toolName, category: toolCategoryFromName(toolName) }
}

export function statusSleeping(untilMs?: number): AgentStatus {
  return { type: 'sleeping', ...(untilMs !== undefined ? { untilMs } : {}) }
}

export function statusWaitingPermission(toolName: string): AgentStatus {
  return { type: 'waiting-permission', toolName }
}

export function statusError(message: string): AgentStatus {
  return { type: 'error', message }
}

/** True if agent is doing any work (not idle/error). Used for Stop button queue logic. */
export function isActiveStatus(s: AgentStatus): boolean {
  return s.type !== 'idle' && s.type !== 'error'
}

/** @deprecated alias for isActiveStatus - kept for OSS compat */
export const isBusyStatus = isActiveStatus

/**
 * Legacy streaming check - true for any active work (not idle/error).
 * Kept for OSS compat; prefer isActiveStatus / isStrictStreamingStatus.
 */
export function isStreamingStatus(s: AgentStatus): boolean {
  return s.type !== 'idle' && s.type !== 'error'
}

/** Strict streaming - only spinner/gloss states (streaming|tool-running|initializing). */
export function isStrictStreamingStatus(s: AgentStatus): boolean {
  return s.type === 'streaming' || s.type === 'tool-running' || s.type === 'initializing'
}

export function isIdleStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'idle' }> {
  return s.type === 'idle'
}

export function isErrorStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'error' }> {
  return s.type === 'error'
}

export function isCompactingStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'compacting' }> {
  return s.type === 'compacting'
}

export function isWaitingStatus(s: AgentStatus): boolean {
  return s.type === 'waiting-questions' || s.type === 'waiting-permission' || s.type === 'sleeping'
}

export function isToolRunningStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'tool-running' }> {
  return s.type === 'tool-running'
}

export function isSleepingStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'sleeping' }> {
  return s.type === 'sleeping'
}

export function isWaitingPermissionStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'waiting-permission' }> {
  return s.type === 'waiting-permission'
}

export function isWaitingQuestionsStatus(s: AgentStatus): s is Extract<AgentStatus, { type: 'waiting-questions' }> {
  return s.type === 'waiting-questions'
}

// ── Tool name → category mapping ──────────────────────────────────────────────
// Static lookup — O(1), no regex, no string manipulation at runtime.

const TOOL_CATEGORY_MAP: Record<string, AgentToolCategory> = {
  // Filesystem
  read_files: 'fs',
  write_file: 'fs',
  edit_files: 'fs',
  list_directory: 'fs',
  glob: 'fs',
  grep: 'fs',
  // Shell
  run_command: 'shell',
  git_command: 'shell',
  // Web
  web_search: 'web',
  web_fetch: 'web',
  // Browser
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_screenshot: 'browser',
  browser_scroll: 'browser',
  browser_evaluate: 'browser',
  browser_close: 'browser',
  // Memory
  save_memory: 'memory',
  list_memories: 'memory',
  delete_memory: 'memory',
  // MCP — prefixed by convention, handled in toolCategoryFromName
  // Sub-agent
  spawn_subagent: 'subagent',
  // Image generation
  create_image: 'image',
  // Plan
  create_plan: 'plan',
  update_plan: 'plan',
  // Questions
  ask_questions: 'questions',
  // Tasks
  create_tasks: 'tasks',
  update_tasks: 'tasks',
  complete_task: 'tasks',
  // Sleep
  sleep: 'system',
  // Skills
  use_skill: 'system',
}

export function toolCategoryFromName(toolName: string): AgentToolCategory {
  const mapped = TOOL_CATEGORY_MAP[toolName]
  if (mapped)
    return mapped

  // MCP tools are prefixed with their server alias, e.g. "mcp__server__tool"
  if (toolName.startsWith('mcp__') || toolName.includes('__'))
    return 'mcp'

  return 'system'
}
