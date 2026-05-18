import type { BeforeFileWriteCallback } from './shared'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { safePath } from './shared'

export function createEditFilesTool(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
) {
  return tool({
    description: `PREFERRED way to modify existing files. Applies targeted string replacements — faster and safer than rewriting. Batches edits across files in one call.
Use write_files only for new files or full rewrites.

Rules:
- oldString must match exactly (whitespace, indentation).
- oldString must be unique in the file; expand context if needed.
- Edits per file applied top-to-bottom. Failed edits are reported but don't block others.`,
    inputSchema: z.object({
      edits: z.preprocess(
        val => (Array.isArray(val) ? val : [val]),
        z.array(z.object({
          path: z.string().describe('File path relative to the project root.'),
          oldString: z.string().describe('Exact string to find and replace. Must be unique in the file.'),
          newString: z.string().describe('String to replace oldString with. Can be empty to delete.'),
        })).min(1),
      ).describe('List of edits to apply.'),
    }),
    execute: async ({ edits }) => {
      // Group edits by file path so we read each file once
      const byFile = new Map<string, { oldString: string; newString: string }[]>()
      for (const edit of edits) {
        const list = byFile.get(edit.path) ?? []
        list.push({ oldString: edit.oldString, newString: edit.newString })
        byFile.set(edit.path, list)
      }

      const edited: string[] = []
      const errors: string[] = []
      let totalAdded = 0
      let totalRemoved = 0

      for (const [inputPath, fileEdits] of byFile) {
        let fullPath: string
        try { fullPath = await safePath(projectPath, inputPath) }
        catch (e) {
          errors.push(`${inputPath}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }

        // Snapshot before mutation
        if (onBeforeFileWrite) {
          try { await onBeforeFileWrite(inputPath, fullPath) }
          catch { /* snapshot failure must not block tool */ }
        }

        let content: string
        try { content = await readTextFile(fullPath) }
        catch (e) {
          errors.push(`${inputPath}: Cannot read file — ${e instanceof Error ? e.message : String(e)}`)
          continue
        }

        const originalContent = content
        const fileErrors: string[] = []
        const appliedRanges: string[] = []

        for (const { oldString, newString } of fileEdits) {
          if (!content.includes(oldString)) {
            // Provide a useful diagnostic: show the first differing chars
            fileErrors.push(
              `String not found in file: ${JSON.stringify(oldString.slice(0, 80))}${oldString.length > 80 ? '…' : ''}`,
            )
            continue
          }

          // Check for ambiguity — the same string appearing more than once
          const firstIdx = content.indexOf(oldString)
          const lastIdx = content.lastIndexOf(oldString)
          if (firstIdx !== lastIdx) {
            fileErrors.push(
              `Ambiguous match: ${JSON.stringify(oldString.slice(0, 60))}${oldString.length > 60 ? '…' : ''} appears multiple times. Make oldString more specific.`,
            )
            continue
          }

          // Calculate line range for the label
          const before = content.slice(0, firstIdx)
          const startLine = before.split('\n').length
          const endLine = startLine + oldString.split('\n').length - 1
          appliedRanges.push(`${startLine}–${endLine}`)
          // Tally line-level diff for this replacement.
          // Empty newString means pure deletion — counts as 0 lines added.
          totalAdded += newString.length > 0 ? newString.split('\n').length : 0
          totalRemoved += oldString.split('\n').length
          content = content.slice(0, firstIdx) + newString + content.slice(firstIdx + oldString.length)
        }

        if (fileErrors.length > 0) {
          errors.push(...fileErrors.map(e => `${inputPath}: ${e}`))
        }

        // Only write if at least one edit was successfully applied
        if (content !== originalContent) {
          try {
            await writeTextFile(fullPath, content)
            const rangeStr = appliedRanges.length > 0 ? ` lines ${appliedRanges.join(', ')}` : ''
            edited.push(`${inputPath}${rangeStr}`)
          }
          catch (e) {
            errors.push(`${inputPath}: Write failed — ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }

      return { edited, added: totalAdded, removed: totalRemoved, ...(errors.length > 0 ? { errors } : {}) }
    },
  })
}
