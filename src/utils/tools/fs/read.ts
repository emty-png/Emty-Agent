import { readTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { safePath } from './shared'

// ── constants ─────────────────────────────────────────────────────────────────

/**
 * Default maximum lines read per file when the caller does not specify a limit.
 * Guards against accidentally loading large generated files into context.
 * The agent can always pass an explicit `limit` to override this.
 */
const DEFAULT_LINE_LIMIT = 500

// ── tool ──────────────────────────────────────────────────────────────────────

export function createReadFilesTool(projectPath: string) {
  return tool({
    description: `Read the contents of one or more project files.
Batch multiple paths in a single call. Use offset/limit for large files (0-indexed lines).
Always read files before making claims about their contents.

IMPORTANT: By default only the first ${DEFAULT_LINE_LIMIT} lines of each file are returned to protect
context size. If the file is larger and you need more, use offset/limit to page through it.
A "truncated" flag in the result tells you when the default cap was applied.`,
    inputSchema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .describe('File paths relative to project root.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('First line to read, 0-indexed. Default: 0.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          `Max lines to read per file. Default: ${DEFAULT_LINE_LIMIT}. `
          + 'Increase only when you know you need more — large reads consume context.',
        ),
    }),
    execute: async ({ paths, offset, limit }) => {
      const start = offset ?? 0
      // When the caller omits limit we apply the default cap and report it.
      const appliedLimit = limit ?? DEFAULT_LINE_LIMIT
      const usingDefaultLimit = limit === undefined

      const results: string[] = []
      const errors: string[] = []

      for (const inputPath of paths) {
        let fullPath: string
        try {
          fullPath = await safePath(projectPath, inputPath)
        }
        catch (e) {
          errors.push(`${inputPath}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }

        let raw: string
        try {
          raw = await readTextFile(fullPath)
        }
        catch (e) {
          errors.push(`${inputPath}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }

        const lines = raw.split('\n')
        const totalLines = lines.length
        const sliced = lines.slice(start, start + appliedLimit)
        const readCount = sliced.length

        const rangeEnd = start + readCount - 1
        const truncated = usingDefaultLimit && totalLines > start + appliedLimit

        // Build a concise header so the agent knows exactly what it received.
        const rangeLabel = `lines ${start}–${rangeEnd} of ${totalLines}`
        const truncatedNote = truncated
          ? ` [TRUNCATED — file has ${totalLines} lines; use offset/limit to read more]`
          : ''

        results.push(
          `File: ${inputPath} (${rangeLabel})${truncatedNote}\n${'─'.repeat(60)}\n${sliced.join('\n')}`,
        )
      }

      return {
        files: results,
        ...(errors.length > 0 ? { errors } : {}),
      }
    },
  })
}

// ── display label ─────────────────────────────────────────────────────────────

/**
 * Produces human-readable badge labels for the read_files tool.
 *
 * Examples:
 *   read_files({ paths: ['index.ts'] })
 *     → "Read index.ts"
 *
 *   read_files({ paths: ['index.ts'], offset: 250, limit: 50 })
 *     → "Read index.ts #250–299"
 *
 *   read_files({ paths: ['auth.ts', 'session.ts'], offset: 0, limit: 100 })
 *     → "Read auth.ts #0–99, session.ts #0–99"
 *
 *   read_files({ paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] })
 *     → "Read 4 files"
 */
export function readFilesToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'read_files')
    return `Called ${toolName}`

  const paths = args.paths as string[] | undefined
  if (!paths?.length)
    return 'Read files'

  const offset = typeof args.offset === 'number' ? args.offset : 0
  const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LINE_LIMIT
  const hasExplicitRange = args.offset !== undefined || args.limit !== undefined

  /** Strip leading path segments, keep just the filename. */
  function basename(p: string): string {
    return p.split(/[/\\]/).pop() ?? p
  }

  /** Format a single file entry, with optional range annotation. */
  function formatEntry(p: string): string {
    const name = basename(p)
    if (!hasExplicitRange)
      return name
    const rangeEnd = offset + limit - 1
    return `${name} #${offset}–${rangeEnd}`
  }

  // Collapse many files without a range into a count badge to keep it tidy.
  if (paths.length > 3 && !hasExplicitRange)
    return `Read ${paths.length} files`

  // Up to 3 files — list them individually.
  const MAX_INLINE = 3
  const shown = paths.slice(0, MAX_INLINE).map(formatEntry).join(', ')
  const overflow = paths.length - MAX_INLINE
  const suffix = overflow > 0 ? ` +${overflow} more` : ''

  return `Read ${shown}${suffix}`
}
