import type { Attachment } from './attachment-types'
import type { ChatMode } from '@/utils/ai'
import type { ChatPromptEstimate } from '@/utils/chatEstimate'
import type { FileReadRegistry } from '@/utils/tools/fs/shared'
import type { ToolPermissionDecision } from '@/utils/tools/permissions'
import type { PendingBatch } from '@/utils/tools/questions'
import type { SubAgentInfo, SubAgentPersonality } from '@/utils/tools/subagent'
import type { TaskItem } from '@/utils/tools/todos'
import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { UsageStats } from '@/utils/contextCaching'

export interface ToolEvent {
  id: string
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  toolName: string
  startedAt: number
  finishedAt?: number
  /**
   * Parsed input arguments the model sent to the tool.
   * Persisted so subsequent turns can reconstruct the full
   * tool-call → tool-result message sequence for the AI SDK.
   */
  args?: Record<string, unknown>
  /**
   * The value returned by the tool's execute() function.
   * Persisted so subsequent turns include the tool output in context.
   */
  result?: unknown
  /**
   * Incremental stdout/stderr captured while command-like tools are still
   * running. This is UI review data only; model replay uses `result`.
   */
  liveOutput?: {
    stdout?: string
    stderr?: string
  }
  /**
   * Arbitrary key-value metadata for tool-specific badge data.
   * spawn_subagent stores { subAgentTabId: string } here so the badge can
   * navigate to the sub-agent tab on click.
   */
  metadata?: Record<string, unknown>
}

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
  /** User-attached files/images (only present on user messages). */
  attachments?: Attachment[]
  /** Tracks which skill generated this message (hidden from user display). */
  skillId?: string
}

export interface ChatDraftState {
  text: string
  attachments: Attachment[]
}

export interface ChatEstimatorState {
  estimate: ChatPromptEstimate | null
  error: string
  estimating: boolean
}

export interface PendingToolPermission {
  requestId: string
  toolName: string
  toolLabel: string
  actionTitle: string
  actionDetails: string[]
}

export interface ChatTab {
  id: string
  title: string
  messages: Message[]
  conversationId: string | null
  workspacePath: string | null
  workspaceMeta?: WorkspaceSnapshot | null
  workspaceLocked: boolean
  isStreaming: boolean
  todos: TaskItem[]
  modelUid?: string | null
  draft: ChatDraftState
  estimator: ChatEstimatorState
  isCompacting?: boolean
  pendingQuestions?: PendingBatch | null
  pendingPermissions: PendingToolPermission[]
  /**
   * Per-tab file read registry. Tracks which files have been read (hash, mtime,
   * completeness) so edit/write tools can verify freshness. Each tab (and
   * sub-agent) gets its own registry — no cross-tab dedup interference.
   */
  readRegistry: FileReadRegistry
  /**
   * Present only on sub-agent tabs. Contains personality, mission, parent tab ID,
   * and live status. Sub-agent tabs never persist to the database — they are
   * ephemeral and reset when the app restarts.
   */
  subAgent?: SubAgentInfo
  mode?: ChatMode
}

export type { Attachment, ChatMode, SubAgentInfo, SubAgentPersonality, TaskItem, ToolPermissionDecision }
