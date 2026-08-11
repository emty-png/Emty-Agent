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

const NUMBERED_LINE_PATTERN = /^\s*\d+(?:\t|\s*\|\s?)/gm

const CURLY_TO_STRAIGHT: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
}

interface EditFileResult {
  file: string
  status: 'success' | 'error'
  message: string
  added?: number
  removed?: number
  diff?: string
}

interface EditInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all: boolean
}

interface PreparedEdit {
  oldString: string
  newString: string
  actualOld: string | null
  usedStrippedLineNumbers: boolean
}

function normalizeQuotes(str: string): string {
  return str.replace(/[\u2018\u2019\u201C\u201D]/g, ch => CURLY_TO_STRAIGHT[ch]!)
}

function findActualString(fileContent: string, searchString: string): string | null {
  if (searchString === '')
    return ''

  if (fileContent.includes(searchString))
    return searchString

  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const idx = normalizedFile.indexOf(normalizedSearch)
  if (idx !== -1)
    return fileContent.substring(idx, idx + searchString.length)

  return null
}

function stripLineNumbers(text: string): string {
  return text.replace(NUMBERED_LINE_PATTERN, '')
}

function countOccurrences(content: string, needle: string): number {
  if (!needle)
    return 0

  let count = 0
  let from = 0
  while (from <= content.length) {
    const idx = content.indexOf(needle, from)
    if (idx === -1)
      break
    count++
    from = idx + needle.length
  }
  return count
}

function prepareEdit(fileBuffer: string, oldString: string, newString: string): PreparedEdit {
  const normalizedOld = normalizeLineEndings(oldString)
  const normalizedNew = normalizeLineEndings(newString)
  const actualOld = findActualString(fileBuffer, normalizedOld)
  if (actualOld !== null) {
    return {
      oldString: normalizedOld,
      newString: normalizedNew,
      actualOld,
      usedStrippedLineNumbers: false,
    }
  }

  const strippedOld = stripLineNumbers(normalizedOld)
  const strippedNew = stripLineNumbers(normalizedNew)
  const strippedActualOld = strippedOld !== normalizedOld
    ? findActualString(fileBuffer, strippedOld)
    : null

  return {
    oldString: strippedOld,
    newString: strippedNew,
    actualOld: strippedActualOld,
    usedStrippedLineNumbers: strippedActualOld !== null,
  }
}

async function processFile(
  filePath: string,
  edits: EditInput[],
  projectPath: string,
  registry: FileReadRegistry,
  onBeforeFileWrite: BeforeFileWriteCallback | undefined,
  lockManager: FileLockManager,
): Promise<EditFileResult> {
  let fullPath: string
  try {
    fullPath = await safePath(projectPath, filePath, { kind: 'write' })
  }
  catch (e) {
    return { file: filePath, status: 'error', message: `Path error: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (hasBinaryExtension(filePath))
    return { file: filePath, status: 'error', message: 'Cannot edit binary files' }

  return lockManager.withLock(fullPath, async () => {
    const info = await stat(fullPath).catch(() => null)
    if (info && !info.isFile)
      return { file: filePath, status: 'error', message: `${filePath} is not a regular file.` }

    const fileExists = info !== null
    let fileBuffer = ''
    let originalContent = ''
    let diskLineEnding: LineEnding = 'lf'
    let diskEncoding: TextEncoding = 'utf8'

    if (fileExists) {
      const registryEntry = registry.get(fullPath)
      if (!registryEntry) {
        return {
          file: filePath,
          status: 'error',
          message: 'File has not been read yet. Call read_files first before editing.',
        }
      }

      let snapshot: Awaited<ReturnType<typeof readTextSnapshot>>
      try {
        snapshot = await readTextSnapshot(fullPath)
      }
      catch (e) {
        return { file: filePath, status: 'error', message: `Failed to read file: ${e instanceof Error ? e.message : String(e)}` }
      }

      const mtimesMatch = registryEntry.mtimeMs !== null
        && snapshot.mtimeMs !== null
        && registryEntry.mtimeMs === snapshot.mtimeMs
      if (!mtimesMatch && registryEntry.hash !== snapshot.hash) {
        return {
          file: filePath,
          status: 'error',
          message: 'File has been modified since last read. Re-read with read_files before editing.',
        }
      }

      fileBuffer = snapshot.content
      originalContent = snapshot.content
      diskLineEnding = snapshot.lineEnding
      diskEncoding = snapshot.encoding
    }
    else {
      const firstOld = edits[0] ? stripLineNumbers(normalizeLineEndings(edits[0].old_string)) : null
      if (firstOld !== '')
        return { file: filePath, status: 'error', message: `File does not exist: ${filePath}` }
    }

    if (fileExists && fileBuffer.length > 0 && edits.length > 0) {
      const firstOld = stripLineNumbers(normalizeLineEndings(edits[0]!.old_string))
      if (firstOld === '') {
        return {
          file: filePath,
          status: 'error',
          message: `Cannot create new file - ${filePath} already exists and is not empty. Use edit_files with an actual old_string, or write_file to overwrite it.`,
        }
      }
    }

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!
      const editIndex = i + 1
      const snippet = normalizeLineEndings(edit.old_string).slice(0, 30).replace(/\n/g, '\\n')
      const prepared = prepareEdit(fileBuffer, edit.old_string, edit.new_string)

      if (prepared.oldString === prepared.newString)
        continue

      if (prepared.actualOld === null) {
        const hint = prepared.usedStrippedLineNumbers ? ' after removing copied line numbers' : ''
        return {
          file: filePath,
          status: 'error',
          message: `Edit #${editIndex} failed: old_string starting with '${snippet}...' not found in file${hint}. No edits applied to this file. Check exact wording and read file again if necessary.`,
        }
      }

      if (prepared.actualOld === '') {
        if (fileBuffer.length > 0) {
          return {
            file: filePath,
            status: 'error',
            message: `Edit #${editIndex} failed: empty old_string can only create or replace an empty file. No edits applied to this file.`,
          }
        }
        fileBuffer = prepared.newString
        continue
      }

      if (!edit.replace_all) {
        const count = countOccurrences(fileBuffer, prepared.actualOld)
        if (count > 1) {
          return {
            file: filePath,
            status: 'error',
            message: `Edit #${editIndex} failed: old_string starting with '${snippet}...' was found ${count} times. Include more surrounding lines to uniquely identify the target. No edits applied to this file.`,
          }
        }
      }

      fileBuffer = edit.replace_all
        ? fileBuffer.split(prepared.actualOld).join(prepared.newString)
        : fileBuffer.replace(prepared.actualOld, prepared.newString)
    }

    const parentDir = parentDirPath(fullPath)
    if (parentDir) {
      try {
        await ensureDir(parentDir)
      }
      catch (e) {
        return { file: filePath, status: 'error', message: `Failed to create directories: ${e instanceof Error ? e.message : String(e)}` }
      }
    }

    const shouldWrite = !fileExists || fileBuffer !== originalContent
    if (shouldWrite) {
      if (onBeforeFileWrite) {
        try {
          await onBeforeFileWrite(filePath, fullPath, fileExists ? originalContent : null)
        }
        catch (e) {
          return { file: filePath, status: 'error', message: `Failed to checkpoint file: ${e instanceof Error ? e.message : String(e)}` }
        }
      }

      try {
        await writeEncodedTextFile(fullPath, applyLineEnding(fileBuffer, diskLineEnding), diskEncoding)
      }
      catch (e) {
        return { file: filePath, status: 'error', message: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` }
      }
    }

    try {
      const newInfo = await stat(fullPath)
      const updatedEntry = {
        hash: await sha256Text(fileBuffer),
        complete: true,
        sizeBytes: newInfo.size,
        mtimeMs: newInfo.mtime?.getTime() ?? null,
      }
      updateReadRegistry(registry, fullPath, updatedEntry)
    }
    catch { /* non-fatal */ }

    const { added, removed } = diffLineStats(originalContent, fileBuffer)

    return {
      file: filePath,
      status: 'success',
      message: `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} sequentially.`,
      added,
      removed,
      diff: createUnifiedDiff(filePath, originalContent, fileBuffer),
    }
  })
}

export function createEditFilesTool(
  projectPath: string,
  registry: FileReadRegistry,
  onBeforeFileWrite: BeforeFileWriteCallback | undefined,
  lockManager: FileLockManager,
) {
  return tool({
    description: `Apply one or more search-and-replace edits to existing files. Edits for each file are applied in order; if one fails, all edits for that file are rolled back.

Always call read_files and wait for its result before editing a file. Calling read and edit in parallel on the same file path is not allowed. Reading one file while editing a different file is fine.

Prefer this tool over write_file for modifying existing files.

Rules:
- old_string must exactly match the target text, including whitespace and indentation.
- old_string must be unique within the file. If it matches multiple locations, expand it to include more context.
- Set replace_all: true to replace every occurrence intentionally.
- To create a new file, use old_string: "" on a path that does not exist yet.`,

    inputSchema: z.object({
      edits: z
        .array(
          z.object({
            file_path: z
              .string()
              .describe('Path of the file to edit (absolute or relative to the project root). Must have been read with read_files before this call.'),
            old_string: z
              .string()
              .describe('Exact text to find and replace. Must match character-for-character including whitespace. Include enough context to make it unique in the file. Empty string only when creating a new file.'),
            new_string: z
              .string()
              .describe('Text to replace old_string with. Pass an empty string to delete old_string.'),
            replace_all: z
              .boolean()
              .optional()
              .default(false)
              .describe('If true, replaces every occurrence of old_string. If false (default) and old_string appears more than once, the edit is rejected — make old_string more specific instead.'),
          }),
        )
        .min(1)
        .describe('List of edit operations. Multiple edits on the same file are applied in order.'),
    }),

    execute: async ({ edits }) => {
      const grouped = new Map<string, EditInput[]>()
      for (const edit of edits) {
        const existing = grouped.get(edit.file_path)
        if (existing)
          existing.push(edit)
        else
          grouped.set(edit.file_path, [edit])
      }

      const results: EditFileResult[] = []
      let totalAdded = 0
      let totalRemoved = 0

      for (const [filePath, fileEdits] of grouped) {
        const result = await processFile(filePath, fileEdits, projectPath, registry, onBeforeFileWrite, lockManager)
        results.push(result)
        if (result.status === 'success') {
          totalAdded += result.added ?? 0
          totalRemoved += result.removed ?? 0
        }
      }

      const failed = results.filter(r => r.status === 'error')
      const succeeded = results.filter(r => r.status === 'success')

      let message: string
      if (failed.length === 0) {
        message = `Successfully applied edits to ${succeeded.length} file${succeeded.length > 1 ? 's' : ''}.`
      }
      else if (succeeded.length === 0) {
        message = `All edits failed:\n${failed.map(r => `  ${r.file}: ${r.message}`).join('\n')}`
      }
      else {
        message = `Applied edits to ${succeeded.length} file${succeeded.length > 1 ? 's' : ''}. ${failed.length} failed:\n${failed.map(r => `  ${r.file}: ${r.message}`).join('\n')}`
      }

      return {
        message,
        added: totalAdded,
        removed: totalRemoved,
        diff: succeeded.map(r => r.diff).filter(Boolean).join('\n\n'),
        files: results,
      }
    },
  })
}
