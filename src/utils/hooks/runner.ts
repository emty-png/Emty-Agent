import type { HookCommand, HookDecision, HookEvent, HookInput, HookOutput } from './types'
import { exists } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'
import { BLOCKABLE_EVENTS } from './types'

// ── Shell resolution (ported from src/utils/tools/shell.ts) ──────────────────

type ShellBinary = 'sh' | 'powershell' | 'pwsh' | 'git-bash' | 'git-bash-x86'
type GitBashShell = Extract<ShellBinary, 'git-bash' | 'git-bash-x86'>

function createShellArgs(shell: ShellBinary, command: string): string[] {
  if (shell === 'powershell' || shell === 'pwsh')
    return ['-NoProfile', '-NonInteractive', '-Command', command]
  if (shell === 'git-bash' || shell === 'git-bash-x86')
    return ['-lc', command]
  return ['-c', command]
}

let _resolvedShell: ShellBinary | null = null
let _gitBashPromise: Promise<GitBashShell | null> | null = null

async function probeGitBashShell(): Promise<GitBashShell | null> {
  const commonPaths: Array<{ shell: GitBashShell; path: string }> = [
    { shell: 'git-bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
    { shell: 'git-bash-x86', path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe' },
  ]

  // Check common install paths first
  for (const candidate of commonPaths) {
    if (await exists(candidate.path)) {
      console.warn(`[hooks] Git Bash found at: ${candidate.path}`)
      return candidate.shell
    }
  }

  // Fall back to `where git` to find git.exe and derive bash.exe path
  try {
    const result = await Command.create('cmd', ['/d', '/s', '/c', 'where git']).execute()
    if (result.code !== 0 || !result.stdout.trim()) {
      console.warn('[hooks] where git failed — no Git installation found')
      return null
    }

    const candidates = result.stdout
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean)

    for (const gitPath of candidates) {
      const normalizedGitPath = gitPath.replace(/\//g, '\\')
      const bashPath = normalizedGitPath.replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe')
      if (bashPath === normalizedGitPath)
        continue
      const match = commonPaths.find(c => c.path.toLowerCase() === bashPath.toLowerCase())
      if (match && await exists(match.path)) {
        console.warn(`[hooks] Git Bash derived from git path: ${gitPath} → ${match.path}`)
        return match.shell
      }
    }
  }
  catch {
    // ignore
  }

  return null
}

async function getGitBashShell(): Promise<GitBashShell | null> {
  _gitBashPromise ??= probeGitBashShell()
  return await _gitBashPromise
}

async function resolveShell(): Promise<ShellBinary> {
  if (_resolvedShell)
    return _resolvedShell

  const { platform } = await import('@tauri-apps/plugin-os')
  const currentPlatform = await platform()
  if (currentPlatform !== 'windows') {
    _resolvedShell = 'sh'
    console.warn('[hooks] Shell resolved: sh (non-Windows platform)')
    return _resolvedShell
  }

  // Try sh first (Git Bash or WSL on PATH)
  try {
    const result = await Command.create('sh', ['-c', 'exit 0']).execute()
    if (result.code === 0) {
      _resolvedShell = 'sh'
      console.warn('[hooks] Shell resolved: sh (Git Bash/WSL on PATH)')
      return _resolvedShell
    }
  }
  catch {
    // sh not on PATH — try finding Git Bash at common install locations
  }

  // Try Git Bash at common install paths
  const gitBash = await getGitBashShell()
  if (gitBash) {
    _resolvedShell = gitBash
    console.warn(`[hooks] Shell resolved: ${gitBash} (Git Bash from install path)`)
    return _resolvedShell
  }

  // Try pwsh (PowerShell 7)
  try {
    const result = await Command.create('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']).execute()
    if (result.code === 0) {
      _resolvedShell = 'pwsh'
      console.warn('[hooks] Shell resolved: pwsh (PowerShell 7 found)')
      return _resolvedShell
    }
  }
  catch { /* ignore */ }

  // Fall back to Windows PowerShell
  _resolvedShell = 'powershell'
  console.warn('[hooks] Shell resolved: powershell (fallback)')
  return _resolvedShell
}

// ── ID generator ──────────────────────────────────────────────────────────────

let _hookIdCounter = 0
export function makeHookId(): string {
  return `hook-${Date.now()}-${++_hookIdCounter}`
}

// ── Single hook command execution ─────────────────────────────────────────────

interface HookRunResult {
  output: HookOutput | null
  exitCode: number | null
  error?: string
}

async function runSingleHookCommand(
  command: HookCommand,
  input: HookInput,
  cwd: string | null,
): Promise<HookRunResult> {
  const cmdStart = Date.now()
  try {
    const timeoutMs = (command.timeoutSec ?? 5) * 1000
    const inputJson = JSON.stringify(input)

    // Build environment variables
    const env: Record<string, string> = {
      EMTY_EVENT: input.event,
      EMTY_TAB_ID: input.tabId,
      EMTY_WORKSPACE: input.workspacePath ?? '',
      EMTY_PROJECT_NAME: input.projectName ?? '',
      EMTY_INPUT: inputJson,
    }

    if ('toolName' in input)
      env.EMTY_TOOL_NAME = input.toolName
    if ('filePath' in input)
      env.EMTY_FILE_PATH = input.filePath
    if ('command' in input && typeof input.command === 'string')
      env.EMTY_COMMAND = input.command

    // Run the user's command directly (no piping — input is in $EMTY_INPUT env var)
    const shell = await resolveShell()
    const args = createShellArgs(shell, command.command)
    const cmd = Command.create(shell, args, {
      ...(cwd != null ? { cwd } : {}),
      env,
    })

    // Log env vars (sans EMTY_INPUT which is large)
    const envLog = { ...env, EMTY_INPUT: `<${inputJson.length} bytes>` }
    console.warn(`[hooks] Executing — shell=${shell} command=${command.command} cwd=${cwd ?? '(none)'} timeout=${timeoutMs}ms env=`, envLog)

    const result = await Promise.race([
      cmd.execute(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Hook timed out after ${timeoutMs / 1000}s: ${command.command}`)), timeoutMs),
      ),
    ])

    const exitCode = result.code
    const stdout = result.stdout.trim()
    const stderr = result.stderr?.trim()
    const cmdTiming = Date.now() - cmdStart

    console.warn(`[hooks] Command finished — exitCode=${exitCode} stdout=${stdout.length}B stderr=${stderr?.length ?? 0}B timing=${cmdTiming}ms`)
    if (stdout)
      console.warn(`[hooks] stdout preview: ${stdout.slice(0, 300)}`)
    if (stderr)
      console.warn(`[hooks] stderr preview: ${stderr.slice(0, 300)}`)

    // Try to parse JSON from stdout
    let output: HookOutput | null = null
    if (stdout) {
      try {
        // Find JSON in stdout (may have non-JSON lines before/after)
        const jsonStart = stdout.indexOf('{')
        const jsonEnd = stdout.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          output = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as HookOutput
          console.warn('[hooks] Parsed JSON output:', output)
        }
        else {
          console.warn('[hooks] No JSON found in stdout — treating as system message')
          output = { systemMessage: stdout }
        }
      }
      catch {
        // Non-JSON output is treated as a system message
        console.warn('[hooks] JSON parse failed — treating stdout as system message')
        output = { systemMessage: stdout }
      }
    }

    return { output, exitCode }
  }
  catch (error) {
    const cmdTiming = Date.now() - cmdStart
    const errMsg = error instanceof Error ? error.message : String(error)
    console.warn(`[hooks] Command error — timing=${cmdTiming}ms error=${errMsg}`)
    return {
      output: null,
      exitCode: null,
      error: errMsg,
    }
  }
}

// ── Run all hooks for an event ────────────────────────────────────────────────

export interface RunHooksOptions {
  event: HookEvent
  input: HookInput
  workspacePath: string | null
  /** Hook entries to run (already resolved by config). */
  entries: Array<{ command: HookCommand }>
  /** Max cumulative time (ms) for all hooks in this event. No limit if omitted. */
  eventTimeoutMs?: number
}

/**
 * Run all hook commands for a lifecycle event.
 * Returns an aggregated decision: first deny wins, all systemMessages/additionalContexts collected.
 * Fail-open: errors are swallowed and treated as allow.
 */
export async function runHooksForEntries(options: RunHooksOptions): Promise<HookDecision> {
  const { event, input, workspacePath, entries, eventTimeoutMs } = options
  const isBlockable = BLOCKABLE_EVENTS.has(event)
  const eventStart = Date.now()

  console.warn(`[hooks] runHooksForEntries() start — event=${event} entries=${entries.length} blockable=${isBlockable} timeout=${eventTimeoutMs ?? 'none'}ms`)

  const decision: HookDecision = {
    allowed: true,
    systemMessages: [],
    additionalContexts: [],
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (eventTimeoutMs && Date.now() - eventStart >= eventTimeoutMs) {
      console.warn(`[hooks] Event-level timeout (${eventTimeoutMs}ms) reached for ${event} — skipping remaining ${entries.length - i} entry(ies)`)
      break
    }

    console.warn(`[hooks] Running command ${i + 1}/${entries.length}: ${entry.command.command}`)
    const result = await runSingleHookCommand(entry.command, input, workspacePath)

    if (result.error) {
      console.warn(`[hooks] Hook command failed: ${entry.command.command} — ${result.error}`)
      continue
    }

    if (result.output) {
      if (result.output.systemMessage)
        decision.systemMessages.push(result.output.systemMessage)

      if (result.output.additionalContext)
        decision.additionalContexts.push(result.output.additionalContext)

      if (isBlockable && result.output.permissionDecision === 'deny') {
        decision.allowed = false
        decision.reason = result.output.permissionDecisionReason ?? 'Blocked by hook'
        console.warn(`[hooks] Hook denied by command: ${entry.command.command} — ${decision.reason}`)
        break
      }
    }

    // Exit code 2 = blocking error
    if (isBlockable && result.exitCode === 2) {
      decision.allowed = false
      decision.reason = result.output?.permissionDecisionReason ?? 'Hook exited with code 2'
      console.warn(`[hooks] Hook denied by exit code 2: ${entry.command.command} — ${decision.reason}`)
      break
    }
  }

  const eventTiming = Date.now() - eventStart
  console.warn(`[hooks] runHooksForEntries() done — allowed=${decision.allowed} systemMessages=${decision.systemMessages.length} additionalContexts=${decision.additionalContexts.length} timing=${eventTiming}ms`)

  return decision
}
