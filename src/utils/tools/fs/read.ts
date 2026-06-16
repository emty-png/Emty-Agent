import { stat } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { hasBinaryExtension, isPathAllowed, resolveToAbsolutePath } from './allowedPaths'
import {
  FileLockManager,
  FileReadRegistry,
  readTextSnapshot,
  sha256Text,
  updateReadRegistry,
} from './shared'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LINE_LIMIT = 300
const MAX_LINE_LIMIT = 2000

const FILE_UNCHANGED_STUB
  = 'File unchanged since last read. The content from the earlier read in this conversation is still current — refer to that instead of re-reading.'

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
  // ── Path resolution ──────────────────────────────────────────────────────
  let fullPath: string
  try {
    fullPath = await resolveToAbsolutePath(projectPath, filePath)
  }
  catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ── Path security ────────────────────────────────────────────────────────
  if (!await isPathAllowed(fullPath, projectPath, 'read')) {
    return 'Error: Path traversal detected. Access denied to files outside the workspace or to sensitive files.'
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

  // ── Read + hash + registry (serialized per file) ──────────────────────────
  return lockManager.withLock(fullPath, async () => {
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

    // Deduplication
    const existing = registry.get(fullPath)
    if (existing && existing.hash === hash) {
      const sameRange = existing.offset === oneBasedOffset && existing.limit === limit
      const previouslyComplete = existing.complete
      if (sameRange || previouslyComplete)
        return FILE_UNCHANGED_STUB
    }

    // Registry update
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

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createReadFilesTool(
  projectPath: string,
  registry: FileReadRegistry,
  lockManager: FileLockManager = new FileLockManager(),
) {
  return tool({
    description: `Read one or more files from the project. Returns content with 1-based line numbers in cat -n format.

Always read a file before editing it.

Use offset and limit together to page through files that are too large to read at once. Default limit is 300 lines (max 2000).`,

    inputSchema: z.object({
      file_paths: z
        .array(z.string())
        .min(1)
        .describe('One or more file paths to read. Can be absolute or relative to the project root.'),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'The line number to start reading from (1-based). Default: 1. Only provide if the file is too large to read at once.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LINE_LIMIT)
        .optional()
        .describe(
          `The maximum number of lines to read per file. Default: ${DEFAULT_LINE_LIMIT}, Max: ${MAX_LINE_LIMIT}. Only provide if the file is too large to read at once.`,
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
