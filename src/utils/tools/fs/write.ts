import type { BeforeFileWriteCallback } from './shared'
import { dirname } from '@tauri-apps/api/path'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { ensureDir, safePath } from './shared'

export function createWriteFilesTool(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
) {
  return tool({
    description: `Create or overwrite one or more files in the project.
Pass an array of { path, content } pairs to write multiple files in one call.
Parent directories are created automatically if they don't exist.
Use this to implement features, write configs, create new source files, etc.`,
    inputSchema: z.object({
      files: z.array(z.object({
        path: z.string().describe('File path relative to the project root.'),
        content: z.string().describe('Full content to write to the file.'),
      })).min(1).describe('List of files to write.'),
    }),
    execute: async ({ files }) => {
      const written: string[] = []
      const errors: string[] = []
      let totalAdded = 0
      let totalRemoved = 0

      for (const { path: inputPath, content } of files) {
        let fullPath: string
        try {
          fullPath = await safePath(projectPath, inputPath)
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${inputPath}: ${msg}`)
          continue
        }

        // Snapshot before mutation
        if (onBeforeFileWrite) {
          try { await onBeforeFileWrite(inputPath, fullPath) }
          catch { /* snapshot failure must not block tool */ }
        }

        // Read old content before overwriting so we can report accurate diff stats.
        // Silently treats missing files (new creates) as having 0 old lines.
        let oldLineCount = 0
        try {
          const existing = await readTextFile(fullPath)
          oldLineCount = existing.split('\n').length
        }
        catch { /* new file — oldLineCount stays 0 */ }

        let parentDir: string
        try {
          parentDir = await dirname(fullPath)
          await ensureDir(parentDir)
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${inputPath}: ${msg}`)
          continue
        }

        try {
          await writeTextFile(fullPath, content)
          const newLineCount = content.split('\n').length
          written.push(`${inputPath} (${newLineCount} lines)`)
          totalAdded += newLineCount
          totalRemoved += oldLineCount
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${inputPath}: ${msg}`)
        }
      }

      return {
        written,
        added: totalAdded,
        removed: totalRemoved,
        ...(errors.length > 0 ? { errors } : {}),
      }
    },
  })
}
