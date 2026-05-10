/**
 * src/utils/tools/fs/index.ts
 *
 * Barrel export for all filesystem tools.
 * Re-exports individual tool creators and the combined factory.
 */

import type { BeforeFileWriteCallback } from './shared'
import { createEditFilesTool } from './edit'
import { createGlobTool } from './glob'
import { createGrepTool } from './grep'
import { createListDirectoryTool } from './list'
import { createModifyFilesTool } from './modify'
import { createReadFilesTool } from './read'
import { createWriteFilesTool } from './write'

export { createEditFilesTool } from './edit'
export { createGlobTool } from './glob'
export { createGrepTool } from './grep'
export { createListDirectoryTool } from './list'
export { createModifyFilesTool } from './modify'
export { createReadFilesTool } from './read'
export type { BeforeFileWriteCallback } from './shared'
export { createWriteFilesTool } from './write'

// ── constants ─────────────────────────────────────────────────────────────────

/** Must stay in sync with DEFAULT_LINE_LIMIT in ./read.ts */
const DEFAULT_LINE_LIMIT = 500

// ── factory ───────────────────────────────────────────────────────────────────

export function createFilesystemTools(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
) {
  return {
    list_directory: createListDirectoryTool(projectPath),
    read_files: createReadFilesTool(projectPath),
    write_files: createWriteFilesTool(projectPath, onBeforeFileWrite),
    edit_files: createEditFilesTool(projectPath, onBeforeFileWrite),
    modify_files: createModifyFilesTool(projectPath, onBeforeFileWrite),
    glob: createGlobTool(projectPath),
    grep: createGrepTool(projectPath),
  } as const
}

export type FilesystemTools = ReturnType<typeof createFilesystemTools>

// ── display label helpers ─────────────────────────────────────────────────────

/** Keep just the filename from any relative or absolute path. */
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

/**
 * Truncate a string to at most `max` characters, appending an ellipsis.
 * Used for patterns, paths, and other free-form strings in badge labels.
 */
function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

// ── display labels ────────────────────────────────────────────────────────────

export function toolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    // ── list_directory ──────────────────────────────────────────────────────
    case 'list_directory': {
      const p = String(args.path ?? '.')
      return p === '.' ? 'Listed root directory' : `Listed ${truncate(p, 40)}`
    }

    // ── read_files ──────────────────────────────────────────────────────────
    case 'read_files': {
      const paths = args.paths as string[] | undefined
      if (!paths?.length)
        return 'Read files'

      const offset = typeof args.offset === 'number' ? args.offset : 0
      const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LINE_LIMIT
      const rangeTag = ` #${offset}–${offset + limit - 1}`

      if (paths.length > 3)
        return `Read ${paths.length} files${rangeTag}`

      return `Read ${paths.map(basename).join(', ')}${rangeTag}`
    }

    // ── write_files ─────────────────────────────────────────────────────────
    case 'write_files': {
      const files = args.files as { path: string }[] | undefined
      if (!files?.length)
        return 'Wrote file'
      if (files.length === 1)
        return `Wrote ${basename(files[0]!.path)}`
      if (files.length <= 3)
        return `Wrote ${files.map(f => basename(f.path)).join(', ')}`
      return `Wrote ${files.length} files`
    }

    // ── edit_files ──────────────────────────────────────────────────────────
    case 'edit_files': {
      const edits = args.edits as { path: string }[] | undefined
      if (!edits?.length)
        return 'Edited file'
      const uniquePaths = [...new Set(edits.map(e => e.path))]
      if (uniquePaths.length === 1)
        return `Edited ${basename(uniquePaths[0]!)}`
      if (uniquePaths.length <= 2)
        return `Edited ${uniquePaths.map(basename).join(', ')}`
      return `Edited ${uniquePaths.length} files`
    }

    // ── modify_files ────────────────────────────────────────────────────────
    case 'modify_files': {
      const ops = args.operations as {
        op: string
        from?: string
        to?: string
        path?: string
      }[] | undefined

      if (!ops?.length)
        return 'Modified files'

      if (ops.length === 1) {
        const o = ops[0]!
        switch (o.op) {
          case 'delete':
            return `Deleted ${basename(o.path ?? '')}`
          case 'move':
            return `Moved ${basename(o.from ?? '')} → ${basename(o.to ?? '')}`
          case 'rename':
            return `Renamed ${basename(o.from ?? '')} → ${basename(o.to ?? '')}`
          case 'copy':
            return `Copied ${basename(o.from ?? '')} → ${basename(o.to ?? '')}`
          case 'mkdir':
            return `Created ${truncate(o.path ?? '', 40)}`
        }
      }

      const unique = [...new Set(ops.map(o => o.op))]
      return `${ops.length} file ops (${unique.join(', ')})`
    }

    // ── glob ────────────────────────────────────────────────────────────────
    case 'glob': {
      return `Glob ${truncate(String(args.pattern ?? '*'), 48)}`
    }

    // ── grep ────────────────────────────────────────────────────────────────
    case 'grep': {
      const pattern = truncate(String(args.pattern ?? ''), 36)
      const rawPath = args.path && args.path !== '.' ? String(args.path) : null
      const inPath = rawPath ? ` in ${truncate(rawPath, 24)}` : ''
      return `Grep "${pattern}"${inPath}`
    }

    default:
      return `Called ${toolName}`
  }
}
