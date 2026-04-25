import type { ChatMode } from '@/utils/ai'
import type { SubAgentInfo, SubAgentPersonality } from '@/utils/tools/subagent'
import type { TodoItem } from '@/utils/tools/todos'

export interface ToolEvent {
  id: string
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  toolName: string
  startedAt: number
  finishedAt?: number
  /**
   * Arbitrary key-value metadata for tool-specific badge data.
   * spawn_subagent stores { subAgentTabId: string } here so the badge can
   * navigate to the sub-agent tab on click.
   */
  metadata?: Record<string, unknown>
}

export type MessagePart
  = | { type: 'text'; text: string }
    | { type: 'tool'; toolCallId: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolEvents?: ToolEvent[]
  parts?: MessagePart[]
  error?: string
}

export interface ChatTab {
  id: string
  title: string
  messages: Message[]
  conversationId: string | null
  isStreaming: boolean
  todos: TodoItem[]
  /**
   * Present only on sub-agent tabs. Contains personality, mission, parent tab ID,
   * and live status. Sub-agent tabs never persist to the database — they are
   * ephemeral and reset when the app restarts.
   */
  subAgent?: SubAgentInfo
}

export type { ChatMode, SubAgentInfo, SubAgentPersonality, TodoItem }
