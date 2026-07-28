import type { ChatTab } from '@/stores/chat/core/types'

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function createEmptyDraft() {
  return {
    text: '',
    attachments: [],
  }
}

export function createEmptyEstimatorState() {
  return {
    estimate: null,
    error: '',
    estimating: false,
  }
}

export function newTab(): ChatTab {
  return {
    id: makeId(),
    title: 'New chat',
    messages: [],
    conversationId: null,
    workspacePath: null,
    workspaceMeta: null,
    workspaceLocked: false,
    agentStatus: { type: 'idle' },
    todos: [],
    modelUid: null,
    draft: createEmptyDraft(),
    estimator: createEmptyEstimatorState(),
    isCompacting: false,
    pendingQuestions: null,
    pendingPermissions: [],
    readRegistry: new Map(),
    mode: 'build',
    messageQueue: [],
  }
}

export function newDesignTab(): ChatTab {
  return {
    id: makeId(),
    title: 'New Design',
    messages: [],
    conversationId: null,
    workspacePath: null,
    workspaceMeta: null,
    workspaceLocked: false,
    agentStatus: { type: 'idle' },
    todos: [],
    modelUid: null,
    draft: createEmptyDraft(),
    estimator: createEmptyEstimatorState(),
    isCompacting: false,
    pendingQuestions: null,
    pendingPermissions: [],
    readRegistry: new Map(),
    mode: 'design',
    isDesignTab: true,
    messageQueue: [],
    designs: [],
    activeDesignId: null,
  }
}
