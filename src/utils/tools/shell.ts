/**
 * src/utils/tools/shell.ts
 *
 * Production-grade shell tooling for the Emty coding agent.
 *   • run_command — execute shell commands, manage long-running tasks
 *   • git_command — execute git operations with the same tracked runtime
 *
 * All command executions are registered in a shared task runtime so the UI can
 * inspect and stop both foreground and background work.
 */

import { homeDir } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { Child, Command } from '@tauri-apps/plugin-shell'
import { tool } from 'ai'
import { readonly, ref, shallowRef } from 'vue'
import { z } from 'zod'
import { isShellCommandBlocked, SHELL_BLOCKED_MESSAGE } from '@/utils/security/securityConfigs'
import { safePath } from './fs/allowedPaths'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

const CO_AUTHOR_TRAILER = 'Co-authored-by: Emty Agent <289245867+emty-agent@users.noreply.github.com>'

const MAX_OUTPUT_CHARS = 32_000
const MAX_TRACKED_TASKS = 40
const MAX_WAIT_MS = 300_000
const MAX_OUTPUT_LINES = 500
const MAX_LOG_FILES = 20

type ShellBinary = 'sh' | 'powershell' | 'pwsh' | 'git-bash' | 'git-bash-x86'
type GitBashShell = Extract<ShellBinary, 'git-bash' | 'git-bash-x86'>
type CommandTaskKind = 'shell' | 'git'
type CommandTaskMode = 'exec' | 'background'
type CommandTaskStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timed_out'
type CommandResultStatus = 'completed' | 'failed' | 'killed' | 'timed_out' | 'spawn_error'
type ManagedCommandAction = 'exec' | 'start' | 'status' | 'kill' | 'list'

interface ResolvedShellCommand {
  binary: ShellBinary
  args: string[]
}

interface CommandResult {
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  status: CommandResultStatus
}

interface CommandTaskRecord {
  id: string
  tabId: string | null
  kind: CommandTaskKind
  mode: CommandTaskMode
  label: string | null
  summary: string
  cwd: string
  status: CommandTaskStatus
  commandCount: number
  completedCommands: number
  currentCommand: string | null
  stdout: string
  stderr: string
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
  results: CommandResult[]
}

interface CommandTaskHandle {
  child: Child | null
  pid: number | null
  stopRequested: boolean
  timeoutRequested: boolean
  resolveCompletion: ((value: CommandCompletionSignal) => void) | null
  /** Resolved once the child process has spawned (PID assigned) or failed to spawn. */
  resolveSpawn: (() => void) | null
}

interface CommandCompletionSignal {
  code: number | null
  spawnError?: string
  timedOut?: boolean
}

export interface ShellToolRuntimeEvents {
  onOutput?: (event: {
    toolName: 'run_command' | 'git_command'
    toolCallId?: string
    stream: 'stdout' | 'stderr'
    chunk: string
  }) => void
}

export interface CommandTaskSummary {
  id: string
  tabId: string | null
  kind: CommandTaskKind
  mode: CommandTaskMode
  label: string | null
  summary: string
  cwd: string
  status: CommandTaskStatus
  commandCount: number
  completedCommands: number
  currentCommand: string | null
  stdout: string
  stderr: string
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
}

const tasks = new Map<string, CommandTaskRecord>()
const taskHandles = new Map<string, CommandTaskHandle>()
const taskPromises = new Map<string, Promise<CommandTaskRecord>>()
let taskCounter = 0
let resolvedShell: ShellBinary | null = null
let gitBashShellPromise: Promise<GitBashShell | null> | null = null
let resolvedPlatform: string | null = null

let cwdRef: string = ''

// ── Background task completion notification ────────────────────────────────

export interface BackgroundTaskCompletionEvent {
  taskId: string
  tabId: string | null
  kind: CommandTaskKind
  command: string
  status: CommandTaskStatus
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  startedAt: number
  finishedAt: number
}

let bgTaskCompletionListener: ((event: BackgroundTaskCompletionEvent) => void) | null = null

/** Register a single listener for background task completions. Returns an unsubscribe function. */
export function onBackgroundTaskComplete(listener: (event: BackgroundTaskCompletionEvent) => void): () => void {
  bgTaskCompletionListener = listener
  return () => { bgTaskCompletionListener = null }
}

function getExecutionToolCallId(execOptions: unknown): string | undefined {
  return typeof (execOptions as { toolCallId?: unknown })?.toolCallId === 'string'
    ? (execOptions as { toolCallId: string }).toolCallId
    : undefined
}

function emitToolOutput(
  events: ShellToolRuntimeEvents | undefined,
  toolName: 'run_command' | 'git_command',
  toolCallId: string | undefined,
  stream: 'stdout' | 'stderr',
  chunk: string,
): void {
  events?.onOutput?.({
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    stream,
    chunk,
  })
}

export function resetCwd(projectPath: string): void {
  cwdRef = projectPath
}

const taskVersionRef = ref(0)
const taskSnapshotsRef = shallowRef<CommandTaskSummary[]>([])
export const commandTaskVersion = readonly(taskVersionRef)
export const commandTasks = readonly(taskSnapshotsRef)

function touchTasks(): void {
  taskSnapshotsRef.value = sortTasks(tasks.values())
  taskVersionRef.value++
}

// Throttled variant used for high-frequency stdout/stderr data events.
// Batches all output-driven reactive updates into a single flush per ~16ms
// tick so verbose commands (e.g. pnpm install, cargo build) don't flood
// Vue's reactivity system and freeze the UI.
let _pendingOutputTouch = false
function touchTasksThrottled(): void {
  if (_pendingOutputTouch)
    return
  _pendingOutputTouch = true
  setTimeout(() => {
    _pendingOutputTouch = false
    touchTasks()
  }, 16)
}

function nextTaskId(): string {
  taskCounter += 1
  return `cmd${taskCounter}`
}

function trimOutput(raw: string): string {
  if (raw.length <= MAX_OUTPUT_CHARS)
    return raw.trimEnd()

  const half = Math.floor(MAX_OUTPUT_CHARS / 2)
  const head = raw.slice(0, half).trimEnd()
  const tail = raw.slice(-half).trimStart()
  return `${head}\n\n[... ${(raw.length / 1024).toFixed(0)} KB trimmed ...]\n\n${tail}`
}

function appendOutput(current: string, chunk: string): string {
  return trimOutput(current ? `${current}${chunk}` : chunk)
}

function sanitizeCommandForFilename(command: string): string {
  return command
    .replace(/[^\w-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    .toLowerCase()
}

async function writeLogOutputFile(command: string, output: string): Promise<string | null> {
  try {
    const home = await homeDir()
    const dir = `${home}/.emty/cmd`
    await mkdir(dir, { recursive: true })

    const timestamp = Date.now()
    const safeName = sanitizeCommandForFilename(command) || 'command'
    const filename = `cmd_${timestamp}_${safeName}.log`
    const filePath = `${dir}/${filename}`

    await writeTextFile(filePath, `$ ${command}\n\n${output}`)

    // Log rotation: keep only the newest MAX_LOG_FILES
    try {
      const entries = await readDir(dir)
      const logFiles: Array<{ name: string; path: string; mtime: number }> = []
      for (const entry of entries) {
        if (entry.name?.endsWith('.log')) {
          const entryPath = `${dir}/${entry.name}`
          try {
            const info = await stat(entryPath)
            logFiles.push({ name: entry.name, path: entryPath, mtime: info.mtime?.getTime() ?? 0 })
          }
          catch { /* skip unreadable */ }
        }
      }

      if (logFiles.length > MAX_LOG_FILES) {
        logFiles.sort((a, b) => a.mtime - b.mtime) // oldest first
        const toDelete = logFiles.slice(0, logFiles.length - MAX_LOG_FILES)
        for (const f of toDelete) {
          try { await remove(f.path) }
          catch { /* skip */ }
        }
      }
    }
    catch { /* rotation failure is non-fatal */ }

    return filePath
  }
  catch {
    return null
  }
}

function updateCwdFromCommand(command: string): void {
  const cdMatch = command.match(/(?:^|[;&|]\s*)cd\s+([^;&|]+)/)
  if (cdMatch?.[1]) {
    const target = cdMatch[1].replace(/^"|"$/g, '').trim()
    if (target) {
      cwdRef = target.startsWith('/') || /^[A-Z]:\\/i.test(target)
        ? target
        : `${cwdRef}/${target}`
    }
  }
}

function sortTasks(entries: Iterable<CommandTaskRecord>): CommandTaskSummary[] {
  return [...entries]
    .map(snapshotTask)
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running')
        return -1
      if (a.status !== 'running' && b.status === 'running')
        return 1
      return b.startedAt - a.startedAt
    })
}

function snapshotTask(task: CommandTaskRecord): CommandTaskSummary {
  return {
    id: task.id,
    tabId: task.tabId,
    kind: task.kind,
    mode: task.mode,
    label: task.label,
    summary: task.summary,
    cwd: task.cwd,
    status: task.status,
    commandCount: task.commandCount,
    completedCommands: task.completedCommands,
    currentCommand: task.currentCommand,
    stdout: task.stdout,
    stderr: task.stderr,
    exitCode: task.exitCode,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  }
}

function evictFinishedTasksIfNeeded(): void {
  if (tasks.size < MAX_TRACKED_TASKS)
    return

  const finished = [...tasks.values()]
    .filter(task => task.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))

  while (tasks.size >= MAX_TRACKED_TASKS && finished.length > 0) {
    const task = finished.shift()!
    tasks.delete(task.id)
    taskHandles.delete(task.id)
    taskPromises.delete(task.id)
  }
}

export function listManagedCommandTasks(): CommandTaskSummary[] {
  return taskSnapshotsRef.value
}

export function getManagedCommandTask(id: string): CommandTaskSummary | null {
  const task = tasks.get(id)
  return task ? snapshotTask(task) : null
}

async function resolveShell(): Promise<ShellBinary> {
  if (resolvedShell != null)
    return resolvedShell
  const { platform } = await import('@tauri-apps/plugin-os')
  const currentPlatform = await platform()
  if (currentPlatform !== 'windows') {
    resolvedShell = 'sh'
    return resolvedShell
  }

  try {
    const result = await Command.create('sh', ['-c', 'exit 0']).execute()
    if (result.code === 0) {
      resolvedShell = 'sh'
      return resolvedShell
    }
  }
  catch {
    // Bash may still be available as Git's bundled bash.exe outside PATH.
  }

  const gitBashShell = await getGitBashShell(cwdRef || '')
  if (gitBashShell) {
    resolvedShell = gitBashShell
    return resolvedShell
  }

  try {
    const result = await Command.create('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']).execute()
    if (result.code === 0) {
      resolvedShell = 'pwsh'
      return resolvedShell
    }
  }
  catch {
    // PowerShell 7 is optional on Windows. Fall back to Windows PowerShell.
  }

  resolvedShell = 'powershell'
  return resolvedShell
}

export function primeShell(shell: ShellBinary): void {
  resolvedShell = shell
}

function createShellArgs(shell: ShellBinary, command: string): string[] {
  if (shell === 'powershell' || shell === 'pwsh')
    return ['-NoProfile', '-NonInteractive', '-Command', command]
  if (shell === 'git-bash' || shell === 'git-bash-x86')
    return ['-lc', command]
  return ['-c', command]
}

async function probeGitBashShell(cwd: string): Promise<GitBashShell | null> {
  const commonPaths: Array<{ shell: GitBashShell; path: string }> = [
    { shell: 'git-bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
    { shell: 'git-bash-x86', path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe' },
  ]

  for (const candidate of commonPaths) {
    if (await exists(candidate.path))
      return candidate.shell
  }

  try {
    const result = await Command.create('cmd', ['/d', '/s', '/c', 'where git']).execute()
    if (result.code !== 0 || !result.stdout.trim())
      return null

    const cwdLower = cwd.replace(/\//g, '\\').toLowerCase()
    const candidates = result.stdout
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean)

    for (const gitPath of candidates) {
      const normalizedGitPath = gitPath.replace(/\//g, '\\')
      const gitDir = normalizedGitPath.slice(0, Math.max(0, normalizedGitPath.lastIndexOf('\\'))).toLowerCase()
      if (gitDir === cwdLower || gitDir.startsWith(`${cwdLower}\\`))
        continue

      const bashPath = normalizedGitPath.replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe')
      if (bashPath === normalizedGitPath)
        continue
      const match = commonPaths.find(candidate => candidate.path.toLowerCase() === bashPath.toLowerCase())
      if (match && await exists(match.path))
        return match.shell
    }
  }
  catch {
    return null
  }

  return null
}

async function getGitBashShell(cwd: string): Promise<GitBashShell | null> {
  gitBashShellPromise ??= probeGitBashShell(cwd)
  return await gitBashShellPromise
}

async function resolveShellCommand(command: string): Promise<ResolvedShellCommand> {
  const shell = await resolveShell()
  if (shell === 'sh') {
    return {
      binary: shell,
      args: createShellArgs(shell, command),
    }
  }

  if (shell === 'git-bash' || shell === 'git-bash-x86') {
    return {
      binary: shell,
      args: createShellArgs(shell, command),
    }
  }

  return {
    binary: shell,
    args: createShellArgs(shell, command),
  }
}

function createTaskRecord(options: {
  kind: CommandTaskKind
  mode: CommandTaskMode
  tabId?: string | null
  cwd: string
  summary: string
  label?: string
  commandCount: number
}): CommandTaskRecord {
  evictFinishedTasksIfNeeded()

  const task: CommandTaskRecord = {
    id: nextTaskId(),
    tabId: options.tabId ?? null,
    kind: options.kind,
    mode: options.mode,
    label: options.label?.trim() || null,
    summary: options.summary,
    cwd: options.cwd,
    status: 'running',
    commandCount: options.commandCount,
    completedCommands: 0,
    currentCommand: null,
    stdout: '',
    stderr: '',
    exitCode: null,
    startedAt: Date.now(),
    finishedAt: null,
    results: [],
  }

  tasks.set(task.id, task)
  taskHandles.set(task.id, {
    child: null,
    pid: null,
    stopRequested: false,
    timeoutRequested: false,
    resolveCompletion: null,
    resolveSpawn: null,
  })
  touchTasks()
  return task
}

function finalizeTask(task: CommandTaskRecord, handle: CommandTaskHandle, options: {
  status: CommandTaskStatus
  exitCode?: number | null
  note?: string
}): void {
  task.status = options.status
  task.finishedAt = Date.now()
  task.currentCommand = null
  task.exitCode = options.exitCode ?? task.exitCode
  handle.child = null
  handle.pid = null

  if (options.note)
    task.stderr = appendOutput(task.stderr, options.note)

  touchTasks()
}

async function getOsPlatform(): Promise<string> {
  if (resolvedPlatform != null)
    return resolvedPlatform
  const { platform } = await import('@tauri-apps/plugin-os')
  resolvedPlatform = await platform()
  return resolvedPlatform
}

async function forceKillProcess(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }

  const osPlatform = await getOsPlatform()

  if (osPlatform === 'windows') {
    if (resolvedShell === 'git-bash' || resolvedShell === 'git-bash-x86' || resolvedShell === 'sh') {
      try {
        const args = resolvedShell === 'sh' ? ['-c', `kill -9 ${pid}`] : ['-lc', `kill -9 ${pid}`]
        const result = await Command.create(resolvedShell, args).execute()
        if (result.code === 0)
          return true
      }
      catch { /* ignore and fallback */ }
    }
    else if (resolvedShell === 'pwsh' || resolvedShell === 'powershell') {
      try {
        const result = await Command.create(resolvedShell, [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
        ]).execute()
        if (result.code === 0 || result.code === 1)
          return true
      }
      catch { /* ignore and fallback */ }
    }

    try {
      const result = await Command.create('cmd', ['/d', '/s', '/c', `taskkill /F /T /PID ${pid}`]).execute()
      if (result.code === 0 || result.code === 128)
        return true
    }
    catch { /* ignore */ }

    return false
  }

  // Unix (macOS, Linux): kill -9 the process group (negated PID) so that
  // all children are also signalled; fall back to the direct PID if the
  // process changed its PGID.
  try {
    const pgResult = await Command.create('sh', ['-c', `kill -9 -${pid} 2>/dev/null || kill -9 ${pid}`]).execute()
    return pgResult.code === 0
  }
  catch {
    return false
  }
}

async function reconcileRunningTask(task: CommandTaskRecord): Promise<CommandTaskRecord> {
  // This used to actively probe the OS for the tracked PID (via a freshly spawned
  // `kill -0`-style check) and declare the task finished the moment that probe came
  // back negative. That probe runs as its own separate process and, in this app's
  // environment, was unreliable enough to report tasks as "not running" even while
  // they were demonstrably still alive and streaming stdout through their own
  // command handle — silently converting live background tasks (e.g. dev servers)
  // into "completed"/"failed". The handle's real 'close'/'error' listeners (set up
  // when the task was started) are what actually keep `task.status` accurate now,
  // so there's nothing left to reconcile here. Kept as a stable entry point in case
  // a reliable cross-platform liveness check is reintroduced later.
  return task
}

export async function refreshManagedCommandTask(id: string): Promise<CommandTaskSummary | null> {
  const task = tasks.get(id)
  if (!task)
    return null

  await reconcileRunningTask(task)
  return snapshotTask(task)
}

export async function refreshManagedCommandTasks(): Promise<CommandTaskSummary[]> {
  await Promise.all(
    [...tasks.values()]
      .filter(task => task.status === 'running')
      .map(task => reconcileRunningTask(task)),
  )

  return listManagedCommandTasks()
}

async function stopTaskInternal(id: string): Promise<CommandTaskSummary | null> {
  const task = tasks.get(id)
  const handle = taskHandles.get(id)
  if (!task || !handle)
    return null

  handle.stopRequested = true
  const pid = handle.pid
  const child = handle.child

  if (pid != null) {
    // Fire both the graceful Tauri kill and the force-kill simultaneously.
    // child.kill() on Windows only terminates the shell wrapper; forceKillProcess
    // uses taskkill /F /T to kill the entire process tree. Running them in
    // parallel (no 200ms grace period) ensures the child processes are gone
    // as quickly as possible.
    void (async () => {
      const killed = await forceKillProcess(pid)
      if (child != null) {
        try { await child.kill() }
        catch { /* ignore */ }
      }

      if (task.status === 'running') {
        finalizeTask(task, handle, {
          status: 'killed',
          exitCode: null,
          note: killed ? `\n[force killed PID ${pid}]` : `\n[warning: force kill may have failed for PID ${pid}]`,
        })
      }
      touchTasks()
    })()
  }
  else {
    if (handle.child != null) {
      try { await handle.child.kill() }
      catch { /* ignore */ }
    }
    if (task.status === 'running')
      finalizeTask(task, handle, { status: 'killed', exitCode: null, note: 'Killed (no PID)' })
  }

  touchTasks()
  return snapshotTask(task)
}

export async function stopManagedCommandTask(id: string): Promise<CommandTaskSummary | null> {
  return await stopTaskInternal(id)
}

export async function stopTasksForTab(tabId: string): Promise<void> {
  const running = [...tasks.values()].filter(
    t => t.tabId === tabId && t.status === 'running',
  )
  await Promise.all(running.map(t => stopTaskInternal(t.id)))
}

async function executeTrackedProcess(options: {
  task: CommandTaskRecord
  handle: CommandTaskHandle
  displayCommand: string
  timeoutMs: number
  createCommand: () => Command<string>
  abortSignal?: AbortSignal
  runtimeEvents?: ShellToolRuntimeEvents
  toolCallId?: string
}): Promise<CommandResult> {
  const start = Date.now()
  let stdout = ''
  let stderr = ''
  let status: CommandResultStatus = 'completed'

  const command = options.createCommand()

  command.stdout.on('data', (chunk: string) => {
    stdout = appendOutput(stdout, chunk)
    options.task.stdout = appendOutput(options.task.stdout, chunk)
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stdout', chunk)
    // Use the throttled variant here: output events can fire hundreds of times
    // per second on verbose commands and flooding touchTasks() synchronously
    // will lock up the Vue reactivity system and freeze the UI.
    touchTasksThrottled()
  })
  command.stderr.on('data', (chunk: string) => {
    stderr = appendOutput(stderr, chunk)
    options.task.stderr = appendOutput(options.task.stderr, chunk)
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', chunk)
    touchTasksThrottled()
  })

  let resolveDone!: (value: CommandCompletionSignal) => void
  const done = new Promise<CommandCompletionSignal>(resolve => {
    resolveDone = resolve
  })

  let doneResolved = false
  const settleDone = (value: CommandCompletionSignal) => {
    if (doneResolved)
      return
    doneResolved = true
    resolveDone(value)
  }

  options.handle.resolveCompletion = settleDone

  command.on('close', event => settleDone({ code: event.code }))
  command.on('error', error => settleDone({ code: null, spawnError: String(error) }))

  const onAbort = async () => {
    if (options.handle.child != null && !options.handle.stopRequested && !options.handle.timeoutRequested) {
      options.handle.timeoutRequested = true

      // Snapshot pid/child before settleDone clears them on done resolution.
      const pid = options.handle.pid
      const child = options.handle.child

      // Resolve first so this wins the race against the close event.
      settleDone({ code: null, timedOut: true })

      // Then kill the process tree — same strategy as the timeout handler.
      if (pid != null)
        await forceKillProcess(pid)
      if (child != null)
        await child.kill().catch(() => {})
    }
  }
  options.abortSignal?.addEventListener('abort', onAbort, { once: true })

  try {
    const child = await command.spawn()
    options.handle.child = child
    options.handle.pid = child.pid

    // Signal that the process has spawned — unblocks background-task callers
    options.handle.resolveSpawn?.()
    options.handle.resolveSpawn = null

    // ── Post-spawn abort check ───────────────────────────────────────────────
    // If the abort signal already fired BEFORE spawn completed, onAbort ran when
    // handle.child was still null and silently skipped the kill. Now that we have
    // a real PID we must honour that pending abort ourselves — same pattern as
    // the timeout handler: snapshot first, settleDone, then kill.
    if ((options.abortSignal?.aborted || options.handle.stopRequested || options.handle.timeoutRequested) && !doneResolved) {
      if (options.abortSignal?.aborted)
        options.handle.timeoutRequested = true
      else if (options.handle.stopRequested)
        options.handle.stopRequested = true

      const pid = options.handle.pid
      const spawnedChild = options.handle.child
      settleDone({ code: null, timedOut: options.handle.timeoutRequested })

      // Run cleanup asynchronously to ensure order
      void (async () => {
        if (pid != null)
          await forceKillProcess(pid)
        if (spawnedChild != null)
          await spawnedChild.kill().catch(() => {})
      })()
    }

    // NOTE: this used to run a periodic `kill -0`-style liveness probe here for
    // background tasks, and would settle the task as "exited" the moment the probe
    // came back negative (see the removed comment below for the original
    // reasoning). In practice that probe spawns its own separate process to check
    // the PID, and in this app's environment it was unreliable enough to report
    // demonstrably-running tasks (still actively streaming stdout through this very
    // command handle) as no longer running — silently turning live dev servers into
    // "completed"/"failed" tasks. The 'close' and 'error' listeners registered
    // above are tied to the same handle the stdout/stderr streams come from, so
    // they're the trustworthy signal here. Background tasks now only end via a
    // real close/error event or an explicit kill — never via this kind of
    // best-effort liveness inference.
  }
  catch (e) {
    status = 'spawn_error'
    const message = e instanceof Error ? e.message : String(e)
    stderr = appendOutput(stderr, message)
    options.task.stderr = appendOutput(options.task.stderr, message)
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', message)
    options.handle.child = null
    options.handle.pid = null
    // Unblock any caller awaiting spawn confirmation (e.g. background task start)
    options.handle.resolveSpawn?.()
    options.handle.resolveSpawn = null
    options.abortSignal?.removeEventListener('abort', onAbort)
    touchTasks()

    return {
      command: options.displayCommand,
      exitCode: null,
      stdout,
      stderr,
      durationMs: Date.now() - start,
      status,
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  if (options.timeoutMs > 0) {
    timer = setTimeout(async () => {
      options.handle.timeoutRequested = true

      // Snapshot pid/child before any async work so we hold a stable reference
      // even after executeTrackedProcess clears them on done resolution.
      const pid = options.handle.pid
      const child = options.handle.child

      // Resolve first so this wins the race against the close event.
      settleDone({ code: null, timedOut: true })

      // Then kill the process tree. On Windows, child.kill() only kills the
      // shell wrapper (bash.exe/cmd.exe), leaving grandchild processes alive.
      // Use forceKillProcess FIRST (taskkill /F /T) for the full tree, then
      // child.kill() as backup.
      if (pid != null)
        await forceKillProcess(pid)
      if (child != null)
        await child.kill().catch(() => {})
    }, options.timeoutMs)
  }

  const settled = await done

  if (timer != null)
    clearTimeout(timer)

  if (!settled.timedOut) {
    options.handle.child = null
    options.handle.pid = null
    options.handle.resolveCompletion = null
  }
  options.abortSignal?.removeEventListener('abort', onAbort)

  if (options.handle.stopRequested && !settled.timedOut) {
    status = 'killed'
    stderr = appendOutput(stderr, '[killed by user]')
    options.task.stderr = appendOutput(options.task.stderr, '[killed by user]')
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', '[killed by user]')
  }
  else if (settled.timedOut) {
    status = 'timed_out'
    const note = `\n[timed out after ${Math.floor(options.timeoutMs / 1000)}s]`
    stderr = appendOutput(stderr, note)
    options.task.stderr = appendOutput(options.task.stderr, note)
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', note)
  }
  else if (settled.spawnError) {
    status = 'spawn_error'
    stderr = appendOutput(stderr, settled.spawnError)
    options.task.stderr = appendOutput(options.task.stderr, settled.spawnError)
    emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', settled.spawnError)
  }
  else if (settled.code !== 0) {
    const semantic = interpretExitCode(options.displayCommand, settled.code)
    if (semantic.note) {
      stderr = appendOutput(stderr, semantic.note)
      options.task.stderr = appendOutput(options.task.stderr, semantic.note)
      emitToolOutput(options.runtimeEvents, options.task.kind === 'shell' ? 'run_command' : 'git_command', options.toolCallId, 'stderr', semantic.note)
    }
    if (semantic.isError)
      status = 'failed'
  }

  touchTasks()

  return {
    command: options.displayCommand,
    exitCode: settled.code,
    stdout,
    stderr,
    durationMs: Date.now() - start,
    status,
  }
}

async function runTrackedSequence(options: {
  task: CommandTaskRecord
  specs: Array<{ displayCommand: string; createCommand: () => Command<string> }>
  timeoutMs: number
  abortSignal?: AbortSignal
  runtimeEvents?: ShellToolRuntimeEvents
  toolCallId?: string
}): Promise<CommandTaskRecord> {
  const handle = taskHandles.get(options.task.id)
  if (!handle)
    throw new Error(`Missing command task handle for ${options.task.id}`)

  for (const spec of options.specs) {
    if (handle.stopRequested) {
      finalizeTask(options.task, handle, {
        status: 'killed',
      })
      return options.task
    }

    handle.timeoutRequested = false
    options.task.currentCommand = spec.displayCommand
    touchTasks()

    const result = await executeTrackedProcess({
      task: options.task,
      handle,
      displayCommand: spec.displayCommand,
      timeoutMs: options.timeoutMs,
      createCommand: () => spec.createCommand(),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      ...(options.runtimeEvents ? { runtimeEvents: options.runtimeEvents } : {}),
      ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    })

    options.task.results.push(result)
    options.task.exitCode = result.exitCode
    options.task.completedCommands += 1
    touchTasks()

    if (result.status === 'killed') {
      finalizeTask(options.task, handle, {
        status: 'killed',
      })
      return options.task
    }

    if (result.status === 'timed_out') {
      finalizeTask(options.task, handle, {
        status: 'timed_out',
      })
      return options.task
    }

    // Trust the status executeTrackedProcess already computed (via interpretExitCode),
    // rather than re-deriving from the raw exit code here. Re-checking exitCode !== 0
    // directly is wrong in two ways: (1) `null !== 0` is true in JS, so any task that
    // ends with an unknown exit code — e.g. the background liveness-probe fallback,
    // which can never report a real code — gets mislabeled "failed" even though it
    // ran fine; (2) it ignores command-specific exit-code semantics (e.g. grep/diff/
    // test exit 1) that interpretExitCode already accounted for.
    if (result.status === 'spawn_error' || result.status === 'failed') {
      finalizeTask(options.task, handle, {
        status: 'failed',
      })
      return options.task
    }
  }

  finalizeTask(options.task, handle, {
    status: 'completed',
  })
  return options.task
}

function formatResults(results: CommandResult[]): string {
  return results
    .map(result => {
      const duration = `${(result.durationMs / 1000).toFixed(1)}s`
      const status = result.status === 'completed'
        ? result.exitCode === 0 ? `ok ${duration}` : `exit ${result.exitCode ?? 'unknown'} ${duration}`
        : result.status === 'timed_out'
          ? `timed out ${duration}`
          : result.status === 'killed'
            ? `killed ${duration}`
            : `error ${duration}`

      const lines = [`$ ${result.command} [${status}]`]
      if (result.stdout)
        lines.push(result.stdout)
      if (result.stderr)
        lines.push(`[stderr]\n${result.stderr}`)
      return lines.join('\n')
    })
    .join('\n\n----------------------------------------\n\n')
}

function buildGitSummary(commands: Array<{ args: string[] }>): string {
  const first = commands[0]?.args.join(' ') ?? 'git'
  if (commands.length === 1)
    return `git ${first}`
  return `git ${first} (+${commands.length - 1} more)`
}

function hasGitCommitCommand(commands: Array<{ args: string[] }>): boolean {
  return commands.some(command => command.args[0] === 'commit')
}

function applyCoAuthorTrailer(
  commands: Array<{ args: string[] }>,
  enabled: boolean,
): Array<{ args: string[] }> {
  if (!enabled)
    return commands

  return commands.map(({ args }) => {
    if (args[0] !== 'commit')
      return { args }

    const newArgs = [...args]
    let lastMIndex = -1
    for (let i = 0; i < newArgs.length; i++) {
      if (newArgs[i] === '-m')
        lastMIndex = i
    }

    if (lastMIndex !== -1 && lastMIndex + 1 < newArgs.length) {
      newArgs[lastMIndex + 1] = `${newArgs[lastMIndex + 1]}\n\n${CO_AUTHOR_TRAILER}`
    }
    else {
      newArgs.push('-m', CO_AUTHOR_TRAILER)
    }

    return { args: newArgs }
  })
}

function splitQuotedArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\' && quote !== '\'') {
      escaping = true
      continue
    }

    if (quote != null) {
      if (char === quote) {
        quote = null
      }
      else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping)
    current += '\\'
  if (current.length > 0)
    tokens.push(current)

  return tokens
}

function interpretExitCode(command: string, exitCode: number | null): {
  isError: boolean
  note?: string
} {
  if (exitCode == null)
    return { isError: false }

  const base = splitQuotedArgs(command)[0]?.toLowerCase() ?? ''
  switch (base) {
    case 'grep':
    case 'rg':
      return exitCode >= 2 ? { isError: true } : exitCode === 1 ? { isError: false, note: 'No matches found.' } : { isError: false }
    case 'diff':
      return exitCode >= 2 ? { isError: true } : exitCode === 1 ? { isError: false, note: 'Differences found.' } : { isError: false }
    case 'test':
    case '[':
      return exitCode >= 2 ? { isError: true } : exitCode === 1 ? { isError: false, note: 'Condition evaluated to false.' } : { isError: false }
    case 'find':
      return exitCode >= 2 ? { isError: true } : exitCode === 1 ? { isError: false, note: 'Some paths were inaccessible.' } : { isError: false }
    default:
      return { isError: exitCode !== 0 }
  }
}

function normalizeGitCommands(input: {
  action?: ManagedCommandAction | undefined
  command?: string | string[] | undefined
  commands?: Array<string | { args: string[] }> | undefined
}): {
  action: ManagedCommandAction
  commands: Array<{ args: string[] }>
} {
  const action = input.action ?? 'exec'
  if (action === 'status' || action === 'kill' || action === 'list')
    return { action, commands: [] }

  const normalized: Array<{ args: string[] }> = []

  if (typeof input.command === 'string' && input.command.trim()) {
    const args = splitQuotedArgs(input.command.trim())
    if (args.length > 0)
      normalized.push({ args })
  }
  else if (Array.isArray(input.command) && input.command.length > 0) {
    normalized.push({ args: input.command.map(part => part.trim()).filter(Boolean) })
  }

  if (Array.isArray(input.commands)) {
    for (const item of input.commands) {
      if (typeof item === 'string') {
        const args = splitQuotedArgs(item.trim())
        if (args.length > 0)
          normalized.push({ args })
      }
      else if (item && Array.isArray(item.args)) {
        const args = item.args.map(part => part.trim()).filter(Boolean)
        if (args.length > 0)
          normalized.push({ args })
      }
    }
  }

  if (normalized.length === 0)
    throw new Error('Provide command for one git invocation or commands for a git sequence')

  return { action, commands: normalized }
}

function startTrackedSequence(options: {
  kind: CommandTaskKind
  /** Task execution mode. Defaults to 'exec' (foreground). */
  mode?: CommandTaskMode
  tabId?: string | null
  summary: string
  cwd: string
  specs: Array<{ displayCommand: string; createCommand: () => Command<string> }>
  timeoutMs: number
  abortSignal?: AbortSignal
  runtimeEvents?: ShellToolRuntimeEvents
  toolCallId?: string
}): { task: CommandTaskRecord; done: Promise<CommandTaskRecord>; spawnDone: Promise<void> } {
  const task = createTaskRecord({
    kind: options.kind,
    mode: options.mode ?? 'exec',
    tabId: options.tabId ?? null,
    cwd: options.cwd,
    summary: options.summary,
    commandCount: options.specs.length,
  })

  // spawnDone resolves once the first command has spawned (PID assigned) or
  // failed to spawn. Background callers await this instead of full completion.
  const handle = taskHandles.get(task.id)!
  const spawnDone = new Promise<void>(resolve => {
    handle.resolveSpawn = resolve
  })

  const done = runTrackedSequence({
    task,
    timeoutMs: options.timeoutMs,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.runtimeEvents ? { runtimeEvents: options.runtimeEvents } : {}),
    ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    specs: options.specs,
  })

  taskPromises.set(task.id, done)

  // ── Fire completion event for background tasks ──────────────────────────
  if (options.mode === 'background' && options.tabId) {
    const tabIdForListener = options.tabId
    done.then(finishedTask => {
      if (!bgTaskCompletionListener)
        return
      bgTaskCompletionListener({
        taskId: finishedTask.id,
        tabId: tabIdForListener,
        kind: finishedTask.kind,
        command: finishedTask.summary,
        status: finishedTask.status,
        exitCode: finishedTask.exitCode,
        stdout: finishedTask.stdout,
        stderr: finishedTask.stderr,
        durationMs: finishedTask.finishedAt ? finishedTask.finishedAt - finishedTask.startedAt : 0,
        startedAt: finishedTask.startedAt,
        finishedAt: finishedTask.finishedAt ?? Date.now(),
      })
    }).catch(() => {})
  }

  return { task, done, spawnDone }
}

async function waitForTask(task: CommandTaskRecord, done: Promise<CommandTaskRecord>, waitForMs: number | undefined) {
  if (waitForMs == null)
    return { timedOut: false, task: await done, waitedMs: Date.now() - task.startedAt }

  const startedAt = Date.now()
  const result = await Promise.race([
    done.then(finished => ({ timedOut: false as const, task: finished })),
    new Promise<{ timedOut: true; task: CommandTaskRecord }>(resolve =>
      setTimeout(resolve, waitForMs, { timedOut: true, task })),
  ])

  return {
    ...result,
    waitedMs: Date.now() - startedAt,
  }
}

const runCommandInputSchema = z.object({
  command: z.string().describe('Shell command to execute. Always use non-interactive flags (-y, --yes). Do not run pagers.'),
  cwd: z.string().optional().describe('Working directory. Persists across commands — if set, all subsequent commands without cwd run here.'),
  is_background: z.boolean().optional().default(false).describe('Start detached, return immediately with PID. Use for dev servers. Default: false.'),
  timeout_ms: z.number().int().min(5000).max(900000).optional().default(120000).describe('Max execution time in ms. Default: 120000 (2 min). Max: 900000 (15 min). Ignored if is_background.'),
})

export function createRunCommandTool(projectPath: string, runtimeEvents?: ShellToolRuntimeEvents, tabId?: string | null) {
  if (!cwdRef)
    cwdRef = projectPath

  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.run_command,
    inputSchema: runCommandInputSchema,
    execute: async (input, execOptions) => {
      const { abortSignal } = execOptions
      const toolCallId = getExecutionToolCallId(execOptions)
      const command = input.command.trim()
      if (!command)
        return { exit_code: -1, duration_ms: 0, output: 'Error: command cannot be empty.' }

      if (isShellCommandBlocked(command)) {
        return { exit_code: -1, duration_ms: 0, output: SHELL_BLOCKED_MESSAGE }
      }

      // ── CWD resolution ──────────────────────────────────────────────
      if (input.cwd) {
        try {
          const resolved = await safePath(projectPath, input.cwd, { kind: 'read' })
          cwdRef = resolved
        }
        catch (e) {
          return { exit_code: -1, duration_ms: 0, output: `Error: ${e instanceof Error ? e.message : String(e)}` }
        }
      }

      // Verify CWD exists
      try {
        const info = await stat(cwdRef)
        if (!info.isDirectory)
          cwdRef = projectPath
      }
      catch {
        cwdRef = projectPath
      }

      const cwd = cwdRef
      updateCwdFromCommand(command)

      // ── Snapshot files the command is about to mutate ───────────────
      // Extends checkpoint coverage to shell-side mutations (sed -i,
      // rm, mv, cp, redirects, etc.) that bypass the filesystem tools.
      try {
        const { useCheckpointStore } = await import('@/stores/checkpoints')
        const checkpointStore = useCheckpointStore()
        await checkpointStore.snapshotFilesFromCommand(command, cwd, projectPath)
      }
      catch {
        // Snapshot is best-effort; never block the command.
      }

      const timeoutMs = input.timeout_ms ?? 120_000
      // The tool description promises timeout_ms is "Ignored if is_background", but
      // executeTrackedProcess's deadline timer didn't special-case mode — so a
      // background dev server / watcher was getting force-killed the moment the
      // (default 120s) timeout elapsed, surfacing as a confusing failure even though
      // nothing was actually wrong. Background tasks have no deadline; they only stop
      // via an explicit kill or by exiting on their own.
      const effectiveTimeoutMs = input.is_background ? 0 : timeoutMs
      const resolved = await resolveShellCommand(command)

      const { task, done, spawnDone } = startTrackedSequence({
        kind: 'shell',
        mode: input.is_background ? 'background' : 'exec',
        tabId: tabId ?? null,
        summary: command,
        cwd,
        specs: [{
          displayCommand: command,
          createCommand: () => Command.create(resolved.binary, resolved.args, { cwd }),
        }],
        timeoutMs: effectiveTimeoutMs,
        ...(abortSignal ? { abortSignal } : {}),
        ...(runtimeEvents ? { runtimeEvents } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      })

      // ── Background mode ─────────────────────────────────────────────────────
      // Wait only until the process has spawned (PID assigned), then return
      // immediately. The task keeps running in the background and can be
      // inspected or killed via git_command with action: "status" / "kill".
      if (input.is_background) {
        await spawnDone
        const pid = taskHandles.get(task.id)?.pid
        const spawnFailed = task.results[0]?.status === 'spawn_error'
        if (spawnFailed) {
          return {
            exit_code: -1,
            duration_ms: 0,
            task_id: task.id,
            output: `Failed to start background command: ${task.stderr || 'spawn error'}`,
          }
        }
        return {
          exit_code: 0,
          duration_ms: 0,
          task_id: task.id,
          output: `Background task ${task.id} started${pid ? ` (PID ${pid})` : ''}. Use git_command with action: "status" and id: "${task.id}" to check progress, or action: "kill" to stop it.`,
        }
      }

      // ── Foreground mode ─────────────────────────────────────────────────────
      // Await full process completion. The timeout_ms timer inside
      // executeTrackedProcess is the sole deadline enforcement mechanism;
      // it kills the child and force-kills by PID when it fires.
      const waited = await waitForTask(task, done, undefined)

      const result = waited.task.results[0]
      let displaySource = result ? (result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')) : waited.task.stderr
      if (!displaySource && waited.task.stdout)
        displaySource = waited.task.stdout

      // ── Tail-based truncation ───────────────────────────────────────
      let logPath: string | null = null
      let output = ''
      const outLines = displaySource.split(/\r?\n/g)
      const shouldTruncateByLines = outLines.length > MAX_OUTPUT_LINES
      const shouldTruncateByChars = displaySource.length > MAX_OUTPUT_CHARS

      if (shouldTruncateByLines || shouldTruncateByChars) {
        const displayOutput = shouldTruncateByLines
          ? outLines.slice(-MAX_OUTPUT_LINES).join('\n')
          : trimOutput(displaySource)
        logPath = await writeLogOutputFile(command, displaySource)
        const reason = shouldTruncateByLines
          ? `${outLines.length} lines total, showing last ${MAX_OUTPUT_LINES}`
          : `${displaySource.length} chars total, showing a shortened preview`
        const logNote = logPath
          ? `[Output truncated: ${reason}. Full output saved to: ${logPath}]\n---\n`
          : `[Output truncated: ${reason}.]\n---\n`
        output = `${logNote}${displayOutput.trimEnd()}`
      }
      else {
        output = displaySource.trimEnd()
      }

      if (waited.task.status === 'timed_out') {
        output += `\n[timed out after ${Math.floor(timeoutMs / 1000)}s]`
      }
      else if (waited.task.status === 'killed') {
        output += '\n[killed by user]'
      }

      return {
        exit_code: waited.task.exitCode ?? -1,
        duration_ms: result ? result.durationMs : (Date.now() - waited.task.startedAt),
        output: output.trim() || '[No output]',
        ...(logPath ? { log_path: logPath } : {}),
      }
    },
  })
}

export function createGitCommandTool(projectPath: string, coAuthor = false, runtimeEvents?: ShellToolRuntimeEvents, tabId?: string | null) {
  const coAuthorNote = coAuthor
    ? '\n\nCo-authoring is ENABLED: every commit automatically includes a Co-authored-by trailer (Emty Agent). Do NOT add it yourself.'
    : ''

  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.git_command + coAuthorNote,
    inputSchema: z.object({
      action: z.enum(['exec', 'status', 'kill', 'list']).optional().describe('Optional. Omit this for normal git execution.'),
      command: z.union([
        z.string(),
        z.array(z.string().min(1)).min(1),
      ]).optional().describe('Preferred way to run one git command. Use either a string like "status --short" or an args array like ["status", "--short"].'),
      commands: z.array(z.union([
        z.string(),
        z.object({
          args: z.array(z.string().min(1)).min(1).describe('Git arguments without the leading "git".'),
        }),
      ])).min(1).max(20).optional().describe('Optional sequence of git commands to run in order.'),
      id: z.string().optional().describe('Tracked command task id used with action: "status" or "kill".'),
      timeoutSeconds: z.number().int().min(5).max(900).optional().describe('Per-command timeout in seconds. Default: 60. For git commit, default is no hard timeout so long pre-commit hooks keep running.'),
      waitForMs: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('Optional wait window in milliseconds. If the sequence is still running when this wait expires, the tool returns early with a taskId and the git work continues. Default: wait until exit, except git commit defaults to 30000.'),
    }),
    execute: async (input, execOptions) => {
      const { abortSignal } = execOptions
      const toolCallId = getExecutionToolCallId(execOptions)
      const normalized = normalizeGitCommands({
        action: input.action,
        command: input.command,
        commands: input.commands,
      })

      switch (normalized.action) {
        case 'status': {
          if (!input.id)
            throw new Error('action "status" requires id')
          const task = await refreshManagedCommandTask(input.id)
          return task
            ? { action: 'status' as const, task }
            : { action: 'status' as const, error: `No tracked command task found with id "${input.id}".` }
        }

        case 'kill': {
          if (!input.id)
            throw new Error('action "kill" requires id')
          const task = await stopManagedCommandTask(input.id)
          return task
            ? { action: 'kill' as const, task }
            : { action: 'kill' as const, error: `No tracked command task found with id "${input.id}".` }
        }

        case 'list':
          return {
            action: 'list' as const,
            tasks: await refreshManagedCommandTasks(),
          }
      }

      const commands = applyCoAuthorTrailer(normalized.commands, coAuthor ?? false)
      for (const c of commands) {
        const full = `git ${c.args.join(' ')}`
        if (isShellCommandBlocked(full)) {
          return { action: 'exec' as const, error: `Blocked by security policy: "${full}" matches shell blocklist. Edit Developer → Security → "Blocked Shell Commands" to allow it.` }
        }
      }
      const includesCommit = hasGitCommitCommand(commands)
      const timeoutMs = input.timeoutSeconds == null && includesCommit
        ? 0
        : (input.timeoutSeconds ?? 60) * 1000
      const waitForMs = input.waitForMs ?? (includesCommit ? 30_000 : undefined)
      const { task, done } = startTrackedSequence({
        kind: 'git',
        tabId: tabId ?? null,
        summary: buildGitSummary(commands),
        cwd: projectPath,
        specs: commands.map(command => ({
          displayCommand: `git ${command.args.join(' ')}`,
          createCommand: () => Command.create('git', command.args, { cwd: projectPath }),
        })),
        timeoutMs,
        ...(abortSignal ? { abortSignal } : {}),
        ...(runtimeEvents ? { runtimeEvents } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      })

      const waited = await waitForTask(task, done, waitForMs)
      if (waited.timedOut) {
        return {
          action: 'exec' as const,
          taskId: waited.task.id,
          running: true,
          status: waited.task.status,
          waitedMs: waited.waitedMs,
          summary: waited.task.summary,
          currentCommand: waited.task.currentCommand,
          commandCount: waited.task.commandCount,
          completedCommands: waited.task.completedCommands,
          note: includesCommit
            ? `Commit is still running, likely in hooks. It continues as task ${waited.task.id}; use action: "status" with id: "${waited.task.id}" to check progress.`
            : undefined,
          ...(waited.task.mode === 'background' ? { transferred: true } : {}),
          ...(waited.task.stdout ? { stdout: waited.task.stdout } : {}),
          ...(waited.task.stderr ? { stderr: waited.task.stderr } : {}),
        }
      }

      if (waited.task.mode === 'background' && waited.task.status === 'running') {
        return {
          action: 'exec' as const,
          taskId: waited.task.id,
          running: true,
          status: waited.task.status,
          waitedMs: waited.waitedMs,
          transferred: true,
          summary: waited.task.summary,
          currentCommand: waited.task.currentCommand,
          commandCount: waited.task.commandCount,
          completedCommands: waited.task.completedCommands,
          note: `Command timed out after ${Math.floor(timeoutMs / 1000)}s but continues as background task ${waited.task.id}. Use action: "status" with id: "${waited.task.id}" to check on it.`,
          ...(waited.task.stdout ? { stdout: waited.task.stdout } : {}),
          ...(waited.task.stderr ? { stderr: waited.task.stderr } : {}),
        }
      }

      const skipped = waited.task.commandCount > waited.task.results.length
        ? waited.task.commandCount - waited.task.results.length
        : 0

      return {
        action: 'exec' as const,
        taskId: waited.task.id,
        running: false,
        status: waited.task.status,
        exitCode: waited.task.exitCode,
        results: waited.task.results,
        output: formatResults(waited.task.results),
        ...(skipped > 0 ? { note: `Stopped early. ${skipped} git command(s) were not run.` } : {}),
      }
    },
  })
}

export function createShellTools(projectPath: string, shell?: ShellBinary, coAuthor?: boolean, runtimeEvents?: ShellToolRuntimeEvents, tabId?: string | null) {
  if (shell === 'sh' || shell === 'pwsh')
    primeShell(shell)

  return {
    run_command: createRunCommandTool(projectPath, runtimeEvents, tabId),
    git_command: createGitCommandTool(projectPath, coAuthor, runtimeEvents, tabId),
  } as const
}

export type ShellTools = ReturnType<typeof createShellTools>

function truncate(value: string, max = 52): string {
  const compact = value.trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

function gitArgLabel(args: string[]): string {
  const sub = args[0]?.toLowerCase() ?? 'operation'

  switch (sub) {
    case 'add':
      return `Git staged ${truncate(args.slice(1).join(' ') || '.', 32)}`
    case 'commit': {
      const msgIndex = args.indexOf('-m')
      const message = msgIndex !== -1 ? args[msgIndex + 1] : undefined
      return message ? `Git commit: ${truncate(message, 48)}` : 'Git commit'
    }
    case 'push':
      return args[2] ? `Git push ${args[1] ?? 'origin'}/${args[2]}` : `Git push ${args[1] ?? 'origin'}`
    case 'pull':
      return args[2] ? `Git pull ${args[1] ?? 'origin'}/${args[2]}` : `Git pull ${args[1] ?? 'origin'}`
    case 'status':
      return 'Git status'
    case 'diff':
      return args.length > 1 ? `Git diff ${args.slice(1).join(' ')}` : 'Git diff'
    case 'checkout':
      return `Git checkout ${args.slice(1).join(' ')}`
    default:
      return `Git ${sub}`
  }
}

export function shellToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'run_command': {
      const command = typeof args.command === 'string' ? args.command : null
      const isBg = args.is_background === true
      if (isBg) {
        return command ? `BG: ${truncate(command, 48)}` : 'Start background command'
      }
      return command ? `Run: ${truncate(command, 52)}` : 'Run command'
    }

    case 'git_command': {
      const action = typeof args.action === 'string' ? args.action : 'exec'
      if (action === 'status')
        return typeof args.id === 'string' ? `Status ${args.id}` : 'Git task status'
      if (action === 'kill')
        return typeof args.id === 'string' ? `Kill ${args.id}` : 'Stop git task'
      if (action === 'list')
        return 'List commands'

      const single = typeof args.command === 'string'
        ? splitQuotedArgs(args.command)
        : Array.isArray(args.command) && args.command.every(part => typeof part === 'string')
          ? args.command as string[]
          : null
      const cmds = [
        ...(single ? [{ args: single }] : []),
        ...(Array.isArray(args.commands)
          ? args.commands.flatMap(cmd => {
              if (typeof cmd === 'string') {
                const cmdArgs = splitQuotedArgs(cmd)
                return cmdArgs.length > 0 ? [{ args: cmdArgs }] : []
              }
              if (typeof cmd === 'object' && cmd != null && Array.isArray((cmd as { args?: unknown }).args))
                return [{ args: (cmd as { args: string[] }).args }]
              return []
            })
          : []),
      ]

      if (!cmds.length)
        return 'Git operation'
      if (cmds.length === 1)
        return gitArgLabel(cmds[0]!.args)
      return `${gitArgLabel(cmds[0]!.args)} +${cmds.length - 1} more`
    }

    default:
      return `Called ${toolName}`
  }
}
