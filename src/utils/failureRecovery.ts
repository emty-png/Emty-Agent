import {
  dbInsertFailureEvent,
  dbListFailureEvents,
  dbResolveFailureEvents,
} from '@/db/database'

export type FailureCategory
  = | 'workspace_missing'
    | 'tool_denied'
    | 'tool_failure'
    | 'model_init'
    | 'stream_aborted'
    | 'stream_error'
    | 'unknown'

export interface FailureDescriptor {
  category: FailureCategory
  summary: string
  recoveryHint: string
  severity: 'warning' | 'error'
}

export function classifyFailure(error: unknown): FailureDescriptor {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()

  if (lowered.includes('no longer available on disk') || lowered.includes('workspace is no longer')) {
    return {
      category: 'workspace_missing',
      summary: message,
      recoveryHint: 'Restore the worktree on disk or start a new chat in an available workspace.',
      severity: 'error',
    }
  }

  if (lowered.includes('denied by the user')) {
    return {
      category: 'tool_denied',
      summary: message,
      recoveryHint: 'Approve the required tool call or switch permission mode before retrying.',
      severity: 'warning',
    }
  }

  if (lowered.includes('failed to initialise model') || lowered.includes('provider')) {
    return {
      category: 'model_init',
      summary: message,
      recoveryHint: 'Check the selected model and provider credentials, then retry the task.',
      severity: 'error',
    }
  }

  if (lowered.includes('aborted')) {
    return {
      category: 'stream_aborted',
      summary: message,
      recoveryHint: 'Retry the task if you still want the agent to continue from the same workspace.',
      severity: 'warning',
    }
  }

  if (lowered.includes('tool') || lowered.includes('command')) {
    return {
      category: 'tool_failure',
      summary: message,
      recoveryHint: 'Inspect the last tool result, correct the environment or command, and retry from the same chat.',
      severity: 'error',
    }
  }

  if (message.trim()) {
    return {
      category: 'stream_error',
      summary: message,
      recoveryHint: 'Retry the request. If the same failure repeats, inspect the workspace state and latest tool outputs.',
      severity: 'error',
    }
  }

  return {
    category: 'unknown',
    summary: 'Unknown failure',
    recoveryHint: 'Retry after validating the workspace, model selection, and tool permissions.',
    severity: 'error',
  }
}

export async function recordFailureEvent(options: {
  replayId: string | null
  conversationId: string | null
  category: FailureCategory
  summary: string
  recoveryHint: string
  severity: 'warning' | 'error'
  details?: string | null
}): Promise<void> {
  if (!options.conversationId)
    return

  await dbInsertFailureEvent({
    id: `failure-${Math.random().toString(36).slice(2, 10)}`,
    replay_id: options.replayId,
    conversation_id: options.conversationId,
    category: options.category,
    severity: options.severity,
    message: options.summary,
    recovery_hint: options.recoveryHint,
    details: options.details ?? null,
    created_at: Date.now(),
    resolved_at: null,
  })
}

export async function buildRecoveryPromptContext(conversationId: string | null): Promise<string> {
  if (!conversationId)
    return ''

  const failures = await dbListFailureEvents(conversationId, 1)
  const failure = failures[0]
  if (!failure || failure.resolved_at)
    return ''

  return [
    '## Recent Failure Context',
    `Last failure: ${failure.message}`,
    `Recovery hint: ${failure.recovery_hint}`,
  ].join('\n')
}

export async function resolveConversationFailures(conversationId: string | null): Promise<void> {
  if (!conversationId)
    return
  await dbResolveFailureEvents(conversationId)
}
