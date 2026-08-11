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
      description: `Save a durable memory that MUST persist across future chats and sessions.

CRITICAL RULES:
1. ALWAYS call list_memories first to ensure you are not creating a duplicate.
2. NEVER store secrets, API keys, passwords, PII, or temporary debugging notes.
3. ALWAYS provide a stable, descriptive key in slug format (e.g., "prefer-single-quotes", "db-schema-users").

TWO KINDS OF MEMORY:
- "preference": User-stated rules, habits, or workflow choices (e.g., "Always use pnpm", "Prefer functional components"). Usually "global" scope.
- "note": Project facts, patterns, conventions, or architectural decisions discovered in the codebase (e.g., "Auth uses NextAuth", "Tests are in __tests__"). Usually "project" scope.

SCOPES:
- "global": Applies to all projects and workspaces for this user.
- "project": Applies only to the current repository/workspace.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory should apply in future chats.'),
        kind: z.enum(['preference', 'note']).describe('preference = user-stated rules/habits. note = project facts you discovered.'),
        title: z.string().min(1).max(80).describe('Short, clear label for the memory.'),
        content: z.string().min(1).max(400).describe('Concise, durable memory content. Do not include secrets or PII.'),
        key: z
          .string()
          .min(3)
          .max(40)
          .regex(/^[a-z0-9-]+$/, 'Must be a lowercase slug with hyphens (e.g., "prefer-vitest").')
          .describe('Stable slug key for future updates. Required for maintainability.'),
      }),
      execute: async ({ scope, kind, title, content, key }) => {
        const result = await saveAgentMemory({
          scope,
          workspace,
          kind,
          title,
          content,
          key,
        })

        if (!result.ok)
          throw new Error(result.reason ?? 'Failed to save memory.')

        return {
          ok: true,
          scope,
          kind,
          title,
          key,
        }
      },
    }),

    update_memory: tool({
      description: `Update an existing memory entry by its exact key.

ALWAYS call list_memories first to retrieve the exact key and current content.
Use this to refine, correct, or expand upon an existing memory without deleting and re-creating it.
If the memory is completely obsolete, use forget_memory instead.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory applies.'),
        key: z.string().min(3).max(40).describe('The exact stable key of the memory to update (from list_memories).'),
        title: z.string().min(1).max(80).optional().describe('New title (omit to keep current).'),
        content: z.string().min(1).max(400).optional().describe('New content (omit to keep current).'),
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
      description: `Permanently delete a previously saved memory by its exact key.

ALWAYS call list_memories first to confirm the key exists and to ensure you are deleting the correct entry.
Use this when a user explicitly retracts a preference, or when a project fact becomes completely obsolete and incorrect.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Where this memory applies.'),
        key: z.string().min(3).max(40).describe('The exact stable key of the memory to delete (from list_memories).'),
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
      description: `List all stored memories, grouped by scope and kind, along with storage budget status.

ALWAYS call this tool BEFORE using remember_memory, update_memory, forget_memory, or consolidate_memories.
You must verify existing entries to prevent duplicates and to obtain the exact keys required for updates or deletions.
This operation is cheap and does not consume significant context.`,
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
      description: `Merge and compress multiple memories of the same scope and kind into a single concise summary.

WARNING: This operation DELETES all existing memories of the specified scope and kind, and replaces them with your summary.
ONLY use this when list_memories shows the budget is near capacity (e.g., >80% full) or when there is massive redundancy.
You MUST call list_memories first, read all the entries carefully, and ensure your summary captures ALL essential information without losing critical context.`,
      inputSchema: z.object({
        scope: z.enum(['global', 'project']).describe('Which scope to consolidate.'),
        kind: z.enum(['preference', 'note']).describe('Which kind to consolidate.'),
        summary: z.string().min(10).max(800).describe('A comprehensive but concise summary that replaces all existing entries of this scope+kind. Do not lose critical details.'),
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
