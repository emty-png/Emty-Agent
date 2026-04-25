import type { ChatTab, Message } from './types'

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function newTab(): ChatTab {
  return {
    id: makeId(),
    title: 'New chat',
    messages: [],
    conversationId: null,
    isStreaming: false,
    todos: [],
  }
}

export function toApiMessages(
  messages: Message[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter(m => m.content.trim() && !m.error)
    .map(m => ({ role: m.role, content: m.content.trim() }))
}
