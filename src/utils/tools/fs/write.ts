import type {
  BeforeFileWriteCallback,
  FileLockManager,
  FileReadRegistry,
  LineEnding,
  TextEncoding,
} from './shared'
import { stat } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { hasBinaryExtension, safePath } from './allowedPaths'
import {
  applyLineEnding,
  createUnifiedDiff,
  diffLineStats,
  ensureDir,
  normalizeLineEndings,
  parentDirPath,
  readTextSnapshot,
  sha256Text,
  updateReadRegistry,
  writeEncodedTextFile,
} from './shared'

// ── production limits ─────────────────────────────────────────────────────────

const MAX_DIFF_LINES = 2_000
const MAX_DIFF_CHARS = 100_000

// ── helpers ───────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildSafeDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  changedLines: number,
): { diff: string; diffTruncated: boolean } {
  if (changedLines > MAX_DIFF_LINES) {
    return {
      diff: `Diff omitted: ${changedLines} changed lines exceeds the safe display limit of ${MAX_DIFF_LINES} lines.`,
      diffTruncated: true,
    }
  }

  let diff: string

  try {
    diff = createUnifiedDiff(filePath, oldContent, newContent)
  }
  catch (error) {
    return {
      diff: `Error generating diff: ${errorMessage(error)}`,
      diffTruncated: false,
    }
  }

  if (diff.length <= MAX_DIFF_CHARS) {
    return {
      diff,
      diffTruncated: false,
    }
  }

  return {
    diff: `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated to ${MAX_DIFF_CHARS} characters for context safety`,
    diffTruncated: true,
  }
}

// ── tool ──────────────────────────────────────────────────────────────────────

export function createWriteFileTool(
  projectPath: string,
  registry: FileReadRegistry,
  onBeforeFileWrite: BeforeFileWriteCallback | undefined,
  lockManager: FileLockManager,
) {
  return tool({
    description: `Write or overwrite a text file within the project. Creates the file if it does not exist; fully replaces it if it does.

Always call read_files and wait for its result before overwriting or appending to an existing file. Calling read and write in parallel on the same file path is not allowed. Reading one file while writing a different file is fine.

Prefer edit_files for targeted changes to existing files. Use this tool only for new files or full rewrites.

For very large files, write in chunks: first call creates the file (append: false), subsequent calls use append: true. Text files only — not for binary files, renames, deletes, or permission changes.`,

    inputSchema: z.object({
      file_path: z
        .string()
        .min(1)
        .max(1_024)
        .describe('Path of the file to create or overwrite (absolute or relative to the project root). Parent directories are created automatically.'),
      content: z
        .string()
        .describe('Full text content to write. Replaces the entire file when overwriting; appended after existing content when append is true. Line endings are normalised and restored to match the existing file style.'),
      append: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, appends content to the end of the existing file instead of overwriting it. The file must still have been read first. Useful for chunked writes of large files.'),
    }),

    execute: async ({ file_path, content, append }) => {
      const isAppend = append === true

      console.info(`[write_file] start path=${file_path} append=${isAppend} contentChars=${content.length}`)

      try {
        if (content.includes('\0')) {
          console.warn(`[write_file] rejected: null byte in content for ${file_path}`)
          return 'Error: Content contains null bytes. Use a binary-safe tool for binary content.'
        }

        const normalizedContent = normalizeLineEndings(content)

        let fullPath: string

        try {
          fullPath = await safePath(projectPath, file_path, { kind: 'write' })
        }
        catch (error) {
          const detail = errorMessage(error)
          console.warn(`[write_file] path resolution failed for ${file_path}: ${detail}`)
          return `Error: ${detail}`
        }

        if (hasBinaryExtension(file_path) || hasBinaryExtension(fullPath)) {
          console.warn(`[write_file] rejected: binary extension for ${file_path}`)
          return 'Error: Cannot write binary file paths with this text tool.'
        }

        return await lockManager.withLock(fullPath, async () => {
          let existingLineEnding: LineEnding = 'lf'
          let existingEncoding: TextEncoding = 'utf8'
          let existingContent: string | null = null
          let fileExists = false

          const info = await stat(fullPath).catch(() => null)

          if (info) {
            if (!info.isFile) {
              console.warn(`[write_file] rejected: ${file_path} is not a regular file`)
              return `Error: ${file_path} is not a regular file.`
            }

            fileExists = true

            const registryEntry = registry.get(fullPath)

            if (!registryEntry) {
              const action = isAppend ? 'appending to' : 'overwriting'
              console.warn(`[write_file] rejected: no read registry entry for ${file_path} (append=${isAppend})`)
              return `Error: File has not been read yet. Call read_files first before ${action} an existing file.`
            }

            if (registryEntry.complete === false) {
              // Appending always touches the unread tail – keep blocked.
              if (isAppend) {
                console.warn(`[write_file] rejected: incomplete read registry entry for ${file_path} (append)`)
                return `Error: ${file_path} has only been partially read. Call read_files with a complete read before appending.`
              }

              // Rewrite: read disk and verify the unread region is preserved.
              let diskSnapshot: Awaited<ReturnType<typeof readTextSnapshot>>
              try {
                diskSnapshot = await readTextSnapshot(fullPath)
              }
              catch (error) {
                const detail = errorMessage(error)
                console.warn(`[write_file] failed to read existing file for partial-read check ${file_path}: ${detail}`)
                return `Error: Cannot read existing ${file_path}: ${detail}`
              }

              // registryEntry.offset is 1-based; registryEntry.limit is line count.
              // If either is missing (shouldn't happen for a partial read) fall back to
              // treating the whole file as unread, which will always block.
              const readOffset = registryEntry.offset ?? 1
              const readLimit = registryEntry.limit ?? 0
              // 0-based index of the first line that was NOT shown to the agent.
              const unreadStartIdx = readOffset - 1 + readLimit

              const diskLines = diskSnapshot.content === '' ? [] : diskSnapshot.content.split('\n')
              const newLines = normalizedContent === '' ? [] : normalizedContent.split('\n')

              const diskUnread = diskLines.slice(unreadStartIdx)
              const newUnread = newLines.slice(unreadStartIdx)

              if (diskUnread.join('\n') !== newUnread.join('\n')) {
                const readEndLine = Math.min(unreadStartIdx, diskLines.length)
                console.warn(
                  `[write_file] rejected: partial read but unread region (lines ${unreadStartIdx + 1}+) `
                  + `was modified for ${file_path}`,
                )
                return (
                  `Error: ${file_path} was only partially read (lines 1–${readEndLine}). `
                  + `The unread region (lines ${unreadStartIdx + 1}–${diskLines.length}) must not be changed. `
                  + `Re-read the full file with read_files before overwriting.`
                )
              }

              // Unread region is intact – allow the write using the snapshot we already have.
              existingContent = diskSnapshot.content
              existingLineEnding = diskSnapshot.lineEnding
              existingEncoding = diskSnapshot.encoding
            }
            else {
              // Complete read: normal snapshot + stale check.
              let existingSnapshot: Awaited<ReturnType<typeof readTextSnapshot>>

              try {
                existingSnapshot = await readTextSnapshot(fullPath)
              }
              catch (error) {
                const detail = errorMessage(error)
                console.warn(`[write_file] failed to read existing file ${file_path}: ${detail}`)
                return `Error: Cannot read existing ${file_path}: ${detail}`
              }

              existingContent = existingSnapshot.content
              existingLineEnding = existingSnapshot.lineEnding
              existingEncoding = existingSnapshot.encoding

              const mtimesMatch = registryEntry.mtimeMs !== null
                && existingSnapshot.mtimeMs !== null
                && registryEntry.mtimeMs === existingSnapshot.mtimeMs

              if (!mtimesMatch && registryEntry.hash !== existingSnapshot.hash) {
                console.warn(
                  `[write_file] rejected: file modified since last read. `
                  + `registry.mtime=${registryEntry.mtimeMs} `
                  + `disk.mtime=${existingSnapshot.mtimeMs} `
                  + `registry.hash=${registryEntry.hash.slice(0, 12)}… `
                  + `disk.hash=${existingSnapshot.hash.slice(0, 12)}…`,
                )

                return `Error: ${file_path} has been modified since last read. Re-read with read_files before writing.`
              }
            }
          }

          const parentDir = parentDirPath(fullPath)

          if (parentDir) {
            try {
              await ensureDir(parentDir)
            }
            catch (error) {
              const detail = errorMessage(error)
              console.warn(`[write_file] ensureDir failed for ${parentDir}: ${detail}`)
              return `Error: Failed to create directories for ${file_path}: ${detail}`
            }
          }

          if (onBeforeFileWrite) {
            try {
              await onBeforeFileWrite(file_path, fullPath, existingContent)
            }
            catch (error) {
              const detail = errorMessage(error)
              console.warn(`[write_file] checkpoint failed for ${file_path}: ${detail}`)
              return `Error: Failed to checkpoint ${file_path}: ${detail}`
            }
          }

          const finalContent = isAppend && existingContent !== null
            ? existingContent + normalizedContent
            : normalizedContent

          const { added, removed } = diffLineStats(existingContent ?? '', finalContent)
          const changedLines = added + removed

          const diskContent = existingContent !== null
            ? applyLineEnding(finalContent, existingLineEnding)
            : finalContent

          try {
            await writeEncodedTextFile(fullPath, diskContent, existingEncoding)
          }
          catch (error) {
            const detail = errorMessage(error)
            console.warn(`[write_file] disk write failed for ${fullPath} (${existingEncoding}): ${detail}`)
            return `Error writing ${file_path}: ${detail}`
          }

          try {
            const newInfo = await stat(fullPath)
            const hash = await sha256Text(finalContent)

            updateReadRegistry(registry, fullPath, {
              hash,
              complete: true,
              sizeBytes: newInfo.size,
              mtimeMs: newInfo.mtime?.getTime() ?? null,
            })
          }
          catch (error) {
            console.warn(`[write_file] registry update failed for ${fullPath} (non-fatal): ${errorMessage(error)}`)
          }

          const operation = fileExists
            ? isAppend ? 'append' : 'rewrite'
            : 'create'

          const { diff, diffTruncated } = buildSafeDiff(
            file_path,
            existingContent ?? '',
            finalContent,
            changedLines,
          )

          console.info(`[write_file] success ${operation} ${file_path} (+${added}/-${removed})`)

          const message = operation === 'create'
            ? `The file ${file_path} has been created successfully.`
            : operation === 'append'
              ? `Successfully appended to ${file_path}.`
              : `The file ${file_path} has been updated successfully.`

          return {
            message,
            file: file_path,
            operation,
            added,
            removed,
            diff,
            diffTruncated,
          }
        })
      }
      catch (error) {
        const detail = errorMessage(error)
        console.error(`[write_file] unexpected error for ${file_path}: ${detail}`)
        return `Error: ${detail}`
      }
    },
  })
}