import type { BeforeFileWriteCallback, FileLockManager, FileReadRegistry, LineEnding, TextEncoding } from './shared'
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

export function createWriteFileTool(
  projectPath: string,
  registry: FileReadRegistry,
  onBeforeFileWrite: BeforeFileWriteCallback | undefined,
  lockManager: FileLockManager,
) {
  return tool({
    description: `Write a file to disk. Creates the file if it does not exist, or fully overwrites it if it does.

Rules:
- For new files, just provide file_path and content.
- For overwriting existing files, you MUST have read the file with read_files first.
- Prefer edit_files for modifying existing files - it only sends the changed section. Only use this tool to create new files or when a complete rewrite is genuinely necessary.
- Do not use this tool to move or rename files; use the shell for that.
- If writing a very large file (> 500 lines), the JSON payload may fail. Use append: true to write it in chunks. The first call creates the file, and subsequent calls append to it.`,

    inputSchema: z.object({
      file_path: z
        .string()
        .describe('The path of the file to write. Can be absolute or relative to the project root.'),
      content: z
        .string()
        .describe('The full content to write to the file.'),
      append: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, appends the content to the existing file instead of overwriting. Useful for chunking large files to avoid JSON payload limits.'),
    }),

    execute: async ({ file_path, content, append }) => {
      console.warn(`[write_file] path=${file_path} append=${append} content=${content.length}b`)

      const normalizedContent = normalizeLineEndings(content)

      let fullPath: string
      try {
        fullPath = await safePath(projectPath, file_path, { kind: 'write' })
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[write_file] path resolution failed: ${detail}`)
        return `Error: ${detail}`
      }
      console.warn(`[write_file] resolved=${fullPath}`)

      if (hasBinaryExtension(file_path)) {
        console.warn(`[write_file] rejected: binary extension for ${file_path}`)
        return 'Error: Cannot write binary file paths with this text tool.'
      }

      return lockManager.withLock(fullPath, async () => {
        let existingLineEnding: LineEnding = 'lf'
        let existingEncoding: TextEncoding = 'utf8'
        let existingContent: string | null = null

        const info = await stat(fullPath).catch(() => null)
        if (info) {
          if (!info.isFile)
            return `Error: ${file_path} is not a regular file.`

          const registryEntry = registry.get(fullPath)
          if (!registryEntry && !append) {
            console.warn(`[write_file] rejected: no read registry entry for ${file_path} (append=${append})`)
            return 'Error: File has not been read yet. Call read_files first before overwriting.'
          }

          let existingSnapshot: Awaited<ReturnType<typeof readTextSnapshot>>
          try {
            existingSnapshot = await readTextSnapshot(fullPath)
          }
          catch (e) {
            return `Error: Cannot read existing ${file_path}: ${e instanceof Error ? e.message : String(e)}`
          }

          existingContent = existingSnapshot.content
          existingLineEnding = existingSnapshot.lineEnding
          existingEncoding = existingSnapshot.encoding

          if (!append) {
            const mtimesMatch = registryEntry !== undefined
              && registryEntry.mtimeMs !== null
              && existingSnapshot.mtimeMs !== null
              && registryEntry.mtimeMs === existingSnapshot.mtimeMs
            if (!mtimesMatch && registryEntry !== undefined && registryEntry.hash !== existingSnapshot.hash) {
              console.warn(`[write_file] rejected: file modified since last read. registry.mtime=${registryEntry.mtimeMs} disk.mtime=${existingSnapshot.mtimeMs} registry.hash=${registryEntry.hash.slice(0, 12)}… disk.hash=${existingSnapshot.hash.slice(0, 12)}…`)
              return 'Error: File has been modified since last read. Re-read with read_files before overwriting.'
            }
          }
        }

        const parentDir = parentDirPath(fullPath)
        if (parentDir) {
          try {
            await ensureDir(parentDir)
          }
          catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            console.warn(`[write_file] ensureDir failed for ${parentDir}: ${detail}`)
            return `Error: Failed to create directories for ${file_path}: ${detail}`
          }
        }

        if (onBeforeFileWrite) {
          try {
            await onBeforeFileWrite(file_path, fullPath, existingContent)
          }
          catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            console.warn(`[write_file] checkpoint (onBeforeFileWrite) failed for ${file_path}: ${detail}`)
            return `Error: Failed to checkpoint ${file_path}: ${detail}`
          }
        }

        const finalContent = append && existingContent !== null
          ? existingContent + normalizedContent
          : normalizedContent
        const { added, removed } = diffLineStats(existingContent ?? '', finalContent)

        const diskContent = existingContent !== null
          ? applyLineEnding(finalContent, existingLineEnding)
          : finalContent

        try {
          await writeEncodedTextFile(fullPath, diskContent, existingEncoding)
        }
        catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.warn(`[write_file] disk write failed for ${fullPath} (${existingEncoding}): ${detail}`)
          return `Error writing ${file_path}: ${detail}`
        }

        try {
          const newInfo = await stat(fullPath)
          const updatedEntry = {
            hash: await sha256Text(finalContent),
            complete: true,
            sizeBytes: newInfo.size,
            mtimeMs: newInfo.mtime?.getTime() ?? null,
          }
          updateReadRegistry(registry, fullPath, updatedEntry)
        }
        catch (e) {
          console.warn(`[write_file] registry update failed for ${fullPath} (non-fatal): ${e instanceof Error ? e.message : String(e)}`)
        }

        const op = existingContent !== null
          ? append ? 'append' : 'rewrite'
          : 'create'
        console.warn(`[write_file] success ${op} ${file_path} (+${added}/-${removed})`)

        const message = existingContent !== null
          ? append
            ? `Successfully appended to ${file_path}.`
            : `The file ${file_path} has been updated successfully.`
          : `The file ${file_path} has been created successfully.`

        return {
          message,
          file: file_path,
          operation: existingContent !== null
            ? append ? 'append' : 'rewrite'
            : 'create',
          added,
          removed,
          diff: createUnifiedDiff(file_path, existingContent ?? '', finalContent),
        }
      })
    },
  })
}
