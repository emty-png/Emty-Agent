import { exists, mkdir, readFile, remove, rename, stat, writeFile } from '@tauri-apps/plugin-fs'
import { hasBinaryExtension, isProbablyBinary } from './allowedPaths'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALWAYS_SKIP = new Set([
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

// ---------------------------------------------------------------------------
// Re-exports from allowedPaths for backward compatibility
// ---------------------------------------------------------------------------

export { safePath } from './allowedPaths'
export type { SandboxAccessKind } from './allowedPaths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineEnding = 'lf' | 'crlf' | 'cr'
export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be'

export interface TextFileSnapshot {
  absolutePath: string
  sizeBytes: number
  mtimeMs: number | null
  encoding: TextEncoding
  lineEnding: LineEnding
  content: string
  hash: string
}

export interface ReadRegistryEntry {
  hash: string
  complete: boolean
  mtimeMs: number | null
  sizeBytes: number
  /** 1-based line offset used for the read (undefined for writes). */
  offset?: number
  /** Line limit used for the read (undefined for writes). */
  limit?: number
}

export type FileReadRegistry = Map<string, ReadRegistryEntry>

/**
 * Optional callback invoked BEFORE any file mutation so the checkpoint
 * system can capture the file's pre-mutation content.
 * @param prefetchedContent — when provided, skips disk read:
 *   - `string` = file content (tool already loaded it)
 *   - `null`    = file doesn't exist yet
 *   - omit/undefined = callback reads from disk itself
 */
export type BeforeFileWriteCallback = (
  relativePath: string,
  absolutePath: string,
  prefetchedContent?: string | null,
) => Promise<void>

// ---------------------------------------------------------------------------
// Directory listing helpers
// ---------------------------------------------------------------------------

export function shouldSkipEntry(name: string, showHidden: boolean): boolean {
  if (ALWAYS_SKIP.has(name))
    return true
  if (!showHidden && name.startsWith('.'))
    return true
  return false
}

// ---------------------------------------------------------------------------
// Line ending & encoding utils
// ---------------------------------------------------------------------------

export function detectLineEnding(text: string): LineEnding {
  if (text.includes('\r\n'))
    return 'crlf'
  if (text.includes('\r'))
    return 'cr'
  return 'lf'
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function applyLineEnding(text: string, lineEnding: LineEnding): string {
  const normalized = normalizeLineEndings(text)
  switch (lineEnding) {
    case 'crlf':
      return normalized.replace(/\n/g, '\r\n')
    case 'cr':
      return normalized.replace(/\n/g, '\r')
    default:
      return normalized
  }
}

export function countLines(text: string): number {
  if (text.length === 0)
    return 0
  return normalizeLineEndings(text).split('\n').length
}

export function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

export function parentDirPath(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  const lastBackslash = path.lastIndexOf('\\')
  const separatorIndex = Math.max(lastSlash, lastBackslash)
  if (separatorIndex < 0)
    return ''

  const parent = path.slice(0, separatorIndex)
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent
}

export function detectTextEncoding(bytes: Uint8Array): TextEncoding {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE)
      return 'utf16le'
    if (bytes[0] === 0xFE && bytes[1] === 0xFF)
      return 'utf16be'
  }
  return 'utf8'
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const offset = bytes.length >= 2 ? 2 : 0
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.max(0, bytes.byteLength - offset))
  const chunks: string[] = []
  const chunkSize = 8192

  for (let i = 0; i + 1 < view.byteLength; i += chunkSize * 2) {
    const codeUnits: number[] = []
    const end = Math.min(view.byteLength, i + chunkSize * 2)
    for (let j = i; j + 1 < end; j += 2)
      codeUnits.push(view.getUint16(j, littleEndian))
    chunks.push(String.fromCharCode(...codeUnits))
  }

  return chunks.join('')
}

export function decodeTextBytes(bytes: Uint8Array): { content: string; encoding: TextEncoding } {
  const encoding = detectTextEncoding(bytes)
  if (encoding === 'utf16le')
    return { content: decodeUtf16(bytes, true), encoding }
  if (encoding === 'utf16be')
    return { content: decodeUtf16(bytes, false), encoding }
  return { content: new TextDecoder().decode(bytes), encoding }
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = littleEndian ? 0xFF : 0xFE
  bytes[1] = littleEndian ? 0xFE : 0xFF
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const base = 2 + i * 2
    if (littleEndian) {
      bytes[base] = code & 0xFF
      bytes[base + 1] = code >> 8
    }
    else {
      bytes[base] = code >> 8
      bytes[base + 1] = code & 0xFF
    }
  }
  return bytes
}

export function encodeTextBytes(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === 'utf16le')
    return encodeUtf16(text, true)
  if (encoding === 'utf16be')
    return encodeUtf16(text, false)
  return new TextEncoder().encode(text)
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export async function pathExists(absolutePath: string): Promise<boolean> {
  return await exists(absolutePath)
}

export async function ensureDir(absoluteDirPath: string): Promise<void> {
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

export async function readTextSnapshot(absolutePath: string): Promise<TextFileSnapshot> {
  const before = await stat(absolutePath)
  if (!before.isFile)
    throw new Error('Path is not a regular file')

  const bytes = await readFile(absolutePath)
  const after = await stat(absolutePath)
  if (!after.isFile)
    throw new Error('Path is not a regular file')

  const beforeMtime = before.mtime?.getTime() ?? null
  const afterMtime = after.mtime?.getTime() ?? null
  if (before.size !== after.size || (beforeMtime !== null && afterMtime !== null && beforeMtime !== afterMtime))
    throw new Error('File changed while it was being read. Try reading it again.')

  const encoding = detectTextEncoding(bytes)
  if (hasBinaryExtension(absolutePath) || (encoding === 'utf8' && isProbablyBinary(bytes)))
    throw new Error('Binary files are not supported by this tool')

  const { content } = decodeTextBytes(bytes)
  const normalized = normalizeLineEndings(content)
  return {
    absolutePath,
    sizeBytes: after.size,
    mtimeMs: afterMtime,
    encoding,
    lineEnding: detectLineEnding(content),
    content: normalized,
    hash: await sha256Text(normalized),
  }
}

export async function writeEncodedTextFile(
  absolutePath: string,
  diskContent: string,
  encoding: TextEncoding,
): Promise<void> {
  const lastSlash = absolutePath.lastIndexOf('/')
  const lastBackslash = absolutePath.lastIndexOf('\\')
  const separatorIndex = Math.max(lastSlash, lastBackslash)
  const parent = separatorIndex >= 0 ? absolutePath.slice(0, separatorIndex + 1) : ''
  const name = separatorIndex >= 0 ? absolutePath.slice(separatorIndex + 1) : absolutePath
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tempPath = `${parent}.${name}.${suffix}.tmp`

  try {
    await writeFile(tempPath, encodeTextBytes(diskContent, encoding))
    await rename(tempPath, absolutePath)
  }
  catch (e) {
    await remove(tempPath).catch(() => {})
    throw e
  }
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

type DiffOpType = 'ctx' | 'add' | 'del'

interface LineDiffOp {
  type: DiffOpType
  oldLine: number | null
  newLine: number | null
  text: string
}

interface DiffHunk {
  oldStart: number
  newStart: number
  oldCount: number
  newCount: number
  ops: LineDiffOp[]
}

const MAX_EXACT_DIFF_CELLS = 2_000_000

function splitDiffLines(text: string): string[] {
  return text.length === 0 ? [] : normalizeLineEndings(text).split('\n')
}

function buildReplacementOps(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number,
): LineDiffOp[] {
  return [
    ...oldLines.map((line, index): LineDiffOp => ({
      type: 'del',
      oldLine: oldOffset + index + 1,
      newLine: null,
      text: line,
    })),
    ...newLines.map((line, index): LineDiffOp => ({
      type: 'add',
      oldLine: null,
      newLine: newOffset + index + 1,
      text: line,
    })),
  ]
}

function buildExactMiddleOps(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number,
): LineDiffOp[] {
  if (oldLines.length === 0) {
    return newLines.map((line, index): LineDiffOp => ({
      type: 'add',
      oldLine: null,
      newLine: newOffset + index + 1,
      text: line,
    }))
  }

  if (newLines.length === 0) {
    return oldLines.map((line, index): LineDiffOp => ({
      type: 'del',
      oldLine: oldOffset + index + 1,
      newLine: null,
      text: line,
    }))
  }

  const cellCount = (oldLines.length + 1) * (newLines.length + 1)
  if (cellCount > MAX_EXACT_DIFF_CELLS)
    return buildReplacementOps(oldLines, newLines, oldOffset, newOffset)

  const width = newLines.length + 1
  const table = new Uint32Array((oldLines.length + 1) * width)

  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      table[i * width + j] = oldLines[i] === newLines[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }

  const ops: LineDiffOp[] = []
  let i = 0
  let j = 0

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({
        type: 'ctx',
        oldLine: oldOffset + i + 1,
        newLine: newOffset + j + 1,
        text: oldLines[i]!,
      })
      i++
      j++
    }
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push({
        type: 'del',
        oldLine: oldOffset + i + 1,
        newLine: null,
        text: oldLines[i]!,
      })
      i++
    }
    else {
      ops.push({
        type: 'add',
        oldLine: null,
        newLine: newOffset + j + 1,
        text: newLines[j]!,
      })
      j++
    }
  }

  while (i < oldLines.length) {
    ops.push({
      type: 'del',
      oldLine: oldOffset + i + 1,
      newLine: null,
      text: oldLines[i]!,
    })
    i++
  }

  while (j < newLines.length) {
    ops.push({
      type: 'add',
      oldLine: null,
      newLine: newOffset + j + 1,
      text: newLines[j]!,
    })
    j++
  }

  return ops
}

function createLineDiffOps(oldText: string, newText: string): LineDiffOp[] {
  const oldLines = splitDiffLines(oldText)
  const newLines = splitDiffLines(newText)

  let prefix = 0
  while (
    prefix < oldLines.length
    && prefix < newLines.length
    && oldLines[prefix] === newLines[prefix]
  ) {
    prefix++
  }

  let oldSuffix = oldLines.length - 1
  let newSuffix = newLines.length - 1
  while (
    oldSuffix >= prefix
    && newSuffix >= prefix
    && oldLines[oldSuffix] === newLines[newSuffix]
  ) {
    oldSuffix--
    newSuffix--
  }

  const ops: LineDiffOp[] = []
  for (let i = 0; i < prefix; i++) {
    ops.push({
      type: 'ctx',
      oldLine: i + 1,
      newLine: i + 1,
      text: oldLines[i]!,
    })
  }

  ops.push(...buildExactMiddleOps(
    oldLines.slice(prefix, oldSuffix + 1),
    newLines.slice(prefix, newSuffix + 1),
    prefix,
    prefix,
  ))

  const suffixLength = oldLines.length - oldSuffix - 1
  for (let i = suffixLength; i > 0; i--) {
    const oldIndex = oldLines.length - i
    const newIndex = newLines.length - i
    ops.push({
      type: 'ctx',
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: oldLines[oldIndex]!,
    })
  }

  return ops
}

export function diffLineStats(oldText: string, newText: string): {
  added: number
  removed: number
} {
  const ops = createLineDiffOps(oldText, newText)
  return {
    added: ops.filter(op => op.type === 'add').length,
    removed: ops.filter(op => op.type === 'del').length,
  }
}

function buildDiffHunks(ops: LineDiffOp[], contextLines: number): DiffHunk[] {
  const changeIndexes = ops
    .map((op, index) => op.type === 'ctx' ? -1 : index)
    .filter(index => index >= 0)

  if (changeIndexes.length === 0)
    return []

  const ranges: Array<{ start: number; end: number }> = []
  for (const index of changeIndexes) {
    const start = Math.max(0, index - contextLines)
    const end = Math.min(ops.length - 1, index + contextLines)
    const last = ranges.at(-1)
    if (last && start <= last.end + 1)
      last.end = Math.max(last.end, end)
    else
      ranges.push({ start, end })
  }

  return ranges.map(range => {
    const hunkOps = ops.slice(range.start, range.end + 1)
    const firstOld = hunkOps.find(op => op.oldLine !== null)?.oldLine ?? 0
    const firstNew = hunkOps.find(op => op.newLine !== null)?.newLine ?? 0
    const oldCount = hunkOps.filter(op => op.type !== 'add').length
    const newCount = hunkOps.filter(op => op.type !== 'del').length

    return {
      oldStart: firstOld,
      newStart: firstNew,
      oldCount,
      newCount,
      ops: hunkOps,
    }
  })
}

export function createUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  options: {
    contextLines?: number
    /** When set, omit changed lines beyond this count. Unset = full diff (UI review). */
    maxChangedLines?: number
  } = {},
): string {
  const contextLines = options.contextLines ?? 3
  const maxChangedLines = options.maxChangedLines
  const ops = createLineDiffOps(oldText, newText)
  const hunks = buildDiffHunks(ops, contextLines)
  if (hunks.length === 0)
    return ''

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ]
  let changedLines = 0
  let omitted = 0

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)

    for (const op of hunk.ops) {
      if (op.type !== 'ctx') {
        if (maxChangedLines != null && changedLines >= maxChangedLines) {
          omitted++
          continue
        }
        changedLines++
      }

      const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '
      lines.push(`${prefix}${op.text}`)
    }
  }

  if (omitted > 0)
    lines.push(`...[${omitted} changed lines omitted]`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Read registry (write-validation for edit tool)
// ---------------------------------------------------------------------------

export function updateReadRegistry(
  registry: FileReadRegistry,
  absolutePath: string,
  entry: ReadRegistryEntry,
): void {
  registry.set(absolutePath, entry)
}

export async function rememberWrittenFile(
  registry: FileReadRegistry,
  absolutePath: string,
  content: string,
  sizeBytes: number,
  mtimeMs: number | null,
): Promise<void> {
  updateReadRegistry(registry, absolutePath, {
    hash: await sha256Text(normalizeLineEndings(content)),
    complete: true,
    sizeBytes,
    mtimeMs,
  })
}
