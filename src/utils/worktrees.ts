import { mkdir, readDir } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'

interface GitResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface WorktreeStatus {
  branch: string | null
  isClean: boolean
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  aheadCount: number
  behindCount: number
  caution: string | null
  raw: string
}

export interface WorktreeEntry {
  path: string
  head: string | null
  branch: string | null
  isCurrent: boolean
  isMain: boolean
  isDetached: boolean
  isLocked: boolean
  isPrunable: boolean
  label: string
  status: WorktreeStatus | null
}

export interface WorktreeListResult {
  basePath: string
  repoCommonDir: string | null
  currentPath: string
  entries: WorktreeEntry[]
  isGitRepo: boolean
  error?: string
}

export interface WorkspaceSnapshot extends WorktreeStatus {
  path: string
  repoTopLevel: string | null
  repoCommonDir: string | null
  projectKey: string
  isGitRepo: boolean
  isWorktree: boolean
  label: string
}

export interface AgentWorktreeHandle {
  path: string
  branch: string
  basePath: string
}

const GIT_TIMEOUT_MS = 8000

function pathKey(path: string | null | undefined): string {
  return (path ?? '')
    .replace(/[\\/]+$/, '')
    .replaceAll('\\', '/')
    .toLowerCase()
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[/\\]/).pop() || path
}

function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  parts.pop()
  if (parts.length === 0)
    return trimmed
  const separator = trimmed.includes('\\') ? '\\' : '/'
  return parts.join(separator) || separator
}

function joinPath(base: string, ...parts: string[]): string {
  const separator = base.includes('\\') ? '\\' : '/'
  const normalizedBase = base.replace(/[\\/]+$/, '')
  const normalizedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''))
  return [normalizedBase, ...normalizedParts].filter(Boolean).join(separator)
}

function buildLabel(path: string, branch: string | null): string {
  const name = basename(path)
  return branch ? `${name} (${branch})` : name
}

function buildDirtyCaution(status: Omit<WorktreeStatus, 'caution' | 'raw'>): string | null {
  if (status.isClean)
    return null

  const parts: string[] = []
  if (status.stagedCount > 0)
    parts.push(`${status.stagedCount} staged`)
  if (status.unstagedCount > 0)
    parts.push(`${status.unstagedCount} unstaged`)
  if (status.untrackedCount > 0)
    parts.push(`${status.untrackedCount} untracked`)

  const summary = parts.length > 0 ? parts.join(', ') : 'uncommitted changes'
  return `Proceed with caution: ${summary}. Preserve unrelated edits and inspect diffs before overwriting files.`
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  const cmd = Command.create('git', args, { cwd })
  try {
    const output = await Promise.race([
      cmd.execute(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${GIT_TIMEOUT_MS / 1000}s`)), GIT_TIMEOUT_MS),
      ),
    ])

    return {
      exitCode: output.code,
      stdout: output.stdout.trim(),
      stderr: output.stderr.trim(),
    }
  }
  catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await readDir(path)
    return true
  }
  catch {
    return false
  }
}

function parseBranchLine(line: string): {
  branch: string | null
  aheadCount: number
  behindCount: number
} {
  const cleaned = line.replace(/^##\s*/, '').trim()
  const [branchPart = ''] = cleaned.split('...')
  const counts = cleaned.match(/\[(.+)\]/)?.[1] ?? ''

  const aheadCount = Number.parseInt(counts.match(/ahead (\d+)/)?.[1] ?? '0', 10)
  const behindCount = Number.parseInt(counts.match(/behind (\d+)/)?.[1] ?? '0', 10)

  if (branchPart === 'HEAD (no branch)')
    return { branch: null, aheadCount, behindCount }

  return {
    branch: branchPart || null,
    aheadCount,
    behindCount,
  }
}

function parseStatus(raw: string): WorktreeStatus {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const { branch, aheadCount, behindCount } = parseBranchLine(lines[0] ?? '')

  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0

  for (const line of lines.slice(1)) {
    if (line.startsWith('??')) {
      untrackedCount++
      continue
    }

    const staged = line[0] ?? ' '
    const unstaged = line[1] ?? ' '

    if (staged !== ' ')
      stagedCount++
    if (unstaged !== ' ')
      unstagedCount++
  }

  const baseStatus = {
    branch,
    isClean: stagedCount === 0 && unstagedCount === 0 && untrackedCount === 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
    aheadCount,
    behindCount,
  }

  return {
    ...baseStatus,
    caution: buildDirtyCaution(baseStatus),
    raw,
  }
}

async function inspectGitStatus(path: string): Promise<WorktreeStatus | null> {
  const result = await runGit(path, ['status', '--porcelain=v1', '--branch'])
  if (result.exitCode !== 0)
    return null
  return parseStatus(result.stdout)
}

function parseWorktreeList(raw: string, currentPath: string): Omit<WorktreeEntry, 'status'>[] {
  const blocks = raw
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)

  const currentKey = pathKey(currentPath)

  return blocks
    .map(block => {
      const lines = block.split(/\r?\n/)
      const pathLine = lines.find(line => line.startsWith('worktree '))
      if (!pathLine)
        return null

      const path = pathLine.slice('worktree '.length).trim()
      const branchRef = lines.find(line => line.startsWith('branch '))?.slice('branch '.length).trim() ?? null
      const branch = branchRef?.startsWith('refs/heads/')
        ? branchRef.slice('refs/heads/'.length)
        : branchRef

      return {
        path,
        head: lines.find(line => line.startsWith('HEAD '))?.slice('HEAD '.length).trim() ?? null,
        branch,
        isCurrent: pathKey(path) === currentKey,
        isMain: lines.includes('bare') === false && lines.includes('detached') === false && branch != null,
        isDetached: lines.includes('detached'),
        isLocked: lines.some(line => line.startsWith('locked')),
        isPrunable: lines.some(line => line.startsWith('prunable')),
        label: buildLabel(path, branch),
      }
    })
    .filter((entry): entry is Omit<WorktreeEntry, 'status'> => entry != null)
}

export async function inspectWorkspace(path: string | null): Promise<WorkspaceSnapshot | null> {
  if (!path)
    return null

  if (!await directoryExists(path)) {
    return {
      path,
      repoTopLevel: null,
      repoCommonDir: null,
      projectKey: pathKey(path) || 'missing-workspace',
      isGitRepo: false,
      isWorktree: false,
      label: buildLabel(path, null),
      branch: null,
      isClean: false,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      aheadCount: 0,
      behindCount: 0,
      caution: 'Proceed with caution: the selected workspace is no longer available on disk.',
      raw: '',
    }
  }

  const [topLevel, commonDir, status] = await Promise.all([
    runGit(path, ['rev-parse', '--path-format=absolute', '--show-toplevel']),
    runGit(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    inspectGitStatus(path),
  ])

  if (topLevel.exitCode !== 0 || commonDir.exitCode !== 0 || !status) {
    return {
      path,
      repoTopLevel: null,
      repoCommonDir: null,
      projectKey: pathKey(path),
      isGitRepo: false,
      isWorktree: false,
      label: buildLabel(path, null),
      branch: null,
      isClean: true,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      aheadCount: 0,
      behindCount: 0,
      caution: null,
      raw: '',
    }
  }

  const repoTopLevel = topLevel.stdout || path
  const repoCommonDir = commonDir.stdout || null

  return {
    path,
    repoTopLevel,
    repoCommonDir,
    projectKey: pathKey(repoCommonDir || repoTopLevel || path),
    isGitRepo: true,
    isWorktree: pathKey(repoTopLevel) !== pathKey(path) || Boolean(repoCommonDir),
    label: buildLabel(path, status.branch),
    ...status,
  }
}

export async function listWorktrees(basePath: string | null): Promise<WorktreeListResult | null> {
  if (!basePath)
    return null

  const currentPath = basePath
  const listResult = await runGit(basePath, ['worktree', 'list', '--porcelain'])

  if (listResult.exitCode !== 0) {
    const snapshot = await inspectWorkspace(basePath)
    return {
      basePath,
      currentPath,
      repoCommonDir: snapshot?.repoCommonDir ?? null,
      entries: snapshot
        ? [{
            path: snapshot.path,
            head: null,
            branch: snapshot.branch,
            isCurrent: true,
            isMain: true,
            isDetached: false,
            isLocked: false,
            isPrunable: false,
            label: snapshot.label,
            status: snapshot,
          }]
        : [],
      isGitRepo: snapshot?.isGitRepo ?? false,
      ...(snapshot?.isGitRepo
        ? {}
        : { error: listResult.stderr || 'This folder is not part of a git repository.' }),
    }
  }

  const baseEntries = parseWorktreeList(listResult.stdout, currentPath)
  const entries: WorktreeEntry[] = []

  for (const entry of baseEntries) {
    const status = await inspectGitStatus(entry.path)
    entries.push({ ...entry, status })
  }

  const repoCommonDir = entries.find(entry => entry.isCurrent)?.status
    ? (await inspectWorkspace(currentPath))?.repoCommonDir ?? null
    : null

  entries.sort((left, right) => {
    if (left.isCurrent)
      return -1
    if (right.isCurrent)
      return 1
    return left.path.localeCompare(right.path)
  })

  return {
    basePath,
    currentPath,
    repoCommonDir,
    entries,
    isGitRepo: true,
  }
}

export function buildWorkspacePromptContext(workspace: WorkspaceSnapshot | null): string {
  if (!workspace)
    return ''

  const lines = [
    '## Workspace Session',
    `Execution workspace: \`${workspace.path}\``,
  ]

  if (workspace.repoTopLevel && workspace.repoTopLevel !== workspace.path)
    lines.push(`Repository root: \`${workspace.repoTopLevel}\``)

  if (workspace.isGitRepo) {
    lines.push(`Git branch: ${workspace.branch ?? 'detached HEAD'}`)
    lines.push(`Git status: ${workspace.isClean ? 'clean' : 'dirty'}`)
    if (workspace.aheadCount > 0 || workspace.behindCount > 0)
      lines.push(`Remote divergence: ahead ${workspace.aheadCount}, behind ${workspace.behindCount}`)
    if (workspace.caution)
      lines.push(workspace.caution)
  }
  else {
    lines.push('Git status: not a git repository')
  }

  return lines.join('\n')
}

function sanitizeWorktreeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return slug || 'agent'
}

async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true })
  }
  catch {
    // Best effort only. git worktree add will surface a real error if the path
    // still cannot be created.
  }
}

async function findAvailableWorktreePath(root: string, slug: string): Promise<string> {
  let index = 0
  while (index < 50) {
    const candidate = joinPath(root, index === 0 ? slug : `${slug}-${index + 1}`)
    if (!await directoryExists(candidate))
      return candidate
    index++
  }

  return joinPath(root, `${slug}-${Date.now().toString(36)}`)
}

export async function createAgentWorktree(
  workspacePath: string,
  label: string,
): Promise<AgentWorktreeHandle | null> {
  const workspace = await inspectWorkspace(workspacePath)
  if (!workspace?.isGitRepo || !workspace.repoTopLevel)
    return null

  const repoContainer = dirname(workspace.repoTopLevel)
  const worktreeRoot = joinPath(repoContainer, '.emty-agent-worktrees', basename(workspace.repoTopLevel))
  const slug = sanitizeWorktreeSlug(label)

  await ensureDir(worktreeRoot)

  const worktreePath = await findAvailableWorktreePath(worktreeRoot, slug)
  const branch = `emty/subagent/${sanitizeWorktreeSlug(`${slug}-${Date.now().toString(36)}`)}`

  const addResult = await runGit(workspace.path, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'])
  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || 'Failed to create isolated git worktree')
  }

  return {
    path: worktreePath,
    branch,
    basePath: workspace.path,
  }
}

export async function cleanupAgentWorktree(
  handle: AgentWorktreeHandle,
): Promise<{ removed: boolean; kept: boolean; reason?: string }> {
  const status = await inspectGitStatus(handle.path)
  if (status && !status.isClean) {
    return {
      removed: false,
      kept: true,
      reason: `Kept isolated worktree with local changes at ${handle.path} on branch ${handle.branch}.`,
    }
  }

  const removeResult = await runGit(handle.basePath, ['worktree', 'remove', handle.path])
  if (removeResult.exitCode !== 0) {
    return {
      removed: false,
      kept: true,
      reason: removeResult.stderr || `Failed to remove isolated worktree at ${handle.path}.`,
    }
  }

  await runGit(handle.basePath, ['branch', '-D', handle.branch]).catch(() => ({
    exitCode: null,
    stdout: '',
    stderr: '',
  }))
  await runGit(handle.basePath, ['worktree', 'prune']).catch(() => ({
    exitCode: null,
    stdout: '',
    stderr: '',
  }))

  return {
    removed: true,
    kept: false,
  }
}
