import type { Attachment } from './attachment-types'
import type { ChatPromptEstimate } from '@/utils/chatEstimate'
import type { FileReadRegistry } from '@/utils/tools/fs/shared'
import type { ToolPermissionDecision } from '@/utils/tools/permissions'
import type { PendingBatch } from '@/utils/tools/questions'
import type { SubAgentInfo, SubAgentPersonality } from '@/utils/tools/subagent'
import type { TaskItem } from '@/utils/tools/todos'
import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { UsageStats } from '@/utils/contextCaching'

// Internal helper — used by agentLifecycle and chat.ts
import { isStreamingStatus } from './agentStatus'

// ── Chat mode ─────────────────────────────────────────────────────────────────

export type ChatMode
  = | 'build' // Full agent — all tools
    | 'plan' // Read-only agent — write/shell tools return error stubs
    | 'chat' // Minimal streaming — questions, sleep, web, memory only
    | 'design' // Isolated HTML/CSS/JS sandbox — create_design + edit_design only

// ── Design artifacts ─────────────────────────────────────────────────────────

export interface DesignArtifact {
  id: string
  name: string
  html: string
  css: string
  js: string
  description: string
  createdAt: number
  updatedAt: number
}

// ── Agent status ──────────────────────────────────────────────────────────────

export type AgentToolCategory
  = | 'fs'
    | 'shell'
    | 'web'
    | 'browser'
    | 'memory'
    | 'mcp'
    | 'subagent'
    | 'image'
    | 'plan'
    | 'questions'
    | 'tasks'
    | 'system'

export type AgentStatus
  = | { type: 'idle' }
    | { type: 'initializing' }
    | { type: 'streaming' }
    | { type: 'tool-running'; toolName: string; category: AgentToolCategory }
    | { type: 'sleeping'; untilMs?: number }
    | { type: 'waiting-questions' }
    | { type: 'waiting-permission'; toolName: string }
    | { type: 'compacting' }
    | { type: 'reconnecting'; attempt: number; maxAttempts: number; nextRetryMs: number }
    | { type: 'error'; message: string }

// ── Tool events ───────────────────────────────────────────────────────────────

export interface ToolEvent {
  id: string
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  toolName: string
  startedAt: number
  finishedAt?: number
  /** Input args from the model. Persisted for tool-call → result replay. */
  args?: Record<string, unknown>
  /** Return value from execute(). Persisted for context reconstruction. */
  result?: unknown
  /** Live stdout/stderr for command tools (UI only — model uses `result`). */
  liveOutput?: {
    stdout?: string
    stderr?: string
  }
  /** Tool-specific badge metadata, e.g. subAgentTabId for spawn_subagent. */
  metadata?: Record<string, unknown>
}

// ── Message ───────────────────────────────────────────────────────────────────

export type MessagePart
  = | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool'; toolCallId: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  mentionContext?: string
  toolEvents?: ToolEvent[]
  parts?: MessagePart[]
  cacheStats?: UsageStats
  error?: string
  attachments?: Attachment[]
  skillId?: string
  elapsedSec?: number | null
  modelUid?: string | null
  modelName?: string | null
}

// ── Draft / estimator ─────────────────────────────────────────────────────────

export interface ChatDraftState {
  text: string
  attachments: Attachment[]
}

export interface ChatEstimatorState {
  estimate: ChatPromptEstimate | null
  error: string
  estimating: boolean
}

// ── Permissions ───────────────────────────────────────────────────────────────

export interface PendingToolPermission {
  requestId: string
  toolName: string
  toolLabel: string
  actionTitle: string
  actionDetails: string[]
}

// ── Chat tab ──────────────────────────────────────────────────────────────────

export interface ChatTab {
  id: string
  title: string
  messages: Message[]
  conversationId: string | null
  workspacePath: string | null
  workspaceMeta?: WorkspaceSnapshot | null
  workspaceLocked: boolean
  /** Authoritative agent lifecycle status. */
  agentStatus: AgentStatus
  todos: TaskItem[]
  modelUid?: string | null
  disabledSkillIds?: string[]
  disabledMcpServerIds?: string[]
  draft: ChatDraftState
  estimator: ChatEstimatorState
  isCompacting?: boolean
  pendingQuestions?: PendingBatch | null
  pendingPermissions: PendingToolPermission[]
  /** Per-tab file read registry — no cross-tab dedup interference. */
  readRegistry: FileReadRegistry
  /** Present only on sub-agent tabs (ephemeral, not persisted). */
  subAgent?: SubAgentInfo
  mode?: ChatMode
  /** Design mode — true for tabs created via "New Design" */
  isDesignTab?: boolean
  /** All design artifacts produced by the agent in this tab. */
  designs?: DesignArtifact[]
  /** ID of the design currently shown in the canvas. */
  activeDesignId?: string | null
}

export type { Attachment, SubAgentInfo, SubAgentPersonality, TaskItem, ToolPermissionDecision }
export { isStreamingStatus }
