import type { FileReadRegistry } from './shared'
import { stat } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { hasBinaryExtension, safePath } from './allowedPaths'
import { ConcurrencyLimitError, FileLockManager } from './fileLock'
import {
  readTextSnapshot,
  sha256Text,
  updateReadRegistry,
} from './shared'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LINE_LIMIT = 300
const MAX_LINE_LIMIT = 2000

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format lines with cat -n style line numbers.
 * @param lines      Collected content lines.
 * @param startLine  1-based line number of the first element in `lines`.
 */
function formatNumberedLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)}\t${line}`)
    .join('\n')
}

interface FileRange {
  numberedContent: string
  rawContent: string
  totalLines: number
  returnedLines: number
  truncated: boolean
  sizeBytes: number
  mtimeMs: number | null
}

/**
 * Read a slice of a file, respecting the line limit.
 * Single-read: loads the full file once and splits in memory.
 */
async function readFileRange(
  absolutePath: string,
  start: number,
  limit: number,
): Promise<FileRange> {
  const snapshot = await readTextSnapshot(absolutePath)

  // Split once in memory — avoids a second streaming read
  const allLines = snapshot.content.length === 0 ? [] : snapshot.content.split('\n')
  const totalLines = allLines.length
  const collected = allLines.slice(start, start + limit)
  const returnedLines = collected.length
  const truncated = totalLines > start + returnedLines

  return {
    numberedContent: formatNumberedLines(collected, start + 1),
    rawContent: snapshot.content,
    totalLines,
    returnedLines,
    truncated,
    sizeBytes: snapshot.sizeBytes,
    mtimeMs: snapshot.mtimeMs,
  }
}

/**
 * Process a single file path: resolve, validate, dedup, read, format.
 */
async function processSingleFile(
  filePath: string,
  projectPath: string,
  start: number,
  limit: number,
  registry: FileReadRegistry,
  lockManager: FileLockManager,
): Promise<string> {
  // ── Path security (also resolves to absolute) ──────────────────────────
  let fullPath: string
  try {
    fullPath = await safePath(projectPath, filePath, { kind: 'read' })
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // safePath already returns the sensitive-read hint when applicable
    return msg.startsWith('Error:') ? msg : `Error: ${msg}`
  }

  // ── File existence & type check ───────────────────────────────────────────
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(fullPath)
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `Error: Cannot access ${filePath}: ${msg}`
  }

  if (!info.isFile) {
    return `Error: ${filePath} is a directory, not a file. Please use the appropriate list_dir tool.`
  }

  if (hasBinaryExtension(filePath)) {
    return 'Error: Cannot read binary files. File must be plain text.'
  }

  // ── Read + hash + registry — shared lock (parallel reads allowed, global 30 limit) ─
  try {
    return await lockManager.withReadLock(fullPath, async () => {
      let range: FileRange
      try {
        range = await readFileRange(fullPath, start, limit)
      }
      catch (e) {
        return `Error reading ${filePath}: ${e instanceof Error ? e.message : String(e)}`
      }

      const hash = await sha256Text(range.rawContent)
      const isComplete = !range.truncated && range.totalLines <= limit
      const oneBasedOffset = start + 1

      // Registry update — always record; no deduplication stub
      const entry = {
        hash,
        complete: isComplete,
        sizeBytes: range.sizeBytes,
        mtimeMs: range.mtimeMs,
        offset: oneBasedOffset,
        limit,
      }
      updateReadRegistry(registry, fullPath, entry)

      // Format output
      let output = range.numberedContent

      if (range.truncated) {
        const firstLine = start + 1
        const lastLine = start + range.returnedLines
        output += `\n\n(File truncated. Showing lines ${firstLine}\u2013${lastLine} of ${range.totalLines}. Use offset and limit to read more.)`
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

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createReadFilesTool(
  projectPath: string,
  registry: FileReadRegistry,
  lockManager: FileLockManager = new FileLockManager(),
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.read_files,

    inputSchema: z.object({
      file_paths: z
        .array(z.string())
        .min(1)
        .describe('One or more file paths to read (absolute or relative to the project root).'),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'The 1-based line number to start reading from. Omit to start from line 1. Only needed when paginating through a truncated file.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LINE_LIMIT)
        .optional()
        .describe(
          `Max lines to return per file. Default: ${DEFAULT_LINE_LIMIT}, max: ${MAX_LINE_LIMIT}. Omit unless you need a specific range.`,
        ),
    }),

    execute: async ({ file_paths, offset, limit }) => {
      const start = offset !== undefined ? offset - 1 : 0
      const appliedLimit = Math.min(limit ?? DEFAULT_LINE_LIMIT, MAX_LINE_LIMIT)

      // Single file: no header, just content
      if (file_paths.length === 1) {
        return await processSingleFile(file_paths[0]!, projectPath, start, appliedLimit, registry, lockManager)
      }

      // Multiple files: each prefixed with === path === header
      const results: string[] = []
      for (const filePath of file_paths) {
        const content = await processSingleFile(filePath, projectPath, start, appliedLimit, registry, lockManager)
        results.push(`=== ${filePath} ===\n${content}`)
      }
      return results.join('\n\n')
    },
  })
}
