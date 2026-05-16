import type { Attachment } from './attachment-types'
import type { ChatMode } from '@/utils/ai'
import type { ChatPromptEstimate } from '@/utils/chatEstimate'
import type { ToolPermissionDecision } from '@/utils/tools/permissions'
import type { PendingBatch } from '@/utils/tools/questions'
import type { SubAgentInfo, SubAgentPersonality } from '@/utils/tools/subagent'
import type { TodoItem } from '@/utils/tools/todos'
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
  isStreaming: boolean
  todos: TodoItem[]
  modelUid?: string | null
  draft: ChatDraftState
  estimator: ChatEstimatorState
  pendingQuestions?: PendingBatch | null
  pendingPermissions: PendingToolPermission[]
  /**
   * Present only on sub-agent tabs. Contains personality, mission, parent tab ID,
   * and live status. Sub-agent tabs never persist to the database — they are
   * ephemeral and reset when the app restarts.
   */
  subAgent?: SubAgentInfo
}

export type { Attachment, ChatMode, SubAgentInfo, SubAgentPersonality, TodoItem, ToolPermissionDecision }
