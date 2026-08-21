import { homeDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { createUnifiedDiff, diffLineStats, ensureDir, normalizeLineEndings } from './fs/shared'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

export interface PlanCreatedEvent {
  filepath: string
  conversationId: string
  planName: string
}

export interface CreatePlanToolsOptions {
  conversationId: string
  onPlanCreated?: (event: PlanCreatedEvent) => void
}

const DEFAULT_PLAN_NAME = 'plan.md'

function safePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .split('')
    .map(char => char.charCodeAt(0) < 32 ? '-' : char)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(/-+/g, '-')

  return sanitized || fallback
}

function normalizePlanFilename(planName?: string): string {
  const rawName = safePathSegment(planName || DEFAULT_PLAN_NAME, DEFAULT_PLAN_NAME)
  return rawName.toLowerCase().endsWith('.md') ? rawName : `${rawName}.md`
}

export function planToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  if (name !== 'plan')
    return `Called ${name}`

  const planName = typeof args.planName === 'string' && args.planName.trim()
    ? normalizePlanFilename(args.planName)
    : DEFAULT_PLAN_NAME

  return `Plan ${planName}`
}

export function createPlanTools(options: CreatePlanToolsOptions) {
  const conversationId = safePathSegment(options.conversationId, 'unknown-conversation')

  return {
    plan: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.plan,
      inputSchema: z.object({
        planContent: z.string().min(1).describe('The complete markdown content of the plan. Include scope, approach, validation, risks, and acceptance criteria.'),
        planName: z.string().optional().describe('Optional markdown filename for the plan. Defaults to plan.md. Path separators are not allowed.'),
      }),
      execute: async ({ planContent, planName }) => {
        try {
          const home = await homeDir()
          const plansDir = await join(home, '.emty', 'plans', conversationId)
          await ensureDir(plansDir)

          const filename = normalizePlanFilename(planName)
          const filepath = await join(plansDir, filename)
          const normalizedContent = `${normalizeLineEndings(planContent).trimEnd()}\n`

          let previousContent = ''
          let operation: 'create' | 'replace' = 'create'
          if (await exists(filepath)) {
            previousContent = normalizeLineEndings(await readTextFile(filepath))
            operation = 'replace'
          }

          const { added, removed } = diffLineStats(previousContent, normalizedContent)
          const diff = createUnifiedDiff(filename, previousContent, normalizedContent)

          await writeTextFile(filepath, normalizedContent)

          options.onPlanCreated?.({ filepath, conversationId, planName: filename })

          return {
            message: `Plan ${operation === 'create' ? 'created' : 'updated'} at ${filepath}. Waiting for user approval.`,
            file: filepath,
            conversationId,
            planName: filename,
            operation,
            added,
            removed,
            diff,
          }
        }
        catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          return `Error: Failed to write plan: ${msg}`
        }
      },
    }),
  }
}
