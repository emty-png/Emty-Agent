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
import { safePath } from './fs/allowedPaths'

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
}

interface CommandCompletionSignal {
  code: number | null
  spawnError?: string
  inferredExit?: boolean
  transferred?: boolean
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

let cwdRef: string = ''

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
  cwd: string
  summary: string
  label?: string
  commandCount: number
}): CommandTaskRecord {
  evictFinishedTasksIfNeeded()

  const task: CommandTaskRecord = {
    id: nextTaskId(),
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

async function probeProcessRunning(pid: number): Promise<boolean | null> {
  if (!Number.isFinite(pid) || pid <= 0)
    return false

  const shell = await resolveShell()
  const probe = shell === 'powershell' || shell === 'pwsh'
    ? `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { exit 0 } else { exit 1 }`
    : `kill -0 ${pid}`
  const resolved: ResolvedShellCommand = shell === 'powershell' || shell === 'pwsh'
    ? { binary: shell, args: createShellArgs(shell, probe) }
    : await resolveShellCommand(probe)

  try {
    const result = await Command.create(resolved.binary, resolved.args).execute()
    return result.code === 0
  }
  catch {
    return null
  }
}

async function forceKillProcess(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0)
    return false

  const shell = await resolveShell()
  const cmd = shell === 'powershell' || shell === 'pwsh'
    ? `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
    : `kill -9 ${pid}`
  const resolved: ResolvedShellCommand = shell === 'powershell' || shell === 'pwsh'
    ? { binary: shell, args: createShellArgs(shell, cmd) }
    : await resolveShellCommand(cmd)

  try {
    const result = await Command.create(resolved.binary, resolved.args).execute()
    return result.code === 0
  }
  catch {
    return false
  }
}

async function reconcileRunningTask(task: CommandTaskRecord): Promise<CommandTaskRecord> {
  if (task.status !== 'running')
    return task

  const handle = taskHandles.get(task.id)
  if (!handle || handle.pid == null)
    return task

  const isRunning = await probeProcessRunning(handle.pid)
  if (isRunning !== false)
    return task

  handle.resolveCompletion?.({
    code: null,
    inferredExit: true,
  })

  const completion = taskPromises.get(task.id)
  if (completion) {
    try {
      await completion
    }
    catch {
      // The tracked task state is the source of truth even if the promise rejects.
    }
  }

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

  // Try child.kill() for non-background tasks; skip for background (detached) processes
  if (handle.child != null && task.mode !== 'background') {
    try {
      await handle.child.kill()
    }
    catch (e) {
      task.stderr = appendOutput(task.stderr, `\n[kill error] ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Force kill by PID after a short delay — this is the reliable path for background tasks
  if (pid != null) {
    setTimeout(() => {
      void (async () => {
        if (task.status !== 'running')
          return

        console.warn(`[shell] Task ${id} (PID ${pid}) still running, force killing`)
        const killed = await forceKillProcess(pid)
        if (killed)
          task.stderr = appendOutput(task.stderr, `\n[force killed PID ${pid}]`)
        else
          task.stderr = appendOutput(task.stderr, `\n[warning: force kill failed for PID ${pid}]`)

        // Mark task as killed regardless — process may die asynchronously
        if (task.status === 'running')
          finalizeTask(task, handle, { status: 'killed', exitCode: null, note: 'Force killed' })
        touchTasks()
      })()
    }, 300)
  }
  else {
    // No PID available — just finalize immediately
    if (task.status === 'running')
      finalizeTask(task, handle, { status: 'killed', exitCode: null, note: 'Killed (no PID)' })
  }

  touchTasks()
  return snapshotTask(task)
}

export async function stopManagedCommandTask(id: string): Promise<CommandTaskSummary | null> {
  return await stopTaskInternal(id)
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
  let livenessTimer: ReturnType<typeof setInterval> | null = null
  let probeInFlight = false

  const command = options.createCommand()

  command.stdout.on('data', (chunk: string) => {
    stdout = appendOutput(stdout, chunk)
    options.task.stdout = appendOutput(options.task.stdout, chunk)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stdout', chunk)
    touchTasks()
  })
  command.stderr.on('data', (chunk: string) => {
    stderr = appendOutput(stderr, chunk)
    options.task.stderr = appendOutput(options.task.stderr, chunk)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', chunk)
    touchTasks()
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
    if (livenessTimer != null) {
      clearInterval(livenessTimer)
      livenessTimer = null
    }
    resolveDone(value)
  }

  options.handle.resolveCompletion = settleDone

  command.on('close', event => settleDone({ code: event.code }))
  command.on('error', error => settleDone({ code: null, spawnError: String(error) }))

  const onAbort = () => {
    if (options.handle.child != null && !options.handle.stopRequested) {
      options.handle.stopRequested = true
      void options.handle.child.kill()
    }
  }
  options.abortSignal?.addEventListener('abort', onAbort, { once: true })

  try {
    const child = await command.spawn()
    options.handle.child = child
    options.handle.pid = child.pid

    livenessTimer = setInterval(() => {
      if (doneResolved || probeInFlight || options.handle.pid == null)
        return

      probeInFlight = true
      void probeProcessRunning(options.handle.pid)
        .then(isRunning => {
          if (isRunning === false)
            settleDone({ code: null, inferredExit: true })
        })
        .finally(() => {
          probeInFlight = false
        })
    }, 2000)
  }
  catch (e) {
    status = 'spawn_error'
    const message = e instanceof Error ? e.message : String(e)
    stderr = appendOutput(stderr, message)
    options.task.stderr = appendOutput(options.task.stderr, message)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', message)
    options.handle.child = null
    options.handle.pid = null
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
    timer = setTimeout(() => {
      options.handle.timeoutRequested = true
      settleDone({ code: null, transferred: true })
    }, options.timeoutMs)
  }

  const settled = await done

  if (timer != null)
    clearTimeout(timer)

  if (!settled.transferred) {
    options.handle.child = null
    options.handle.pid = null
    options.handle.resolveCompletion = null
  }
  options.abortSignal?.removeEventListener('abort', onAbort)

  if (options.handle.stopRequested) {
    status = 'killed'
    stderr = appendOutput(stderr, '[killed by user]')
    options.task.stderr = appendOutput(options.task.stderr, '[killed by user]')
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', '[killed by user]')
  }
  else if (settled.transferred) {
    status = 'timed_out'
    const note = `[timed out after ${Math.floor(options.timeoutMs / 1000)}s — continues in background]`
    stderr = appendOutput(stderr, note)
    options.task.stderr = appendOutput(options.task.stderr, note)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', note)
  }
  else if (settled.spawnError) {
    status = 'spawn_error'
    stderr = appendOutput(stderr, settled.spawnError)
    options.task.stderr = appendOutput(options.task.stderr, settled.spawnError)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', settled.spawnError)
  }
  else if (settled.inferredExit) {
    const note = '[process exited without a shell close event; exit code unavailable]'
    stderr = appendOutput(stderr, note)
    options.task.stderr = appendOutput(options.task.stderr, note)
    emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', note)
  }
  else if (settled.code !== 0) {
    const semantic = interpretExitCode(options.displayCommand, settled.code)
    if (semantic.note) {
      stderr = appendOutput(stderr, semantic.note)
      options.task.stderr = appendOutput(options.task.stderr, semantic.note)
      emitToolOutput(options.runtimeEvents, 'git_command', options.toolCallId, 'stderr', semantic.note)
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

    if (result.status === 'timed_out' && !handle.stopRequested) {
      options.task.mode = 'background'
      options.task.status = 'running'
      touchTasks()
      return options.task
    }

    if (result.status === 'timed_out') {
      finalizeTask(options.task, handle, {
        status: 'timed_out',
      })
      return options.task
    }

    if (result.status === 'spawn_error' || result.exitCode !== 0) {
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

function startGitSequence(options: {
  cwd: string
  commands: Array<{ args: string[] }>
  timeoutMs: number
  abortSignal?: AbortSignal
  coAuthor?: boolean
  runtimeEvents?: ShellToolRuntimeEvents
  toolCallId?: string
}): { task: CommandTaskRecord; done: Promise<CommandTaskRecord> } {
  const commands = applyCoAuthorTrailer(options.commands, options.coAuthor ?? false)

  const task = createTaskRecord({
    kind: 'git',
    mode: 'exec',
    cwd: options.cwd,
    summary: buildGitSummary(commands),
    commandCount: commands.length,
  })

  const done = runTrackedSequence({
    task,
    timeoutMs: options.timeoutMs,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.runtimeEvents ? { runtimeEvents: options.runtimeEvents } : {}),
    ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    specs: commands.map(command => ({
      displayCommand: `git ${command.args.join(' ')}`,
      createCommand: () => Command.create('git', command.args, { cwd: options.cwd }),
    })),
  })

  taskPromises.set(task.id, done)
  return { task, done }
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

export function createRunCommandTool(projectPath: string, runtimeEvents?: ShellToolRuntimeEvents) {
  if (!cwdRef)
    cwdRef = projectPath

  return tool({
    description: `Run a shell command in the project directory.

Use is_background: true for long-running processes (dev servers, watchers) — returns immediately.
Large output (>500 lines) is automatically truncated (tail kept) and saved to a log file.
Working directory persists across commands via the cwd parameter.

Examples:
- { command: "pnpm build" }
- { command: "curl http://localhost:8000" }
- { command: "pnpm dev", is_background: true }
- { command: "ls", cwd: "src" }`,
    inputSchema: runCommandInputSchema,
    execute: async (input, execOptions) => {
      const { abortSignal } = execOptions
      const toolCallId = getExecutionToolCallId(execOptions)
      const command = input.command.trim()
      if (!command)
        return { exit_code: -1, duration_ms: 0, output: 'Error: command cannot be empty.' }

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

      // ── Background mode ─────────────────────────────────────────────
      if (input.is_background) {
        const resolved = await resolveShellCommand(command)
        const cmd = Command.create(resolved.binary, resolved.args, { cwd })

        const task = createTaskRecord({
          kind: 'shell',
          mode: 'background',
          cwd,
          summary: command,
          commandCount: 1,
        })

        cmd.stdout.on('data', (chunk: string) => {
          task.stdout = appendOutput(task.stdout, chunk)
          emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stdout', chunk)
          touchTasks()
        })
        cmd.stderr.on('data', (chunk: string) => {
          task.stderr = appendOutput(task.stderr, chunk)
          emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', chunk)
          touchTasks()
        })

        try {
          const child = await cmd.spawn()
          task.currentCommand = command
          const startMessage = `Background task ${task.id} started. PID: ${child.pid}.\n`
          emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stdout', startMessage)

          cmd.on('close', (event: { code: number | null }) => {
            finalizeTask(task, taskHandles.get(task.id) ?? { child, pid: child.pid ?? null, stopRequested: false, timeoutRequested: false, resolveCompletion: null }, {
              status: event.code === 0 ? 'completed' : 'failed',
              exitCode: event.code,
            })
            emitToolOutput(runtimeEvents, 'run_command', toolCallId, event.code === 0 ? 'stdout' : 'stderr', `\n[process exited with code ${event.code ?? 'unknown'}]`)
          })
          cmd.on('error', () => {
            finalizeTask(task, taskHandles.get(task.id) ?? { child, pid: child.pid ?? null, stopRequested: false, timeoutRequested: false, resolveCompletion: null }, {
              status: 'failed',
              exitCode: -1,
              note: 'Spawn error',
            })
            emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', '\n[spawn error]')
          })

          taskHandles.set(task.id, { child, pid: child.pid ?? null, stopRequested: false, timeoutRequested: false, resolveCompletion: null })
          touchTasks()

          return {
            exit_code: 0,
            duration_ms: 0,
            task_id: task.id,
            output: `Background task ${task.id} started. PID: ${child.pid}. Use action: "status" with id: "${task.id}" to check on it.`,
          }
        }
        catch (e) {
          finalizeTask(task, { child: null, pid: null, stopRequested: false, timeoutRequested: false, resolveCompletion: null }, {
            status: 'failed',
            exitCode: -1,
            note: e instanceof Error ? e.message : String(e),
          })
          emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', `Error spawning background process: ${e instanceof Error ? e.message : String(e)}`)
          return {
            exit_code: -1,
            duration_ms: 0,
            output: `Error spawning background process: ${e instanceof Error ? e.message : String(e)}`,
          }
        }
      }

      // ── Foreground execution ────────────────────────────────────────
      const timeoutMs = input.timeout_ms ?? 120_000
      const spawnTime = Date.now()
      let output = ''
      let fullOutput = ''

      const appendProcessOutput = (chunk: string) => {
        fullOutput += chunk
        output = appendOutput(output, chunk)
      }

      const resolved = await resolveShellCommand(command)
      const cmd = Command.create(resolved.binary, resolved.args, { cwd })

      cmd.stdout.on('data', (chunk: string) => {
        appendProcessOutput(chunk)
        emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stdout', chunk)
      })
      cmd.stderr.on('data', (chunk: string) => {
        appendProcessOutput(chunk)
        emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', chunk)
      })

      let resolveDone!: (value: { code: number | null; error?: string }) => void
      const done = new Promise<{ code: number | null; error?: string }>(resolve => {
        resolveDone = resolve
      })

      cmd.on('close', event => resolveDone({ code: event.code }))
      cmd.on('error', error => resolveDone({ code: null, error: String(error) }))

      let child: Child | null = null
      const onAbort = () => {
        void child?.kill()
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true })

      try {
        child = await cmd.spawn()
      }
      catch (e) {
        abortSignal?.removeEventListener('abort', onAbort)
        emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', `Error spawning process: ${e instanceof Error ? e.message : String(e)}`)
        return {
          exit_code: -1,
          duration_ms: Date.now() - spawnTime,
          output: `Error spawning process: ${e instanceof Error ? e.message : String(e)}`,
        }
      }

      // Timeout monitor
      let timer: ReturnType<typeof setTimeout> | null = null
      let timedOut = false

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          void child?.kill()
        }, timeoutMs)
      }

      const settled = await done

      if (timer != null)
        clearTimeout(timer)
      abortSignal?.removeEventListener('abort', onAbort)

      const durationMs = Date.now() - spawnTime
      let exitCode = settled.code

      if (timedOut) {
        exitCode = -1
        appendProcessOutput(`\n[timed out after ${Math.floor(timeoutMs / 1000)}s]`)
        emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', `\n[timed out after ${Math.floor(timeoutMs / 1000)}s]`)
      }
      else if (settled.error) {
        exitCode = -1
        appendProcessOutput(`\n[spawn error: ${settled.error}]`)
        emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', `\n[spawn error: ${settled.error}]`)
      }
      else if (exitCode !== 0) {
        const semantic = interpretExitCode(command, exitCode)
        if (semantic.note) {
          appendProcessOutput(`\n${semantic.note}`)
          emitToolOutput(runtimeEvents, 'run_command', toolCallId, 'stderr', `\n${semantic.note}`)
        }
      }

      // ── Tail-based truncation ───────────────────────────────────────
      let logPath: string | null = null
      const displaySource = fullOutput || output
      const lines = displaySource.split(/\r?\n/g)
      const shouldTruncateByLines = lines.length > MAX_OUTPUT_LINES
      const shouldTruncateByChars = displaySource.length > MAX_OUTPUT_CHARS
      if (shouldTruncateByLines || shouldTruncateByChars) {
        const displayOutput = shouldTruncateByLines
          ? lines.slice(-MAX_OUTPUT_LINES).join('\n')
          : trimOutput(displaySource)
        logPath = await writeLogOutputFile(command, displaySource)
        const reason = shouldTruncateByLines
          ? `${lines.length} lines total, showing last ${MAX_OUTPUT_LINES}`
          : `${displaySource.length} chars total, showing a shortened preview`
        const logNote = logPath
          ? `[Output truncated: ${reason}. Full output saved to: ${logPath}]\n---\n`
          : `[Output truncated: ${reason}.]\n---\n`
        output = `${logNote}${displayOutput.trimEnd()}`
      }
      else {
        output = displaySource.trimEnd()
      }

      return {
        exit_code: exitCode ?? -1,
        duration_ms: durationMs,
        output,
        ...(logPath ? { log_path: logPath } : {}),
      }
    },
  })
}

export function createGitCommandTool(projectPath: string, coAuthor = false, runtimeEvents?: ShellToolRuntimeEvents) {
  const coAuthorNote = coAuthor
    ? '\n\nCo-authoring is ENABLED: every commit automatically includes a Co-authored-by trailer (Emty Agent). Do NOT add it yourself.'
    : ''

  return tool({
    description: `Production-grade git runner.

For normal execution, omit action and pass command or commands.
String commands are allowed, so "status --short" is valid.
Use action: "status", "kill", or "list" to inspect or stop tracked tasks from either git_command or run_command.

Examples:
- { command: "status --short" }
- { commands: ["status --short", "diff --stat"] }
- { commands: [{ args: ["commit", "-m", "feat: add hero"] }] }
- { action: "status", id: "cmd4" }${coAuthorNote}`,
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
      timeoutSeconds: z.number().int().min(5).max(300).optional().describe('Per-command timeout in seconds. Default: 60.'),
      waitForMs: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('Optional wait window in milliseconds. If the sequence is still running when this wait expires, the tool returns early with a taskId and the git work continues. Default: wait until exit.'),
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

      const timeoutMs = (input.timeoutSeconds ?? 60) * 1000
      const { task, done } = startGitSequence({
        cwd: projectPath,
        commands: normalized.commands,
        timeoutMs,
        coAuthor,
        ...(abortSignal ? { abortSignal } : {}),
        ...(runtimeEvents ? { runtimeEvents } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      })

      const waited = await waitForTask(task, done, input.waitForMs)
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

export function createShellTools(projectPath: string, shell?: ShellBinary, coAuthor?: boolean, runtimeEvents?: ShellToolRuntimeEvents) {
  if (shell === 'sh' || shell === 'pwsh')
    primeShell(shell)

  return {
    run_command: createRunCommandTool(projectPath, runtimeEvents),
    git_command: createGitCommandTool(projectPath, coAuthor, runtimeEvents),
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
      const commands = [
        ...(single ? [{ args: single }] : []),
        ...(Array.isArray(args.commands)
          ? args.commands.flatMap(command => {
              if (typeof command === 'string') {
                const args = splitQuotedArgs(command)
                return args.length > 0 ? [{ args }] : []
              }
              if (typeof command === 'object' && command != null && Array.isArray((command as { args?: unknown }).args))
                return [{ args: (command as { args: string[] }).args }]
              return []
            })
          : []),
      ]

      if (!commands.length)
        return 'Git operation'
      if (commands.length === 1)
        return gitArgLabel(commands[0]!.args)
      return `${gitArgLabel(commands[0]!.args)} +${commands.length - 1} more`
    }

    default:
      return `Called ${toolName}`
  }
}
