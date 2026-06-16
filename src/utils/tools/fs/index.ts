/**
 * src/utils/tools/fs/index.ts
 *
 * Barrel export for filesystem tools plus the combined factory.
 */

import type { BeforeFileWriteCallback, FileReadRegistry } from './shared'
import { createEditFilesTool } from './edit'
import { createGlobTool } from './glob'
import { createGrepTool } from './grep'
import { createListDirectoryTool } from './list'
import { createReadFilesTool } from './read'
import { FileLockManager } from './shared'
import { createWriteFileTool } from './write'

export { createEditFilesTool } from './edit'
export { createGlobTool } from './glob'
export { createGrepTool } from './grep'
export { createListDirectoryTool } from './list'
export { createReadFilesTool } from './read'
export type { BeforeFileWriteCallback, FileReadRegistry } from './shared'
export { createWriteFileTool } from './write'

export function createFilesystemTools(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
  registry?: FileReadRegistry,
) {
  const effectiveRegistry: FileReadRegistry = registry ?? new Map()
  const lockManager = new FileLockManager()

  return {
    list_directory: createListDirectoryTool(projectPath),
    read_files: createReadFilesTool(projectPath, effectiveRegistry, lockManager),
    write_file: createWriteFileTool(projectPath, effectiveRegistry, onBeforeFileWrite, lockManager),
    edit_files: createEditFilesTool(projectPath, effectiveRegistry, onBeforeFileWrite, lockManager),
    glob: createGlobTool(projectPath),
    grep: createGrepTool(projectPath),
  }
}

export type FilesystemTools = ReturnType<typeof createFilesystemTools>

// ---------------------------------------------------------------------------
// Display label (for UI tool call summaries)
// ---------------------------------------------------------------------------

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function truncate(value: string, max: number): string {
  const compact = value.trim()
  return compact.length > max ? `${compact.slice(0, max)}\u2026` : compact
}

export function toolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': {
      const path = String(args.path ?? '')
      return `Listed ${truncate(path, 40)}`
    }

    case 'read_files':
    case 'read_file': {
      const paths = Array.isArray(args.file_paths)
        ? args.file_paths.filter((p): p is string => typeof p === 'string')
        : typeof args.file_path === 'string'
          ? [args.file_path]
          : []
      if (paths.length === 0)
        return 'Read file'
      if (paths.length === 1) {
        const name = basename(paths[0]!)
        return `Read ${name}`
      }
      return `Read ${paths.length} files`
    }

    case 'write_file': {
      const filePath = typeof args.file_path === 'string' ? args.file_path : ''
      return filePath ? `Write ${basename(filePath)}` : 'Write file'
    }

    case 'edit_files':
    case 'edit_file': {
      const edits = Array.isArray(args.edits)
        ? args.edits.filter((e): e is Record<string, unknown> => typeof e === 'object' && e != null)
        : []
      if (edits.length > 0) {
        const paths = [...new Set(edits.map(e => typeof e.file_path === 'string' ? e.file_path : '').filter(Boolean))]
        if (paths.length === 1)
          return `Edit ${basename(paths[0]!)}`
        return `Edit ${paths.length} files`
      }
      const filePath = typeof args.file_path === 'string' ? args.file_path : ''
      return filePath ? `Edit ${basename(filePath)}` : 'Edit file'
    }

    case 'glob': {
      const pattern = truncate(String(args.pattern ?? '*'), 48)
      const rawPath = args.path && args.path !== '.' ? String(args.path) : null
      const inPath = rawPath ? ` in ${truncate(rawPath, 24)}` : ''
      return `Glob ${pattern}${inPath}`
    }

    case 'grep': {
      const q = truncate(String(args.pattern ?? ''), 48)
      const rawPath = args.path && args.path !== '.' ? String(args.path) : null
      const inPath = rawPath ? ` in ${truncate(rawPath, 24)}` : ''
      return `Grep ${q}${inPath}`
    }

    default:
      return `Called ${toolName}`
  }
}
