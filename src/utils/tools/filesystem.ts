/**
 * src/utils/tools/filesystem.ts
 *
 * All filesystem tools for the coding agent.
 *   • list_directory  — list files/dirs, skips build artefacts
 *   • read_files      — read one or many files, with line offset/limit
 *   • write_files     — create/overwrite files (creates parent dirs)
 *   • edit_files      — surgical string-replacement edits on existing files
 *   • modify_files    — move, rename, delete, copy files/directories
 *   • glob            — find files matching a glob pattern
 *   • grep            — search file contents with a regex
 *
 * Security: every path is sandboxed to projectPath via safePath().
 * Tauri capabilities needed (tauri.conf.json → permissions):
 *   fs:read-all, fs:allow-read-dir
 *   fs:allow-write-file, fs:allow-create-dir    (write_files)
 *   fs:allow-rename                              (modify_files: move/rename)
 *   fs:allow-remove                              (modify_files: delete)
 *   fs:allow-copy-file                           (modify_files: copy)
 */

import { dirname, join, normalize } from '@tauri-apps/api/path'
import {
  copyFile,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'

// ── skip sets ─────────────────────────────────────────────────────────────────

const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'target',
  '.cargo',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  'tmp',
  '.tmp',
  'temp',
  '.turbo',
  '.vercel',
])

function shouldSkipEntry(name: string, showHidden: boolean): boolean {
  if (ALWAYS_SKIP.has(name))
    return true
  if (!showHidden && name.startsWith('.'))
    return true
  return false
}

// ── path safety ───────────────────────────────────────────────────────────────

async function safePath(projectPath: string, inputPath: string): Promise<string> {
  const full = await join(projectPath, inputPath)
  const normalFull = await normalize(full)
  const normalProject = await normalize(projectPath)
  const sep = normalProject.includes('\\') ? '\\' : '/'
  const projectDir = normalProject.endsWith(sep) ? normalProject : normalProject + sep
  if (normalFull !== normalProject && !normalFull.startsWith(projectDir)) {
    throw new Error(`Access denied: "${inputPath}" resolves outside the project directory`)
  }
  return normalFull
}

// ── ensureDir ─────────────────────────────────────────────────────────────────

async function ensureDir(absoluteDirPath: string): Promise<void> {
  try {
    await mkdir(absoluteDirPath, { recursive: true })
    return
  }
  catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
    if (
      msg.includes('already exists')
      || msg.includes('file exists')
      || msg.includes('os error 17')
      || msg.includes('os error 183')
    ) {
      return
    }
  }

  const sep = absoluteDirPath.includes('\\') ? '\\' : '/'
  const segments = absoluteDirPath.split(sep)
  let current = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    current = i === 0 ? seg : `${current}${sep}${seg}`
    if (!current)
      continue

    try {
      await mkdir(current)
    }
    catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
      const raw = e instanceof Error ? e.message : String(e)
      if (
        msg.includes('already exists')
        || msg.includes('file exists')
        || msg.includes('os error 17')
        || msg.includes('os error 183')
      ) {
        continue
      }
      throw new Error(`Cannot create directory "${current}": ${raw}`)
    }
  }
}

// ── list_directory ────────────────────────────────────────────────────────────

function formatListing(
  entries: { name: string; type: 'dir' | 'file' | 'symlink' }[],
  basePath: string,
): string {
  if (entries.length === 0)
    return '(empty directory)'
  const dirs = entries.filter(e => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter(e => e.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const lines = [`Directory: ${basePath}`, '']
  for (const d of dirs) lines.push(`  📁 ${d.name}/`)
  for (const f of files) lines.push(`  📄 ${f.name}`)
  return lines.join('\n')
}

export function createListDirectoryTool(projectPath: string) {
  return tool({
    description: `List files and directories inside a folder in the project.
Skips common build artefacts (node_modules, dist, .git, etc.) unless showHidden is true.
Call this before assuming anything about project structure.`,
    inputSchema: z.object({
      path: z.string().describe('Directory path relative to the project root. Use "." for root.'),
      showHidden: z.boolean().optional().describe('Include dotfiles/dotdirs. Default: false.'),
    }),
    execute: async ({ path: inputPath, showHidden = false }) => {
      let fullPath: string
      try { fullPath = await safePath(projectPath, inputPath) }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let raw: Awaited<ReturnType<typeof readDir>>
      try { raw = await readDir(fullPath) }
      catch (e) { return { error: `Cannot read "${inputPath}": ${e instanceof Error ? e.message : String(e)}` } }

      const entries = raw
        .filter(e => e.name && !shouldSkipEntry(e.name, showHidden))
        .map(e => ({
          name: e.name!,
          type: e.isDirectory ? 'dir' as const : e.isSymlink ? 'symlink' as const : 'file' as const,
        }))

      return { result: formatListing(entries, inputPath), count: entries.length }
    },
  })
}

// ── read_files ────────────────────────────────────────────────────────────────

export function createReadFilesTool(projectPath: string) {
  return tool({
    description: `Read the contents of one or more project files.
Batch multiple paths in a single call. Use offset/limit for large files (0-indexed lines).
Always read files before making claims about their contents.`,
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe('File paths relative to project root.'),
      offset: z.number().int().min(0).optional().describe('First line to read (0-indexed). Default: 0.'),
      limit: z.number().int().min(1).optional().describe('Max lines to read per file. Default: all.'),
    }),
    execute: async ({ paths, offset, limit }) => {
      const results: string[] = []
      const errors: string[] = []

      for (const inputPath of paths) {
        let fullPath: string
        try { fullPath = await safePath(projectPath, inputPath) }
        catch (e) { errors.push(`${inputPath}: ${e instanceof Error ? e.message : String(e)}`); continue }

        try {
          const raw = await readTextFile(fullPath)
          const lines = raw.split('\n')
          const start = offset ?? 0
          const sliced = limit != null ? lines.slice(start, start + limit) : lines.slice(start)
          const rangeLabel = (offset != null || limit != null)
            ? ` (lines ${start}–${start + sliced.length - 1})`
            : ` (${lines.length} lines)`
          results.push(`File: ${inputPath}${rangeLabel}\n${'─'.repeat(60)}\n${sliced.join('\n')}`)
        }
        catch (e) { errors.push(`${inputPath}: ${e instanceof Error ? e.message : String(e)}`) }
      }

      return { files: results, ...(errors.length > 0 ? { errors } : {}) }
    },
  })
}

// ── snapshot callback type ────────────────────────────────────────────────────

/**
 * Optional callback invoked BEFORE any file mutation so the checkpoint
 * system can capture the file's pre-mutation content.
 */
export type BeforeFileWriteCallback = (
  relativePath: string,
  absolutePath: string,
) => Promise<void>

// ── write_files ───────────────────────────────────────────────────────────────

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
          const lineCount = content.split('\n').length
          written.push(`${inputPath} (${lineCount} lines)`)
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${inputPath}: ${msg}`)
        }
      }

      return { written, ...(errors.length > 0 ? { errors } : {}) }
    },
  })
}

// ── edit_files ────────────────────────────────────────────────────────────────

export function createEditFilesTool(
  projectPath: string,
  onBeforeFileWrite?: BeforeFileWriteCallback,
) {
  return tool({
    description: `Make surgical string-replacement edits to existing files.
Each edit replaces an exact string with a new string — like a precise find-and-replace.
Batches multiple edits across multiple files in one call.
Use this instead of write_files when you want to change specific parts of a file
without rewriting the entire content. Safer for large files.

Rules:
- oldString must match EXACTLY as it appears in the file (including whitespace and indentation).
- Each oldString within a file must be unique — if it appears multiple times, be more specific.
- Multiple edits to the same file are applied in order, top to bottom.
- If any edit fails (oldString not found), that edit is reported as an error but others continue.`,
    inputSchema: z.object({
      edits: z.array(z.object({
        path: z.string().describe('File path relative to the project root.'),
        oldString: z.string().describe('Exact string to find and replace. Must be unique in the file.'),
        newString: z.string().describe('String to replace oldString with. Can be empty to delete.'),
      })).min(1).describe('List of edits to apply.'),
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

      return { edited, ...(errors.length > 0 ? { errors } : {}) }
    },
  })
}

// ── modify_files ──────────────────────────────────────────────────────────────
// Requires Tauri capabilities: fs:allow-rename, fs:allow-remove, fs:allow-copy-file

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
    description: `Perform file-system operations on files and directories in the project.
Supports: move, rename, delete, copy, mkdir.
Multiple operations are applied in order — batch them in one call.

Operations:
  move   — move a file or directory to a new location (creates destination parent dirs)
  rename — rename a file or directory in the same location (alias for move)
  delete — permanently delete a file or directory (use recursive:true for directories)
  copy   — copy a file to a new location (creates destination parent dirs)
  mkdir  — create a directory (and all parents)`,
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

// ── glob ──────────────────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  let src = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (pattern.slice(i, i + 2) === '**') {
      src += '.*'
      i += 2
      if (pattern[i] === '/')
        i++
    }
    else if (ch === '*') {
      src += '[^/]*'
      i++
    }
    else if (ch === '?') {
      src += '[^/]'
      i++
    }
    else if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) {
        src += '\\{'
        i++
        continue
      }
      const alts = pattern.slice(i + 1, end).split(',').map(a =>
        a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'),
      )
      src += `(?:${alts.join('|')})`
      i = end + 1
    }
    else if (ch === '[') {
      const end = pattern.indexOf(']', i)
      if (end === -1) {
        src += '\\['
        i++
        continue
      }
      src += pattern.slice(i, end + 1)
      i = end + 1
    }
    else {
      src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  src += '$'
  return new RegExp(src, 'i')
}

async function globWalk(
  absDir: string,
  relDir: string,
  regex: RegExp,
  results: string[],
  maxResults: number,
  showHidden: boolean,
): Promise<void> {
  if (results.length >= maxResults)
    return
  let entries: Awaited<ReturnType<typeof readDir>>
  try { entries = await readDir(absDir) }
  catch { return }

  for (const entry of entries) {
    if (!entry.name)
      continue
    if (!showHidden && entry.name.startsWith('.'))
      continue
    if (ALWAYS_SKIP.has(entry.name))
      continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = `${absDir}/${entry.name}`
    if (entry.isDirectory) {
      await globWalk(absPath, relPath, regex, results, maxResults, showHidden)
    }
    else if (regex.test(relPath)) {
      results.push(relPath)
      if (results.length >= maxResults)
        return
    }
  }
}

export function createGlobTool(projectPath: string) {
  return tool({
    description: `Find files in the project matching a glob pattern.
Supports * (any chars in segment), ** (any path depth), ?, {a,b}, [abc].
Build artefacts (node_modules, dist, .git, etc.) are always excluded.
Use this to locate files without knowing their exact path.`,
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern relative to project root. E.g. "**/*.ts", "src/**/*.vue"'),
      maxResults: z.number().int().min(1).max(500).optional().describe('Max results. Default: 100.'),
      showHidden: z.boolean().optional().describe('Include dotfiles. Default: false.'),
    }),
    execute: async ({ pattern, maxResults = 100, showHidden = false }) => {
      let rootPath: string
      try { rootPath = await safePath(projectPath, '.') }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let regex: RegExp
      try { regex = globToRegex(pattern) }
      catch (e) { return { error: `Invalid glob pattern: ${e instanceof Error ? e.message : String(e)}` } }

      const matches: string[] = []
      await globWalk(rootPath, '', regex, matches, maxResults, showHidden)
      const truncated = matches.length === maxResults
      return {
        pattern,
        matches,
        count: matches.length,
        ...(truncated ? { note: `Results capped at ${maxResults}. Use a more specific pattern.` } : {}),
      }
    },
  })
}

// ── grep ──────────────────────────────────────────────────────────────────────

interface GrepMatch { path: string; line: number; text: string }

async function grepFile(
  absPath: string,
  relPath: string,
  regex: RegExp,
  maxPerFile: number,
  results: GrepMatch[],
): Promise<void> {
  let content: string
  try { content = await readTextFile(absPath) }
  catch { return }
  const lines = content.split('\n')
  let count = 0
  for (let i = 0; i < lines.length && count < maxPerFile; i++) {
    regex.lastIndex = 0
    if (regex.exec(lines[i]!)) {
      results.push({ path: relPath, line: i + 1, text: lines[i]!.trimEnd() })
      count++
    }
  }
}

async function grepWalk(
  absDir: string,
  relDir: string,
  fileRegex: RegExp | null,
  contentRegex: RegExp,
  matches: GrepMatch[],
  maxTotal: number,
  maxPerFile: number,
  showHidden: boolean,
): Promise<void> {
  if (matches.length >= maxTotal)
    return
  let entries: Awaited<ReturnType<typeof readDir>>
  try { entries = await readDir(absDir) }
  catch { return }

  for (const entry of entries) {
    if (!entry.name)
      continue
    if (!showHidden && entry.name.startsWith('.'))
      continue
    if (ALWAYS_SKIP.has(entry.name))
      continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = `${absDir}/${entry.name}`
    if (entry.isDirectory) {
      await grepWalk(absPath, relPath, fileRegex, contentRegex, matches, maxTotal, maxPerFile, showHidden)
    }
    else {
      if (fileRegex && !fileRegex.test(entry.name))
        continue
      await grepFile(absPath, relPath, contentRegex, maxPerFile, matches)
      if (matches.length >= maxTotal)
        return
    }
  }
}

export function createGrepTool(projectPath: string) {
  return tool({
    description: `Search file contents using a regular expression.
Returns matching lines with file paths and line numbers.
Use this to find where a function is defined, locate usages, find config values, etc.`,
    inputSchema: z.object({
      pattern: z.string().describe('Regular expression. Standard JS regex syntax. Case-insensitive by default.'),
      path: z.string().optional().describe('Directory or file to search, relative to project root. Default: entire project.'),
      fileGlob: z.string().optional().describe('Restrict to files matching this glob. E.g. "*.ts".'),
      caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
      maxResults: z.number().int().min(1).max(1000).optional().describe('Max total matches. Default: 200.'),
      maxPerFile: z.number().int().min(1).max(100).optional().describe('Max matches per file. Default: 20.'),
    }),
    execute: async ({ pattern, path: inputPath = '.', fileGlob, caseSensitive = false, maxResults = 200, maxPerFile = 20 }) => {
      let rootPath: string
      try { rootPath = await safePath(projectPath, inputPath) }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let contentRegex: RegExp
      try { contentRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi') }
      catch (e) { return { error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` } }

      let fileRegex: RegExp | null = null
      if (fileGlob) {
        try { fileRegex = globToRegex(fileGlob) }
        catch { /* ignore */ }
      }

      const matches: GrepMatch[] = []
      let isFile = false
      try { await readDir(rootPath) }
      catch { isFile = true }

      if (isFile) {
        await grepFile(rootPath, inputPath, contentRegex, maxPerFile, matches)
      }
      else {
        await grepWalk(rootPath, inputPath === '.' ? '' : inputPath, fileRegex, contentRegex, matches, maxResults, maxPerFile, false)
      }

      const lines: string[] = []
      let lastPath = ''
      for (const m of matches) {
        if (m.path !== lastPath) {
          if (lastPath)
            lines.push('')
          lines.push(`${m.path}:`)
          lastPath = m.path
        }
        lines.push(`  ${String(m.line).padStart(4)} │ ${m.text}`)
      }

      return {
        pattern,
        totalMatches: matches.length,
        filesWithMatches: new Set(matches.map(m => m.path)).size,
        result: lines.join('\n') || '(no matches)',
        ...(matches.length >= maxResults ? { note: `Results capped at ${maxResults}.` } : {}),
      }
    },
  })
}

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

// ── display labels ────────────────────────────────────────────────────────────

export function toolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': {
      const p = String(args.path ?? '.')
      return p === '.' ? 'Listed root directory' : `Listed directory ${p}`
    }
    case 'read_files': {
      const paths = args.paths as string[] | undefined
      if (!paths?.length)
        return 'Read file'
      if (paths.length === 1)
        return `Read ${paths[0]}`
      if (paths.length <= 3)
        return `Read ${paths.join(', ')}`
      return `Read ${paths.length} files`
    }
    case 'write_files': {
      const files = args.files as { path: string }[] | undefined
      if (!files?.length)
        return 'Wrote file'
      if (files.length === 1)
        return `Wrote ${files[0]!.path}`
      if (files.length <= 3)
        return `Wrote ${files.map(f => f.path).join(', ')}`
      return `Wrote ${files.length} files`
    }
    case 'edit_files': {
      const edits = args.edits as { path: string }[] | undefined
      if (!edits?.length)
        return 'Edited file'
      const paths = [...new Set(edits.map(e => e.path))]
      if (paths.length === 1)
        return `Edited ${paths[0]}`
      if (paths.length <= 3)
        return `Edited ${paths.join(', ')}`
      return `Edited ${paths.length} files`
    }
    case 'modify_files': {
      const ops = args.operations as { op: string; from?: string; to?: string; path?: string }[] | undefined
      if (!ops?.length)
        return 'Modified files'
      if (ops.length === 1) {
        const o = ops[0]!
        if (o.op === 'delete')
          return `Deleted ${o.path}`
        if (o.op === 'move' || o.op === 'rename')
          return `${o.op === 'move' ? 'Moved' : 'Renamed'} ${o.from} → ${o.to}`
        if (o.op === 'copy')
          return `Copied ${o.from} → ${o.to}`
        if (o.op === 'mkdir')
          return `Created directory ${o.path}`
      }
      const opNames = ops.map(o => o.op)
      const unique = [...new Set(opNames)]
      return `${ops.length} file operations (${unique.join(', ')})`
    }
    case 'glob': return `Searched ${String(args.pattern ?? '*')}`
    case 'grep': {
      const inPath = args.path && args.path !== '.' ? ` in ${args.path}` : ''
      return `Searched for "${String(args.pattern ?? '')}"${inPath}`
    }
    default: return `Called ${toolName}`
  }
}
