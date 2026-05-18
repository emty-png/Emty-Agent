import type { BeforeFileWriteCallback } from './shared'
import { dirname } from '@tauri-apps/api/path'
import { copyFile, remove, rename } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { ensureDir, safePath } from './shared'

type ModifyOp
  = | { op: 'move'; from: string; to: string }
    | { op: 'rename'; from: string; to: string }
    | { op: 'delete'; path: string; recursive?: boolean }
    | { op: 'copy'; from: string; to: string }
    | { op: 'mkdir'; path: string }

export function createModifyFilesTool(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
) {
  return tool({
    description: `File-system operations: move, rename, delete, copy, mkdir. Multiple ops applied in order — batch in one call.

- move/rename — moves to new location; creates parent dirs automatically
- delete — set recursive:true for directories
- copy — copies file; creates parent dirs automatically
- mkdir — creates directory and all parents`,
    inputSchema: z.object({
      operations: z.array(
        z.discriminatedUnion('op', [
          z.object({
            op: z.literal('move'),
            from: z.string().describe('Source path relative to project root.'),
            to: z.string().describe('Destination path relative to project root.'),
          }),
          z.object({
            op: z.literal('rename'),
            from: z.string().describe('Current path relative to project root.'),
            to: z.string().describe('New path relative to project root.'),
          }),
          z.object({
            op: z.literal('delete'),
            path: z.string().describe('Path to delete, relative to project root.'),
            recursive: z.boolean().optional().describe('Delete directories recursively. Default: false.'),
          }),
          z.object({
            op: z.literal('copy'),
            from: z.string().describe('Source file path relative to project root.'),
            to: z.string().describe('Destination path relative to project root.'),
          }),
          z.object({
            op: z.literal('mkdir'),
            path: z.string().describe('Directory path to create, relative to project root.'),
          }),
        ]),
      ).min(1).describe('Ordered list of file-system operations to perform.'),
    }),
    execute: async ({ operations }) => {
      const results: string[] = []
      const errors: string[] = []

      for (const operation of operations as ModifyOp[]) {
        try {
          switch (operation.op) {
            case 'move':
            case 'rename': {
              const fromFull = await safePath(projectPath, operation.from)
              const toFull = await safePath(projectPath, operation.to)
              // Snapshot source (to restore) and destination (to delete on restore)
              if (onBeforeFileWrite) {
                try { await onBeforeFileWrite(operation.from, fromFull) }
                catch { }
                try { await onBeforeFileWrite(operation.to, toFull) }
                catch { }
              }
              const toParent = await dirname(toFull)
              await ensureDir(toParent)
              await rename(fromFull, toFull)
              const verb = operation.op === 'rename' ? 'Renamed' : 'Moved'
              results.push(`${verb} ${operation.from} → ${operation.to}`)
              break
            }

            case 'delete': {
              const fullPath = await safePath(projectPath, operation.path)
              // Snapshot before deletion so we can restore
              if (onBeforeFileWrite) {
                try { await onBeforeFileWrite(operation.path, fullPath) }
                catch { }
              }
              await remove(fullPath, { recursive: operation.recursive ?? false })
              results.push(`Deleted ${operation.path}`)
              break
            }

            case 'copy': {
              const fromFull = await safePath(projectPath, operation.from)
              const toFull = await safePath(projectPath, operation.to)
              // Snapshot destination (to delete on restore if it didn't exist)
              if (onBeforeFileWrite) {
                try { await onBeforeFileWrite(operation.to, toFull) }
                catch { }
              }
              const toParent = await dirname(toFull)
              await ensureDir(toParent)
              await copyFile(fromFull, toFull)
              results.push(`Copied ${operation.from} → ${operation.to}`)
              break
            }

            case 'mkdir': {
              const fullPath = await safePath(projectPath, operation.path)
              await ensureDir(fullPath)
              results.push(`Created directory ${operation.path}`)
              break
            }
          }
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const label = 'path' in operation ? operation.path : `${'from' in operation ? operation.from : '?'}`
          errors.push(`${operation.op} ${label}: ${msg}`)
        }
      }

      return { results, ...(errors.length > 0 ? { errors } : {}) }
    },
  })
}
