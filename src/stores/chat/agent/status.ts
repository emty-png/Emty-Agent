import type { AgentStatus, AgentToolCategory } from '@/stores/chat/core/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sentinel values so call sites don't need to construct objects inline. */
export const STATUS_IDLE: AgentStatus = { type: 'idle' }
export const STATUS_INITIALIZING: AgentStatus = { type: 'initializing' }
export const STATUS_STREAMING: AgentStatus = { type: 'streaming' }

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

/** Returns true for any status that represents active agent work. */
export function isActiveStatus(s: AgentStatus): boolean {
  return s.type !== 'idle' && s.type !== 'error'
}

/** Returns true for the legacy `isStreaming` boolean equivalent. */
export function isStreamingStatus(s: AgentStatus): boolean {
  return s.type !== 'idle' && s.type !== 'error'
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
