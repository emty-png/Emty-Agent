import type { ChatTab } from '@/stores/chat/core/types'
import type { WorkspaceSnapshot } from '@/utils/worktrees'

export function resolveTabWorkspacePath(
  tab: Pick<ChatTab, 'workspacePath' | 'workspaceLocked'> | null | undefined,
  fallbackProjectPath: string | null,
): string | null {
  if (!tab)
    return fallbackProjectPath
  return tab.workspaceLocked
    ? tab.workspacePath ?? fallbackProjectPath
    : fallbackProjectPath ?? tab.workspacePath
}

export function resolveTabWorkspaceMeta(
  tab: Pick<ChatTab, 'workspaceMeta'> | null | undefined,
): WorkspaceSnapshot | null {
  return tab?.workspaceMeta ?? null
}

export function canChangeWorkspace(tab: Pick<ChatTab, 'messages' | 'workspaceLocked' | 'subAgent'>): boolean {
  return !tab.subAgent && !tab.workspaceLocked && tab.messages.length === 0
}
