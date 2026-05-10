/**
 * src/utils/tools/shell.ts
 *
 * Shell execution tools for the Emty coding agent.
 *   • run_command  — run one or more shell commands sequentially in the project directory
 *   • git_command  — run one or more git operations sequentially in the project directory
 *
 * Both tools:
 *   - Execute with the project root as the working directory
 *   - Run sequentially so later commands can depend on earlier ones
 *   - Stop the sequence on first failure and report skipped commands
 *   - Return stdout, stderr, exit code, and duration per command
 *   - Trim oversized output before returning it to the model context
 *
 * Security note:
 *   run_command executes arbitrary shell strings. This is intentional for a developer
 *   coding agent. The cwd sandbox limits the *default* working directory but does not
 *   prevent `cd`, absolute paths, or network calls inside the command string. Only open
 *   projects you trust.
 *
 * Tauri requirements:
 *   @tauri-apps/plugin-shell must be installed and configured.
 *   See SETUP.md for Cargo.toml, lib.rs, tauri.conf.json, and capabilities changes.
 */

import { Child, Command } from '@tauri-apps/plugin-shell'
import { tool } from 'ai'
import { z } from 'zod'

// ── constants ─────────────────────────────────────────────────────────────────

/**
 * Trim threshold for stdout / stderr returned to the model.
 * Large outputs (webpack noise, verbose install logs) are trimmed head + tail
 * so the model still sees the beginning and the actionable end.
 */
const MAX_OUTPUT_CHARS = 32_000

// ── background process registry ───────────────────────────────────────────────

/**
 * In-memory registry of background processes spawned by run_bg_command.
 * Persists for the lifetime of the app — finished entries are kept so the
 * agent can still read their final output after they exit.
 * Capped at MAX_BG_PROCESSES; oldest finished entries are evicted first.
 */
const MAX_BG_PROCESSES = 20

interface BgProcess {
  id: string
  command: string
  stdout: string
  stderr: string
  running: boolean
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
}

const bgProcesses = new Map<string, BgProcess>()
const bgChildren = new Map<string, Child>()
let _bgCounter = 0

function newBgId(): string {
  return `bg${++_bgCounter}`
}

/** Evict oldest finished entries when the registry is full. */
function evictBgIfNeeded(): void {
  if (bgProcesses.size < MAX_BG_PROCESSES)
    return
  for (const [id, p] of bgProcesses) {
    if (!p.running) {
      bgProcesses.delete(id)
      bgChildren.delete(id)
      if (bgProcesses.size < MAX_BG_PROCESSES)
        break
    }
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

interface CommandResult {
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

/** Resolved once per process lifetime — avoids a platform() call on every execute(). */
let _resolvedShell: 'sh' | 'powershell' | null = null

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Lazily resolve which shell to use for run_command.
 * Reads OsInfo injected at app startup when available; falls back to
 * a runtime platform() check the first time it is called.
 * Result is cached for the lifetime of the process.
 */
export function primeShell(shell: 'sh' | 'powershell'): void {
  _resolvedShell = shell
}

async function resolveShell(): Promise<'sh' | 'powershell'> {
  if (_resolvedShell != null)
    return _resolvedShell
  // Fallback: runtime detection (only happens if primeShell was never called)
  const { platform } = await import('@tauri-apps/plugin-os')
  const p = await platform()
  _resolvedShell = p === 'windows' ? 'powershell' : 'sh'
  return _resolvedShell
}

/** Trim very large outputs — keep the head and tail so errors remain visible. */
function trimOutput(raw: string): string {
  if (raw.length <= MAX_OUTPUT_CHARS)
    return raw.trimEnd()
  const half = Math.floor(MAX_OUTPUT_CHARS / 2)
  const head = raw.slice(0, half).trimEnd()
  const tail = raw.slice(-half).trimStart()
  return `${head}\n\n[... ${(raw.length / 1024).toFixed(0)} KB of output trimmed — showing head and tail ...]\n\n${tail}`
}

/** Wrap a promise with a hard timeout. Rejects with a descriptive error. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)),
        ms,
      ),
    ),
  ])
}

/**
 * Execute one shell command string in the given working directory.
 *   Unix  → sh  -c  "<cmd>"
 *   Windows → powershell -NoProfile -NonInteractive -Command "<cmd>"
 *
 * The -NoProfile / -NonInteractive flags keep PowerShell launches fast and
 * deterministic (no user profile side-effects).
 */
async function execShellCommand(
  commandStr: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const shell = await resolveShell()
  const start = Date.now()

  const shellArgs
    = shell === 'powershell'
      ? ['-NoProfile', '-NonInteractive', '-Command', commandStr]
      : ['-c', commandStr]

  const cmd = Command.create(shell, shellArgs, { cwd })

  try {
    const output = await withTimeout(cmd.execute(), timeoutMs, commandStr)
    return {
      command: commandStr,
      exitCode: output.code,
      stdout: trimOutput(output.stdout),
      stderr: trimOutput(output.stderr),
      durationMs: Date.now() - start,
    }
  }
  catch (e) {
    return {
      command: commandStr,
      exitCode: null,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Execute one git operation with the given argument list.
 * Spawns the git binary directly — no shell interpretation, no injection risk.
 */
async function execGitCommand(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const start = Date.now()
  const label = `git ${args.join(' ')}`
  const cmd = Command.create('git', args, { cwd })

  try {
    const output = await withTimeout(cmd.execute(), timeoutMs, label)
    return {
      command: label,
      exitCode: output.code,
      stdout: trimOutput(output.stdout),
      stderr: trimOutput(output.stderr),
      durationMs: Date.now() - start,
    }
  }
  catch (e) {
    return {
      command: label,
      exitCode: null,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    }
  }
}

/** Render a list of CommandResults into a compact string for the model. */
function formatResults(results: CommandResult[]): string {
  return results
    .map(r => {
      const dur = `${(r.durationMs / 1000).toFixed(1)}s`
      const status
        = r.exitCode === 0
          ? `✓ ${dur}`
          : r.exitCode === null
            ? `✗ timeout/error ${dur}`
            : `✗ exit ${r.exitCode} ${dur}`

      const lines: string[] = [`$ ${r.command}  [${status}]`]
      if (r.stdout)
        lines.push(r.stdout)
      if (r.stderr)
        lines.push(`[stderr]\n${r.stderr}`)
      return lines.join('\n')
    })
    .join('\n\n──────────────────────────────────────────\n\n')
}

// ── run_command ───────────────────────────────────────────────────────────────

export function createRunCommandTool(projectPath: string) {
  return tool({
    description: `\
Run one or more shell commands sequentially in the project root directory.
Commands execute in order — each one can depend on the previous (e.g. install → build → test).
The working directory is always the project root; no need to cd into it.

Prefer batching related operations into a single call rather than making multiple tool calls.
The sequence stops automatically on the first non-zero exit code and reports which commands were skipped.

Use this for:
  • Package manager operations: npm install, pip install, cargo build
  • Build scripts: npm run build, make, gradle assembleDebug
  • Test runners: npm test, pytest, go test ./...
  • Dev servers, linters, formatters, database migrations — any shell task

Good examples:
  commands: ["npm install"]
  commands: ["npm install", "npm run build"]
  commands: ["pip install -r requirements.txt", "python manage.py migrate", "python manage.py collectstatic"]
  commands: ["cargo fmt --check", "cargo clippy -- -D warnings", "cargo test"]

Returns per command: stdout, stderr, exit code, duration.`,
    inputSchema: z.object({
      commands: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe(
          'Shell commands to run in sequence. Each string is a complete, self-contained shell command.',
        ),
      timeoutSeconds: z
        .number()
        .int()
        .min(5)
        .max(600)
        .optional()
        .describe(
          'Per-command timeout in seconds. Default: 300 (5 minutes). '
          + 'Increase for very slow builds; decrease for commands that should be fast.',
        ),
    }),
    execute: async ({ commands, timeoutSeconds }) => {
      const timeoutMs = (timeoutSeconds ?? 300) * 1000
      const results: CommandResult[] = []

      for (const cmd of commands) {
        const result = await execShellCommand(cmd, projectPath, timeoutMs)
        results.push(result)

        if (result.exitCode !== 0) {
          const skipped = commands.slice(results.length)
          return {
            results: formatResults(results),
            ...(skipped.length > 0
              ? {
                  skipped,
                  note: `Stopped after failure. ${skipped.length} command(s) were not run.`,
                }
              : {}),
          }
        }
      }

      return { results: formatResults(results) }
    },
  })
}

// ── git_command ───────────────────────────────────────────────────────────────

export function createGitCommandTool(projectPath: string) {
  return tool({
    description: `\
Run one or more git operations sequentially in the project root directory.
Each command is specified as a list of arguments that follow the "git" binary — do not include "git" itself.
Operations run in order so you can stage, commit, and push in a single call.
The sequence stops automatically on the first failure and reports which operations were skipped.

Prefer batching related operations into a single call.

Good examples:
  commands: [{ args: ["status"] }]
  commands: [{ args: ["add", "."], }, { args: ["commit", "-m", "feat: add login page"] }]
  commands: [{ args: ["pull", "origin", "main"] }]
  commands: [{ args: ["add", "src/auth.ts"] }, { args: ["commit", "-m", "fix: null check"] }, { args: ["push"] }]
  commands: [{ args: ["stash"] }, { args: ["checkout", "-b", "feature/new-ui"] }, { args: ["stash", "pop"] }]

Returns per operation: stdout, stderr, exit code, duration.`,
    inputSchema: z.object({
      commands: z
        .array(
          z.object({
            args: z
              .array(z.string())
              .min(1)
              .describe(
                'Git arguments without the leading "git". '
                + 'Example: ["commit", "-m", "fix: handle edge case"]',
              ),
          }),
        )
        .min(1)
        .max(20)
        .describe('Git operations to run sequentially.'),
      timeoutSeconds: z
        .number()
        .int()
        .min(5)
        .max(300)
        .optional()
        .describe(
          'Per-operation timeout in seconds. Default: 60. '
          + 'Increase for git clone or fetch over slow connections.',
        ),
    }),
    execute: async ({ commands, timeoutSeconds }) => {
      const timeoutMs = (timeoutSeconds ?? 60) * 1000
      const results: CommandResult[] = []

      for (const { args } of commands) {
        const result = await execGitCommand(args, projectPath, timeoutMs)
        results.push(result)

        if (result.exitCode !== 0) {
          const skipped = commands.slice(results.length).map(c => `git ${c.args.join(' ')}`)
          return {
            results: formatResults(results),
            ...(skipped.length > 0
              ? {
                  skipped,
                  note: `Stopped after git failure. ${skipped.length} operation(s) were not run.`,
                }
              : {}),
          }
        }
      }

      return { results: formatResults(results) }
    },
  })
}

// ── run_bg_command ────────────────────────────────────────────────────────────

/**
 * Spawn a shell command in the background. Returns immediately with an ID —
 * the agent can continue working while the process runs.
 * Use bg_command_status to poll output and kill_bg_command to terminate it.
 */
export function createRunBgCommandTool(projectPath: string) {
  return tool({
    description: `\
Spawn a shell command in the background and return immediately.
The command keeps running while you continue with other tasks.
Returns an id you can pass to bg_command_status or kill_bg_command.

Use this for long-running processes that should not block the agent:
  • Dev servers:   npm run dev, vite, next dev, cargo watch
  • Build watchers: tsc --watch, webpack --watch
  • Test watchers:  jest --watch, vitest --watch
  • Any process you want to start and then check on later

Do NOT use this for short commands (installs, one-off builds) — use run_command instead.`,
    inputSchema: z.object({
      command: z.string().min(1).describe('Shell command to run in the background.'),
      label: z.string().optional().describe('Optional short human label shown in the UI (e.g. "dev server").'),
    }),
    execute: async ({ command, label }) => {
      evictBgIfNeeded()

      const id = newBgId()
      const shell = await resolveShell()
      const shellArgs = shell === 'powershell'
        ? ['-NoProfile', '-NonInteractive', '-Command', command]
        : ['-c', command]

      const proc: BgProcess = {
        id,
        command: label ? `${label} (${command})` : command,
        stdout: '',
        stderr: '',
        running: true,
        exitCode: null,
        startedAt: Date.now(),
        finishedAt: null,
      }
      bgProcesses.set(id, proc)

      const cmd = Command.create(shell, shellArgs, { cwd: projectPath })

      cmd.stdout.on('data', (line: string) => {
        proc.stdout = trimOutput(`${proc.stdout + line}\n`)
      })
      cmd.stderr.on('data', (line: string) => {
        proc.stderr = trimOutput(`${proc.stderr + line}\n`)
      })
      cmd.on('close', (data: { code: number | null }) => {
        proc.running = false
        proc.exitCode = data.code
        proc.finishedAt = Date.now()
        bgChildren.delete(id)
      })
      cmd.on('error', (err: string) => {
        proc.running = false
        proc.exitCode = null
        proc.finishedAt = Date.now()
        proc.stderr += `\n[spawn error] ${err}`
        bgChildren.delete(id)
      })

      try {
        const child = await cmd.spawn()
        bgChildren.set(id, child)
        return {
          id,
          message: `Background process started with id "${id}". Use bg_command_status to check on it.`,
        }
      }
      catch (e) {
        bgProcesses.delete(id)
        return {
          id,
          error: `Failed to spawn: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
  })
}

// ── bg_command_status ─────────────────────────────────────────────────────────

export function createBgCommandStatusTool() {
  return tool({
    description: `\
Get the current status and output of a background command started with run_bg_command.
Returns running state, exit code (if finished), and buffered stdout / stderr.
Output is trimmed if very large — head and tail are always preserved.`,
    inputSchema: z.object({
      id: z.string().describe('Background process id returned by run_bg_command.'),
    }),
    execute: async ({ id }) => {
      const proc = bgProcesses.get(id)
      if (!proc) {
        return { error: `No background process found with id "${id}". It may have been evicted or never started.` }
      }

      const durationMs = proc.finishedAt != null
        ? proc.finishedAt - proc.startedAt
        : Date.now() - proc.startedAt

      return {
        id: proc.id,
        command: proc.command,
        running: proc.running,
        exitCode: proc.exitCode,
        durationSeconds: Math.floor(durationMs / 1000),
        ...(proc.stdout ? { stdout: proc.stdout } : {}),
        ...(proc.stderr ? { stderr: proc.stderr } : {}),
      }
    },
  })
}

// ── kill_bg_command ───────────────────────────────────────────────────────────

export function createKillBgCommandTool() {
  return tool({
    description: `\
Terminate a background command that was started with run_bg_command.
Sends a kill signal to the process and marks it as stopped.
Returns the final buffered output collected before the kill.`,
    inputSchema: z.object({
      id: z.string().describe('Background process id returned by run_bg_command.'),
    }),
    execute: async ({ id }) => {
      const proc = bgProcesses.get(id)
      if (!proc) {
        return { error: `No background process found with id "${id}".` }
      }
      if (!proc.running) {
        return {
          id,
          message: `Process "${id}" was already stopped (exit code: ${proc.exitCode ?? 'unknown'}).`,
        }
      }

      const child = bgChildren.get(id)
      try {
        await child?.kill()
      }
      catch (e) {
        // kill() may throw if the process already exited between the check and the call
        proc.stderr += `\n[kill error] ${e instanceof Error ? e.message : String(e)}`
      }

      proc.running = false
      proc.finishedAt = Date.now()
      bgChildren.delete(id)

      return {
        id,
        message: `Process "${id}" killed.`,
        ...(proc.stdout ? { stdout: proc.stdout } : {}),
        ...(proc.stderr ? { stderr: proc.stderr } : {}),
      }
    },
  })
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Create both shell tools bound to a project directory.
 *
 * Pass the `shell` from OsInfo so the resolved shell is cached immediately
 * rather than being detected lazily on the first command.
 *
 * @example
 * const shellTools = createShellTools(projectPath, osInfo.shell)
 * const tools = { ...createFilesystemTools(projectPath), ...shellTools }
 */
export function createShellTools(projectPath: string, shell?: 'sh' | 'powershell') {
  if (shell != null)
    primeShell(shell)

  return {
    run_command: createRunCommandTool(projectPath),
    git_command: createGitCommandTool(projectPath),
    run_bg_command: createRunBgCommandTool(projectPath),
    bg_command_status: createBgCommandStatusTool(),
    kill_bg_command: createKillBgCommandTool(),
  } as const
}

export type ShellTools = ReturnType<typeof createShellTools>

// ── display labels ────────────────────────────────────────────────────────────

/** Trim a command string to a readable length for badge display. */
function truncate(s: string, max = 52): string {
  const trimmed = s.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** Extract a human-readable label from git args. */
function gitArgLabel(args: string[]): string {
  const sub = args[0]?.toLowerCase() ?? 'operation'

  switch (sub) {
    case 'add': {
      const targets = args.slice(1).join(' ') || '.'
      return `Git staged ${truncate(targets, 32)}`
    }
    case 'commit': {
      const mIdx = args.indexOf('-m')
      const msg = mIdx !== -1 ? args[mIdx + 1] : undefined
      return msg ? `Git commit: ${truncate(msg, 48)}` : 'Git commit'
    }
    case 'push': {
      const remote = args[1] ?? 'origin'
      const branch = args[2]
      return branch ? `Git push ${remote}/${branch}` : `Git push ${remote}`
    }
    case 'pull': {
      const remote = args[1] ?? 'origin'
      const branch = args[2]
      return branch ? `Git pull ${remote}/${branch}` : `Git pull ${remote}`
    }
    case 'fetch': return `Git fetch ${args[1] ?? 'origin'}`
    case 'checkout': return `Git checkout ${args.slice(1).join(' ')}`
    case 'branch': return args.length > 1 ? `Git branch ${args.slice(1).join(' ')}` : 'Git branches'
    case 'merge': return `Git merge ${args.slice(1).join(' ')}`
    case 'rebase': return `Git rebase ${args.slice(1).join(' ')}`
    case 'stash': return args[1] ? `Git stash ${args[1]}` : 'Git stash'
    case 'reset': return `Git reset ${args.slice(1).join(' ')}`
    case 'restore': return `Git restore ${args.slice(1).join(' ')}`
    case 'status': return 'Git status'
    case 'log': return 'Git log'
    case 'diff': return args.length > 1 ? `Git diff ${args.slice(1).join(' ')}` : 'Git diff'
    case 'tag': return `Git tag ${args.slice(1).join(' ')}`
    case 'init': return 'Git init'
    case 'clone': return `Git clone ${truncate(args[1] ?? '', 40)}`
    case 'remote': return `Git remote ${args[1] ?? ''}`
    case 'submodule': return `Git submodule ${args[1] ?? ''}`
    default: return `Git ${sub}`
  }
}

export function shellToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'run_command': {
      const commands = args.commands as string[] | undefined
      if (!commands?.length)
        return 'Run command'
      if (commands.length === 1)
        return `Run: ${truncate(commands[0]!)}`
      return `Run: ${truncate(commands[0]!)} +${commands.length - 1} more`
    }

    case 'git_command': {
      const commands = args.commands as { args: string[] }[] | undefined
      if (!commands?.length)
        return 'Git operation'
      if (commands.length === 1)
        return gitArgLabel(commands[0]!.args)
      const first = gitArgLabel(commands[0]!.args)
      return `${first} +${commands.length - 1} more`
    }

    case 'run_bg_command': {
      const command = args.command as string | undefined
      const label = args.label as string | undefined
      if (label)
        return `BG: ${truncate(label, 48)}`
      return command ? `BG: ${truncate(command)}` : 'Run background command'
    }

    case 'bg_command_status': {
      const id = args.id as string | undefined
      return id ? `Status ${id}` : 'BG command status'
    }

    case 'kill_bg_command': {
      const id = args.id as string | undefined
      return id ? `Kill ${id}` : 'Kill BG command'
    }

    default:
      return `Called ${toolName}`
  }
}
