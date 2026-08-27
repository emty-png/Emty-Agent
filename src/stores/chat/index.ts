/**
 * Barrel for chat store - CLEAN public API entry point.
 * Keep `src/stores/chat.ts` as implementation; this barrel is what OSS consumers import.
 *
 * Usage:
 *   import { useChatStore } from '@/stores/chat'
 *   import { useAgent, getAgentStatus } from '@/stores/chat' // via re-export
 *   import { STATUS_IDLE, isStreamingStatus } from '@/stores/chat'
 */
// Pinia store (composition API) - writable state, use via useAgent facade where possible
export { useChatStore } from '../chat'
// Lifecycle bus + per-tab composable + centralized setter
export {
  agentBus,
  emitStatusChange,
  getAgentStatus,
  setAgentStatus,
  setAgentStatusForTab,
  useAgentLifecycle,
} from './agent/lifecycle'

// Agent status - sentinels, predicates, type guards, category helpers
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
  STATUS_COMPACTING,
  STATUS_IDLE,
  STATUS_INITIALIZING,
  STATUS_STREAMING,
  STATUS_WAITING_QUESTIONS,
  statusCompacting,
  statusError,
  statusInitializing,
  statusSleeping,
  statusToolRunning,
  statusWaitingPermission,
  statusWaitingQuestions,
  toolCategoryFromName,
} from './agent/status'

export type * from './core/types'
