import type { LanguageModelUsage, ModelMessage } from 'ai'
import type { WorkspaceSnapshot } from './worktrees'
import type { ToolEvent } from '@/stores/chat/types'
import {
  dbInsertReplayRun,
  dbUpdateReplayRun,
} from '@/db/database'

export interface ReplayCaptureStart {
  id: string
  conversationId: string
  workspace: WorkspaceSnapshot | null
  modelUid: string | null
  requestText: string
  systemPrompt: string
  promptFingerprint: string
  messages: ModelMessage[]
  providerOptions?: Record<string, unknown>
  toolNames: string[]
  createdAt: number
}

export function newReplayId(): string {
  return `replay-${Math.random().toString(36).slice(2, 10)}`
}

export async function startReplayCapture(payload: ReplayCaptureStart): Promise<void> {
  await dbInsertReplayRun({
    id: payload.id,
    conversation_id: payload.conversationId,
    workspace_key: payload.workspace?.projectKey ?? null,
    workspace_path: payload.workspace?.path ?? null,
    model_uid: payload.modelUid,
    prompt_fingerprint: payload.promptFingerprint,
    request_text: payload.requestText,
    system_prompt: payload.systemPrompt,
    messages_json: JSON.stringify(payload.messages),
    provider_options: payload.providerOptions ? JSON.stringify(payload.providerOptions) : null,
    tool_names: JSON.stringify(payload.toolNames),
    tool_trace: JSON.stringify([]),
    status: 'started',
    error_code: null,
    error_message: null,
    created_at: payload.createdAt,
    finished_at: null,
    duration_ms: null,
  })
}

export async function finishReplayCapture(options: {
  id: string
  startedAt: number
  status: 'completed' | 'error' | 'aborted'
  usage?: LanguageModelUsage
  toolEvents?: ToolEvent[]
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const finishedAt = Date.now()
  await dbUpdateReplayRun(options.id, {
    status: options.status,
    usage_json: options.usage ? JSON.stringify(options.usage) : null,
    tool_trace: options.toolEvents ? JSON.stringify(options.toolEvents) : null,
    error_code: options.errorCode ?? null,
    error_message: options.errorMessage ?? null,
    finished_at: finishedAt,
    duration_ms: finishedAt - options.startedAt,
  })
}
