import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { tool } from 'ai'
import { z } from 'zod'
import { deleteAgentMemory, saveAgentMemory } from '@/utils/memory'

export function createMemoryTools(
  enabled: boolean,
  workspace: WorkspaceSnapshot | null,
) {
  if (!enabled)
    return {}

  return {
    remember_memory: tool({
      description: `Save durable memory that should persist across future chats. Use only for stable preferences, workflow rules, or project conventions likely to matter again.

scope="global" for cross-project preferences. scope="project" for repo-specific facts.
Don't store: ephemeral observations, secrets, tokens, or temporary debugging notes.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory should apply in future chats.'),
        kind: z.enum(['preference', 'note']).describe('Use preference for stable rules. Use note for project facts that are not user preferences.'),
        title: z.string().min(1).max(80).describe('Short label for the memory.'),
        content: z.string().min(1).max(300).describe('Concise durable memory content.'),
        key: z.string().min(1).max(40).optional().describe('Optional stable key for replacing an earlier memory entry.'),
      }),
      execute: async ({ scope, kind, title, content, key }) => {
        const result = await saveAgentMemory({
          scope,
          workspace,
          kind,
          title,
          content,
          ...(key ? { key } : {}),
        })

        if (!result.ok)
          throw new Error(result.reason ?? 'Failed to save memory.')

        return {
          ok: true,
          scope,
          kind,
          title,
        }
      },
    }),
    forget_memory: tool({
      description: 'Delete a previously saved memory by its key. Use this to remove outdated or incorrect facts or preferences.',
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory applies.'),
        key: z.string().min(1).max(40).describe('The stable key of the memory to delete.'),
      }),
      execute: async ({ scope, key }) => {
        const result = await deleteAgentMemory({
          scope,
          workspace,
          key,
        })

        if (!result.ok)
          throw new Error(result.reason ?? 'Failed to delete memory.')

        return {
          ok: true,
          scope,
          key,
        }
      },
    }),
  }
}

export function memoryToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === 'remember_memory') {
    const scope = typeof args.scope === 'string' ? args.scope : 'memory'
    const title = typeof args.title === 'string' ? args.title : 'memory'
    return `Saved ${scope} memory: ${title}`
  }

  if (toolName === 'forget_memory') {
    const scope = typeof args.scope === 'string' ? args.scope : 'memory'
    const key = typeof args.key === 'string' ? args.key : ''
    return `Deleted ${scope} memory: ${key}`
  }

  return `Called ${toolName}`
}
