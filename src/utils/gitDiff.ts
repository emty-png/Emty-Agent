import type { GitFileEntry } from '@/utils/git'

export type DiffLineType = 'ctx' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  oldLine: string
  newLine: string
  text: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export type DiffBlockType = 'ctx' | 'changes'

export interface DiffBlock {
  type: DiffBlockType
  lines: DiffLine[]
  expanded: boolean
}

export interface ParsedDiff {
  header: string
  blocks: DiffBlock[]
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parses a raw unified diff (as produced by `git diff`) into hunks of
 * typed, line-numbered entries. Returns an empty array for blank/binary
 * diffs rather than throwing.
 */
export function parseUnifiedDiff(raw: string): DiffHunk[] {
  if (!raw)
    return []

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++'))
      continue

    if (line.startsWith('@@')) {
      const match = HUNK_HEADER_PATTERN.exec(line)
      if (!match)
        continue
      oldLine = Number.parseInt(match[1]!, 10)
      newLine = Number.parseInt(match[2]!, 10)
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
      continue
    }

    if (!currentHunk || line.startsWith('\\ No newline'))
      continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldLine: '', newLine: String(newLine++), text: line.slice(1) })
    }
    else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldLine: String(oldLine++), newLine: '', text: line.slice(1) })
    }
    else if (line.startsWith(' ') || line === '') {
      const text = line.startsWith(' ') ? line.slice(1) : line
      currentHunk.lines.push({ type: 'ctx', oldLine: String(oldLine++), newLine: String(newLine++), text })
    }
  }

  return hunks
}

/**
 * Groups a hunk's lines into collapsible blocks: consecutive unchanged
 * ("context") lines are grouped separately from consecutive add/delete
 * lines so the UI can collapse long unchanged runs.
 */
export function groupHunkIntoBlocks(hunk: DiffHunk): DiffBlock[] {
  const blocks: DiffBlock[] = []
  let currentType: DiffBlockType | null = null
  let currentLines: DiffLine[] = []

  const flush = () => {
    if (currentType && currentLines.length > 0)
      blocks.push({ type: currentType, lines: currentLines, expanded: false })
  }

  for (const line of hunk.lines) {
    const type: DiffBlockType = line.type === 'ctx' ? 'ctx' : 'changes'
    if (type !== currentType) {
      flush()
      currentType = type
      currentLines = [line]
    }
    else {
      currentLines.push(line)
    }
  }
  flush()

  return blocks
}

/** Parses a raw diff directly into render-ready, block-grouped hunks. */
export function parseDiffForDisplay(raw: string): ParsedDiff[] {
  return parseUnifiedDiff(raw).map(hunk => ({
    header: hunk.header,
    blocks: groupHunkIntoBlocks(hunk),
  }))
}

export type FileChangeKind = 'added' | 'deleted' | 'modified'

function resolveEffectiveStatus(file: GitFileEntry): string {
  return file.indexStatus && file.indexStatus !== ' ' ? file.indexStatus : file.workdirStatus
}

/** Classifies a git file entry's status for icon/color purposes. */
export function getFileChangeKind(file: GitFileEntry): FileChangeKind {
  const status = resolveEffectiveStatus(file)
  if (status === 'D')
    return 'deleted'
  if (status === '?' || status === 'A')
    return 'added'
  return 'modified'
}

const FILE_CHANGE_LABELS: Record<FileChangeKind, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
}

/** Single-letter status label (A/M/D) shown next to a file in the changes list. */
export function getFileStatusLabel(file: GitFileEntry): string {
  return FILE_CHANGE_LABELS[getFileChangeKind(file)]
}
