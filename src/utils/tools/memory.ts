import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { tool } from 'ai'
import { z } from 'zod'
import { consolidateMemories, deleteAgentMemory, listAgentMemories, saveAgentMemory, updateAgentMemory } from '@/utils/memory'

export function createMemoryTools(
  enabled: boolean,
  workspace: WorkspaceSnapshot | null,
) {
  if (!enabled)
    return {}

  return {
    remember_memory: tool({
      description: `Save durable memory that should persist across future chats.

Two kinds of memory:
- **preference**: User-stated rules, preferences, habits, or workflow choices. "I prefer single quotes", "Use vitest not jest".
- **note**: Project facts, patterns, conventions, or architectural decisions you discovered. "This repo uses pnpm workspaces", "API keys are in .env.local".

scope="global" for cross-project preferences. scope="project" for repo-specific facts.
Don't store: ephemeral observations, secrets, tokens, or temporary debugging notes.
Use a stable key to allow future updates to the same entry.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory should apply in future chats.'),
        kind: z.enum(['preference', 'note']).describe('preference = user-stated rules/habits. note = project facts you discovered.'),
        title: z.string().min(1).max(80).describe('Short label for the memory.'),
        content: z.string().min(1).max(300).describe('Concise durable memory content.'),
        key: z.string().min(1).max(40).optional().describe('Stable key for future updates. Use a descriptive slug like "lint-semicolons" or "db-migration-strategy".'),
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
    update_memory: tool({
      description: 'Update an existing memory entry by its key. Use this to edit a memory without deleting and re-creating it.',
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory applies.'),
        key: z.string().min(1).max(40).describe('The stable key of the memory to update.'),
        title: z.string().min(1).max(80).optional().describe('New title (omit to keep current).'),
        content: z.string().min(1).max(300).optional().describe('New content (omit to keep current).'),
      }),
      execute: async ({ scope, key, title, content }) => {
        const result = await updateAgentMemory({
          scope,
          workspace,
          key,
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
        })

        if (!result.ok)
          throw new Error(result.reason ?? 'Failed to update memory.')

        return {
          ok: true,
          scope,
          key,
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
    list_memories: tool({
      description: `List all stored memories with their budgets. Use this to review existing entries before creating duplicates, or to check what memories are already saved.

Returns entries grouped by kind, plus budget status showing how close each store is to capacity.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project', 'all']).default('all').describe('Which scope to list. "all" shows both.'),
        kind: z.enum(['preference', 'note', 'all']).default('all').describe('Which kind to list. "all" shows both.'),
      }),
      execute: async ({ scope, kind }) => {
        const result = await listAgentMemories({
          scope,
          kind,
          workspace,
        })

        const lines: string[] = []

        if (result.entries.length === 0) {
          lines.push('No memories stored.')
        }
        else {
          const grouped = new Map<string, typeof result.entries>()
          for (const entry of result.entries) {
            const groupKey = `${entry.scope}/${entry.kind}`
            if (!grouped.has(groupKey))
              grouped.set(groupKey, [])
            grouped.get(groupKey)!.push(entry)
          }

          for (const [group, entries] of grouped) {
            lines.push(`### ${group}`)
            for (const entry of entries) {
              const keyPart = entry.key ? ` [${entry.key}]` : ''
              lines.push(`- ${entry.title}${keyPart}: ${entry.content}`)
            }
          }
        }

        const b = result.budgets
        lines.push('')
        lines.push(`Budget: ${b.preferences.count}/${b.preferences.maxCount} preferences (${b.preferences.chars}/${b.preferences.maxChars} chars) | ${b.notes.count}/${b.notes.maxCount} notes (${b.notes.chars}/${b.notes.maxChars} chars)`)

        return lines.join('\n')
      },
    }),
    consolidate_memories: tool({
      description: `Merge multiple memories of the same kind into a single concise summary. Use this when a memory store is near capacity and you want to free up space.

You MUST call list_memories first to read the current entries, then provide a summary that captures the essential information from all of them.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Which scope to consolidate.'),
        kind: z.enum(['preference', 'note']).describe('Which kind to consolidate.'),
        summary: z.string().min(1).max(400).describe('A concise summary that replaces all existing entries of this scope+kind.'),
      }),
      execute: async ({ scope, kind, summary }) => {
        const result = await consolidateMemories({
          scope,
          workspace,
          kind,
          summary,
        })

        if (!result.ok)
          throw new Error(result.reason ?? 'Failed to consolidate memories.')

        return {
          ok: true,
          scope,
          kind,
          removed: result.removed,
          summary,
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

  if (toolName === 'update_memory') {
    const scope = typeof args.scope === 'string' ? args.scope : 'memory'
    const key = typeof args.key === 'string' ? args.key : ''
    return `Updated ${scope} memory: ${key}`
  }

  if (toolName === 'forget_memory') {
    const scope = typeof args.scope === 'string' ? args.scope : 'memory'
    const key = typeof args.key === 'string' ? args.key : ''
    return `Deleted ${scope} memory: ${key}`
  }

  if (toolName === 'list_memories')
    return 'Listed memories'

  if (toolName === 'consolidate_memories') {
    const scope = typeof args.scope === 'string' ? args.scope : 'memory'
    const kind = typeof args.kind === 'string' ? args.kind : 'memory'
    return `Consolidated ${scope} ${kind} memories`
  }

  return `Called ${toolName}`
}
