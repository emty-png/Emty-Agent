import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import type { ChatPromptEstimate } from '@/utils/chatEstimate'
import type { FileReadRegistry } from '@/utils/tools/fs/shared'
import type { ToolPermissionDecision } from '@/utils/tools/permissions'
import type { PendingBatch } from '@/utils/tools/questions'
import type { SubAgentInfo, SubAgentPersonality } from '@/utils/tools/subagent'
import type { TaskItem } from '@/utils/tools/todos'
import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { UsageStats } from '@/utils/contextCaching'

// ── Chat mode ─────────────────────────────────────────────────────────────────

export type ChatMode
  = | 'build' // Full agent — all tools
    | 'plan' // Read-only agent — write/shell tools return error stubs
    | 'chat' // Minimal streaming — questions, sleep, web, memory only
    | 'design' // Project-based design mode — scaffold, create/edit files, build

// ── Design artifacts ─────────────────────────────────────────────────────────

export type DesignProjectType
  = | 'single-file'
    | 'multiple-files'
    | 'vite-react'
    | 'vite-vue'
    | 'vite-svelte'
    | 'vite-vanilla'

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

export interface DesignScreenRef {
  name: string
  path: string
}

export interface DesignConnection {
  from: string
  to: string
  label?: string
}

export interface DesignManifest {
  design: string
  screens: string[]
  connections: DesignConnection[]
  updatedAt: number
  viewports?: Record<string, { width: number; height: number; preset: 'mobile' | 'tablet' | 'desktop' }>
}

export interface DesignVersionRef {
  id: string
  versionNumber: number
  createdAt: number
  label: string
  filesChanged: string[]
  snapshotPath: string
  messageId: string
  conversationId: string
  projectPath: string
  projectName: string
  /** New multi-screen fields — optional for backward compat with legacy rows */
  screenName?: string
  designName?: string
}

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
  /**
   * Internal flag: message was injected by the bg-task notification system.
   *  Sent to the AI for context but never rendered as a user bubble in the UI.
   */
  isBgNotification?: boolean
  /** Design version attached to this assistant turn (if it edited files). */
  designVersionId?: string | null
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

// ── Message queue ──────────────────────────────────────────────────────────────

export interface QueuedMessage {
  id: string
  text: string
  attachments: Attachment[]
  queuedAt: number
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
  compactionStats?: { lastSavingsPct: number; lastCompactedAt: number }
  pendingQuestions?: PendingBatch | null
  pendingPermissions: PendingToolPermission[]
  /** Per-tab file read registry — no cross-tab dedup interference. */
  readRegistry: FileReadRegistry
  /** Present only on sub-agent tabs (ephemeral, not persisted). */
  subAgent?: SubAgentInfo
  mode?: ChatMode
  /** Per-tab permission mode override. Falls back to global `settings.agent.permissionMode` when undefined. */
  permissionMode?: 'ask' | 'auto' | 'yolo'
  /** Design mode — true for tabs created via "New Design" */
  isDesignTab?: boolean
  /** All design artifacts produced by the agent in this tab (legacy sandbox mode). */
  designs?: DesignArtifact[]
  /** ID of the design currently shown in the canvas. */
  activeDesignId?: string | null
  /** Active file-based design project (new project mode). */
  activeDesignProject?: {
    path: string
    name: string
    type: DesignProjectType
  }
  /** New multi-screen design — one design per tab, many screens */
  activeDesign?: {
    name: string
    path: string
  }
  /** Manifest of screens + connections for activeDesign */
  designManifest?: DesignManifest | null
  /** Currently selected screen (grid shows all, selection is for focused actions) */
  activeScreenName?: string | null
  /** Map of screenName -> list of screens (derived, not persisted) */
  designScreens?: DesignScreenRef[]
  /** Monotonically increasing counter — bumped when project files change on disk. */
  projectVersion?: number
  /** Dev server URL for Vite projects (e.g. http://localhost:5173). */
  previewUrl?: string | undefined
  /** Tracked task ID for the running dev server. */
  devServerTaskId?: string | undefined
  /** FIFO queue of messages waiting for idle. Drained automatically after each turn. */
  messageQueue: QueuedMessage[]
  /** Design version history (persisted via design_versions table). */
  designVersions?: DesignVersionRef[]
  /** Currently previewed version id (null = live). */
  activePreviewVersionId?: string | null
}

export type { Attachment, SubAgentInfo, SubAgentPersonality, TaskItem, ToolPermissionDecision }
export {
  isActiveStatus,
  isBusyStatus,
  isCompactingStatus,
  isErrorStatus,
  isIdleStatus,
  isSleepingStatus,
  isStreamingStatus,
  isStrictStreamingStatus,
  isToolRunningStatus,
  isWaitingPermissionStatus,
  isWaitingQuestionsStatus,
  isWaitingStatus,
  toolCategoryFromName,
} from '@/stores/chat/agent/status'
