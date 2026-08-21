import type { WorkspaceSnapshot } from '@/utils/worktrees'
import { tool } from 'ai'
import { z } from 'zod'
import { consolidateMemories, deleteAgentMemory, listAgentMemories, saveAgentMemory, updateAgentMemory } from '@/utils/memory'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

export function createMemoryTools(
  enabled: boolean,
  workspace: WorkspaceSnapshot | null,
) {
  if (!enabled)
    return {}

  return {
    remember_memory: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.remember_memory,
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
      description: DEFAULT_TOOL_DESCRIPTIONS.update_memory,
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
      description: DEFAULT_TOOL_DESCRIPTIONS.forget_memory,
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
      description: DEFAULT_TOOL_DESCRIPTIONS.list_memories,
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
      description: DEFAULT_TOOL_DESCRIPTIONS.consolidate_memories,
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
