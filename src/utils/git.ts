/**
 * src/utils/git.ts
 *
 * Git command wrappers for the Git GUI pane.
 * Uses the same `Command.create('git', args, { cwd })` pattern as `worktrees.ts`.
 *
 * All functions accept a `cwd` (working directory) and return typed results.
 * Operations have a configurable timeout (default 15s) to prevent hangs.
 */

import { Command } from '@tauri-apps/plugin-shell'

// ── constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000
const COMMIT_TIMEOUT_MS = 0
const REMOTE_TIMEOUT_MS = 2 * 60_000

// ── types ─────────────────────────────────────────────────────────────────────

export interface GitFileEntry {
  path: string
  oldPath: string | null
  indexStatus: string
  workdirStatus: string
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isConflict: boolean
  statusLabel: string
}

export interface GitStatusResult {
  branch: string | null
  upstream: string | null
  aheadCount: number
  behindCount: number
  files: GitFileEntry[]
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
  untracked: GitFileEntry[]
  conflicts: GitFileEntry[]
  isClean: boolean
}

export interface GitLogEntry {
  hash: string
  message: string
}

export interface GitCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut?: boolean
}

export interface GitCommitOptions {
  amend?: boolean
  skipHooks?: boolean
  timeoutMs?: number
}

export interface GitStashEntry {
  index: number
  ref: string
  branch: string
  message: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<GitCommandResult> {
  const cmd = Command.create('git', args, { cwd })
  try {
    const output = timeoutMs <= 0
      ? await cmd.execute()
      : await Promise.race([
          cmd.execute(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Git timed out after ${timeoutMs / 1000}s: git ${args.join(' ')}`)),
              timeoutMs,
            ),
          ),
        ])
    return {
      ok: output.code === 0,
      stdout: output.stdout.trim(),
      stderr: output.stderr.trim(),
      exitCode: output.code,
    }
  }
  catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: null,
      timedOut: error instanceof Error && error.message.startsWith('Git timed out after'),
    }
  }
}

// ── status label mapping ──────────────────────────────────────────────────────

function statusCodeToLabel(code: string): string {
  switch (code) {
    case 'M': return 'Modified'
    case 'T': return 'Type changed'
    case 'A': return 'Added'
    case 'D': return 'Deleted'
    case 'R': return 'Renamed'
    case 'C': return 'Copied'
    case 'U': return 'Conflict'
    case '?': return 'Untracked'
    case '!': return 'Ignored'
    default: return code || 'Unknown'
  }
}

// ── status parsing (porcelain v2) ─────────────────────────────────────────────

function parsePorcelainV2(raw: string): GitStatusResult {
  const lines = raw.split(/\r?\n/).filter(Boolean)

  let branch: string | null = null
  let upstream: string | null = null
  let aheadCount = 0
  let behindCount = 0
  const files: GitFileEntry[] = []

  for (const line of lines) {
    // Header lines
    if (line.startsWith('# branch.head ')) {
      const val = line.slice('# branch.head '.length)
      branch = val === '(detached)' ? null : val
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length)
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      if (match) {
        aheadCount = Number.parseInt(match[1]!, 10)
        behindCount = Number.parseInt(match[2]!, 10)
      }
      continue
    }
    // Skip other header lines
    if (line.startsWith('#'))
      continue

    // Ordinary changed entries: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
    if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(8).join(' ')
      const indexStatus = xy[0] === '.' ? '' : (xy[0] ?? '')
      const workdirStatus = xy[1] === '.' ? '' : (xy[1] ?? '')

      files.push({
        path,
        oldPath: null,
        indexStatus,
        workdirStatus,
        isStaged: indexStatus !== '' && indexStatus !== '?',
        isUnstaged: workdirStatus !== '' && workdirStatus !== '?',
        isUntracked: false,
        isConflict: false,
        statusLabel: statusCodeToLabel(indexStatus || workdirStatus),
      })
      continue
    }

    // Renamed/copied entries: "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>"
    if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const rest = parts.slice(9).join(' ')
      const tabIdx = rest.indexOf('\t')
      const path = tabIdx >= 0 ? rest.slice(0, tabIdx) : rest
      const oldPath = tabIdx >= 0 ? rest.slice(tabIdx + 1) : null
      const indexStatus = xy[0] === '.' ? '' : (xy[0] ?? '')
      const workdirStatus = xy[1] === '.' ? '' : (xy[1] ?? '')

      files.push({
        path,
        oldPath,
        indexStatus,
        workdirStatus,
        isStaged: indexStatus !== '',
        isUnstaged: workdirStatus !== '',
        isUntracked: false,
        isConflict: false,
        statusLabel: statusCodeToLabel(indexStatus || workdirStatus),
      })
      continue
    }

    // Unmerged entries: "u <XY> ..."
    if (line.startsWith('u ')) {
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      files.push({
        path,
        oldPath: null,
        indexStatus: 'U',
        workdirStatus: 'U',
        isStaged: false,
        isUnstaged: false,
        isUntracked: false,
        isConflict: true,
        statusLabel: 'Conflict',
      })
      continue
    }

    // Untracked entries: "? <path>"
    if (line.startsWith('? ')) {
      const path = line.slice(2)
      files.push({
        path,
        oldPath: null,
        indexStatus: '?',
        workdirStatus: '?',
        isStaged: false,
        isUnstaged: false,
        isUntracked: true,
        isConflict: false,
        statusLabel: 'Untracked',
      })
      continue
    }
  }

  const staged = files.filter(f => f.isStaged)
  const unstaged = files.filter(f => f.isUnstaged)
  const untracked = files.filter(f => f.isUntracked)
  const conflicts = files.filter(f => f.isConflict)
  const isClean = files.length === 0

  return {
    branch,
    upstream,
    aheadCount,
    behindCount,
    files,
    staged,
    unstaged,
    untracked,
    conflicts,
    isClean,
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Get full repository status with branch info and file lists. */
export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  const result = await runGit(cwd, ['status', '--porcelain=v2', '--branch'])
  if (!result.ok) {
    return {
      branch: null,
      upstream: null,
      aheadCount: 0,
      behindCount: 0,
      files: [],
      staged: [],
      unstaged: [],
      untracked: [],
      conflicts: [],
      isClean: true,
    }
  }
  return parsePorcelainV2(result.stdout)
}

/** Get the diff for a specific file. Pass `staged=true` for `--cached`. */
export async function gitDiff(
  cwd: string,
  file: string,
  staged = false,
): Promise<string> {
  const args = staged
    ? ['diff', '--cached', '--', file]
    : ['diff', '--', file]
  const result = await runGit(cwd, args)
  return result.stdout
}

/**
 * Produce a diff for an untracked file by diffing it against /dev/null.
 * This is used to display the contents of files that are not in the index.
 */
export async function gitDiffNoIndex(
  cwd: string,
  file: string,
): Promise<string> {
  // Compare against /dev/null so the output looks like a new file diff.
  // `--no-index` allows diffing arbitrary files even outside a git repo.
  const args = ['diff', '--no-index', '--', '/dev/null', file]
  const result = await runGit(cwd, args)
  return result.stdout
}

/** Get diff stat summary for the working tree. */
export async function gitDiffStat(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['diff', '--stat'])
  return result.stdout
}

/** Get the diff of all staged files. */
export async function gitDiffStaged(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['diff', '--cached'], 60_000)
  return result.stdout
}

/** Get a compact staged diff stat for commit review and prompt context. */
export async function gitDiffStagedStat(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['diff', '--cached', '--stat'], 60_000)
  return result.stdout
}

/** Stage specific files. */
export async function gitStage(cwd: string, files: string[]): Promise<GitCommandResult> {
  return runGit(cwd, ['add', '--', ...files])
}

/** Unstage specific files. */
export async function gitUnstage(cwd: string, files: string[]): Promise<GitCommandResult> {
  return runGit(cwd, ['restore', '--staged', '--', ...files])
}

/** Stage all changes (including untracked). */
export async function gitStageAll(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['add', '-A'])
}

/** Unstage all staged changes. */
export async function gitUnstageAll(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['reset', 'HEAD'])
}

/** Commit staged changes. */
export async function gitCommit(
  cwd: string,
  message: string,
  options: GitCommitOptions | boolean = {},
): Promise<GitCommandResult> {
  const normalized: GitCommitOptions = typeof options === 'boolean'
    ? { amend: options }
    : options
  const args = ['commit', '-m', message]
  if (normalized.amend)
    args.push('--amend')
  if (normalized.skipHooks)
    args.push('--no-verify')
  return runGit(cwd, args, normalized.timeoutMs ?? COMMIT_TIMEOUT_MS)
}

/**
 * Discard unstaged changes for tracked files.
 *
 * Uses `git restore -- <files>` where available, and falls back to
 * `git checkout -- <files>` on older Git versions for compatibility.
 */
export async function gitDiscard(cwd: string, files: string[]): Promise<GitCommandResult> {
  // Prefer `git restore` (introduced in Git 2.23). If it fails, fallback.
  let res = await runGit(cwd, ['restore', '--', ...files])
  if (!res.ok) {
    res = await runGit(cwd, ['checkout', '--', ...files])
  }
  return res
}

/**
 * Delete untracked files.
 *
 * `includeDirs` controls whether untracked directories are removed as well
 * (passes `-d` to `git clean`). Default is `false` to be conservative.
 */
export async function gitDiscardUntracked(cwd: string, files: string[], includeDirs = false): Promise<GitCommandResult> {
  const args = includeDirs ? ['clean', '-fd', '--', ...files] : ['clean', '-f', '--', ...files]
  return runGit(cwd, args)
}

/** Push to upstream. */
export async function gitPush(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['push'], REMOTE_TIMEOUT_MS)
}

/** Pull from upstream. */
export async function gitPull(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['pull', '--ff-only'], REMOTE_TIMEOUT_MS)
}

/** Fetch remote refs and prune deleted upstream branches. */
export async function gitFetch(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['fetch', '--prune'], REMOTE_TIMEOUT_MS)
}

/** Stash working changes. */
export async function gitStash(cwd: string, message?: string, includeUntracked = true): Promise<GitCommandResult> {
  const args = ['stash', 'push']
  if (includeUntracked)
    args.push('--include-untracked')
  if (message)
    args.push('-m', message)
  return runGit(cwd, args)
}

/** Pop the most recent stash. */
export async function gitStashPop(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ['stash', 'pop'])
}

/** List recent stashes. */
export async function gitStashList(cwd: string): Promise<GitStashEntry[]> {
  const result = await runGit(cwd, ['stash', 'list', '--format=%gd%x09%gs'], 10_000)
  if (!result.ok)
    return []

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [ref = '', message = ''] = line.split('\t')
      const match = ref.match(/^stash@\{(\d+)\}$/)
      const branchPrefix = 'On '
      const branchSeparator = message.indexOf(': ')
      const hasBranch = message.startsWith(branchPrefix) && branchSeparator > branchPrefix.length
      return {
        index: match ? Number.parseInt(match[1]!, 10) : 0,
        ref,
        branch: hasBranch ? message.slice(branchPrefix.length, branchSeparator) : '',
        message: hasBranch ? message.slice(branchSeparator + 2) : message,
      }
    })
}

/** Get recent commit log. */
export async function gitLog(cwd: string, n = 5): Promise<GitLogEntry[]> {
  const result = await runGit(cwd, ['log', '--oneline', `-${n}`])
  if (!result.ok)
    return []
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const spaceIdx = line.indexOf(' ')
      return {
        hash: spaceIdx >= 0 ? line.slice(0, spaceIdx) : line,
        message: spaceIdx >= 0 ? line.slice(spaceIdx + 1) : '',
      }
    })
}

/** Check if a directory is inside a git repository. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], 5000)
  return result.ok && result.stdout === 'true'
}
