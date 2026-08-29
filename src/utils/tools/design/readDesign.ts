import type { FileReadRegistry } from '../fs/shared'
import type { ActiveDesignGetter } from './types'
import { join } from '@tauri-apps/api/path'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { ConcurrencyLimitError, FileLockManager } from '../fs/fileLock'
import { readTextSnapshot, updateReadRegistry } from '../fs/shared'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { DESIGN_FILES, NAME_PATTERN } from './constants'

const read_design_DEFAULT_LIMIT = 300
const read_design_MAX_LIMIT = 2000

export function createReadDesignTool(getActiveDesign?: ActiveDesignGetter) {
  const registry: FileReadRegistry = new Map()
  const lockManager = new FileLockManager()

  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.read_design,
    inputSchema: zodSchema(z.object({
      // Single-screen shorthand
      screen: z.string().regex(NAME_PATTERN).optional().describe('Screen name to read from (required if not using reads)'),
      file_paths: z.array(z.enum(['index.html', 'styles.css', 'script.js'])).min(1).optional().describe('Design files to read from the single screen specified by screen'),
      // Batch mode
      reads: z.array(z.object({
        screen: z.string().regex(NAME_PATTERN).describe('Screen name'),
        file_paths: z.array(z.enum(['index.html', 'styles.css', 'script.js'])).min(1).describe('Files to read from this screen'),
      })).min(1).max(20).optional().describe('Batch read across multiple screens (preferred for multi-screen)'),
      offset: z.number().int().min(1).optional().describe('The 1-based line number to start reading from. Omit to start from line 1. Only needed when paginating through a truncated file.'),
      limit: z.number().int().min(1).max(read_design_MAX_LIMIT).optional().describe(`Max lines to return per file. Default: ${read_design_DEFAULT_LIMIT}, max: ${read_design_MAX_LIMIT}. Omit unless you need a specific range.`),
    }).refine(v => (v.reads && v.reads.length > 0) || (v.screen && v.file_paths && v.file_paths.length > 0), { message: 'Provide either reads:[{screen,file_paths}] for batch, or screen+file_paths for single screen' })),
    execute: async ({ screen, file_paths, reads, offset, limit }) => {
      const normalized: Array<{ screen: string; file_paths: Array<(typeof DESIGN_FILES)[number]> }> = []
      if (reads && reads.length > 0) {
        for (const r of reads)
          normalized.push({ screen: r.screen, file_paths: r.file_paths as typeof normalized[number]['file_paths'] })
      }
      else if (screen && file_paths) {
        normalized.push({ screen, file_paths: file_paths as typeof normalized[number]['file_paths'] })
      }
      console.warn(`[read_design] ── START ── batches=${normalized.length}`)
      try {
        const design = getActiveDesign?.()
        if (!design) {
          const msg = 'No active design. Call create_screen first.'
          console.warn(`[read_design] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const start = offset !== undefined ? offset - 1 : 0
        const appliedLimit = Math.min(limit ?? read_design_DEFAULT_LIMIT, read_design_MAX_LIMIT)

        async function readOne(screenName: string, filePath: string): Promise<string> {
          const fullPath = await join(design!.path, screenName, filePath)

          try {
            return await lockManager.withReadLock(fullPath, async () => {
              let snapshot: Awaited<ReturnType<typeof readTextSnapshot>>
              try {
                snapshot = await readTextSnapshot(fullPath)
              }
              catch (e) {
                const error = e instanceof Error ? e.message : String(e)
                return `Error: Cannot read ${screenName}/${filePath}: ${error}`
              }

              const allLines = snapshot.content.length === 0 ? [] : snapshot.content.split('\n')
              const totalLines = allLines.length
              const collected = allLines.slice(start, start + appliedLimit)
              const truncated = totalLines > start + collected.length
              const oneBasedOffset = start + 1

              // Registry update — always record; no deduplication stub
              updateReadRegistry(registry, fullPath, {
                hash: snapshot.hash,
                complete: !truncated,
                sizeBytes: snapshot.sizeBytes,
                mtimeMs: snapshot.mtimeMs,
                offset: oneBasedOffset,
                limit: appliedLimit,
              })

              let output = collected
                .map((line, i) => `${String(start + i + 1).padStart(String(start + collected.length).length)}\t${line}`)
                .join('\n')

              if (truncated) {
                output += `\n\n(File truncated. Showing lines ${start + 1}\u2013${start + collected.length} of ${totalLines}. Use offset and limit to read more.)`
              }

              return output
            })
          }
          catch (e) {
            if (e instanceof ConcurrencyLimitError)
              return `Error: ${e.message}. Too many parallel tool calls — wait for some to finish and retry.`
            throw e
          }
        }

        if (normalized.length === 1 && normalized[0]!.file_paths.length === 1) {
          const r = normalized[0]!
          const content = await readOne(r.screen, r.file_paths[0]!)
          console.warn(`[read_design] ✓ Read ${r.screen}/${r.file_paths[0]}`)
          return { ok: true, screen: r.screen, file: r.file_paths[0], content }
        }

        const parts: string[] = []
        for (const batch of normalized) {
          for (const filePath of batch.file_paths)
            parts.push(`=== ${batch.screen}/${filePath} ===\n${await readOne(batch.screen, filePath)}`)
        }

        console.warn(`[read_design] ✓ Read ${parts.length} files across ${normalized.length} screens`)
        return { ok: true, reads: normalized, content: parts.join('\n\n') }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[read_design] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `read_design failed: ${detail}` }
      }
    },
  })
}
