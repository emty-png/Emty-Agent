import type { HookCommand, HookDecision, HookEvent, HookInput, HookOutput } from './types'
import { exists } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'
import { BLOCKABLE_EVENTS, isBlockableEvent } from './types'

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
      return candidate.shell
    }
  }

  // Fall back to `where git` to find git.exe and derive bash.exe path
  try {
    const result = await Command.create('cmd', ['/d', '/s', '/c', 'where git']).execute()
    if (result.code !== 0 || !result.stdout.trim()) {
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
    return _resolvedShell
  }

  // Try sh first (Git Bash or WSL on PATH)
  try {
    const result = await Command.create('sh', ['-c', 'exit 0']).execute()
    if (result.code === 0) {
      _resolvedShell = 'sh'
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
    return _resolvedShell
  }

  // Try pwsh (PowerShell 7)
  try {
    const result = await Command.create('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']).execute()
    if (result.code === 0) {
      _resolvedShell = 'pwsh'
      return _resolvedShell
    }
  }
  catch { /* ignore */ }

  // Fall back to Windows PowerShell
  _resolvedShell = 'powershell'
  return _resolvedShell
}

// ── Per-tab abort tracking for kill-all ─────────────────────────────────────

const hookAbortControllers = new Map<string, Set<AbortController>>()

function trackHookController(tabId: string, controller: AbortController): void {
  let set = hookAbortControllers.get(tabId)
  if (!set) {
    set = new Set()
    hookAbortControllers.set(tabId, set)
  }
  set.add(controller)
}

function untrackHookController(tabId: string, controller: AbortController): void {
  const set = hookAbortControllers.get(tabId)
  if (!set)
    return
  set.delete(controller)
  if (set.size === 0)
    hookAbortControllers.delete(tabId)
}

export function abortHooksForTab(tabId: string): void {
  const set = hookAbortControllers.get(tabId)
  if (!set)
    return
  for (const c of [...set]) {
    try { c.abort() }
    catch {}
  }
  hookAbortControllers.delete(tabId)
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
  // Skip disabled commands
  if (command.enabled === false)
    return { output: null, exitCode: 0 }

  try {
    const timeoutMs = (command.timeoutSec ?? 5) * 1000
    const inputJson = JSON.stringify(input)
    const effectiveCwd = command.cwd ?? cwd

    // Build environment variables
    const env: Record<string, string> = {
      EMTY_EVENT: input.event,
      EMTY_TAB_ID: input.tabId,
      EMTY_WORKSPACE: input.workspacePath ?? '',
      EMTY_PROJECT_NAME: input.projectName ?? '',
      EMTY_INPUT: inputJson.length > 28000 ? inputJson.slice(0, 28000) : inputJson,
      ...(command.env ?? {}),
    }

    if ('toolName' in input)
      env.EMTY_TOOL_NAME = (input as unknown as { toolName: string }).toolName
    if ('filePath' in input)
      env.EMTY_FILE_PATH = (input as unknown as { filePath: string }).filePath
    if ('command' in input && typeof (input as unknown as { command: unknown }).command === 'string')
      env.EMTY_COMMAND = (input as unknown as { command: string }).command
    if ('conversationId' in input && typeof (input as unknown as { conversationId: unknown }).conversationId === 'string')
      env.EMTY_CONVERSATION_ID = (input as unknown as { conversationId: string }).conversationId
    if ('mode' in input && typeof (input as unknown as { mode: unknown }).mode === 'string')
      env.EMTY_MODE = (input as unknown as { mode: string }).mode
    if ('prompt' in input && typeof (input as unknown as { prompt: unknown }).prompt === 'string')
      env.EMTY_PROMPT = String((input as unknown as { prompt: string }).prompt).slice(0, 8000)

    // Create temp file for full EMTY_INPUT to avoid env limit
    let inputFilePath: string | null = null
    try {
      const { join } = await import('@tauri-apps/api/path')
      const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
      const { tempDir } = await import('@tauri-apps/api/path')
      const tmpBase = await tempDir().catch(() => input.workspacePath ?? '')
      const tmpDir = tmpBase ? await join(tmpBase, 'emty-hooks') : null
      if (tmpDir) {
        await mkdir(tmpDir, { recursive: true }).catch(() => {})
        const fname = `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
        inputFilePath = await join(tmpDir, fname)
        await writeFile(inputFilePath, new TextEncoder().encode(inputJson)).catch(() => { inputFilePath = null })
        if (inputFilePath)
          env.EMTY_INPUT_FILE = inputFilePath
      }
    }
    catch { /* ignore temp file errors */ }

    let shell: ShellBinary | 'node' = 'sh'
    let args: string[]
    let cmdName: string

    if (command.type === 'js') {
      // Inline JS executed via node -e. Fallback to shell if node missing
      const jsCode = command.file ?? command.command
      // Wrap to provide input and allow returning JSON via console.log
      const wrapped = `
const input = JSON.parse(process.env.EMTY_INPUT || '{}');
(async () => {
  ${jsCode}
})().then(out => { if(out && typeof out==='object') console.log(JSON.stringify(out)); }).catch(e => { console.error(e && e.message || String(e)); process.exit(1); });
`
      cmdName = 'node'
      args = ['-e', wrapped]
    }
    else if (command.type === 'node') {
      const target = command.file ?? command.command
      // If target looks like JS code (contains ; or \n or return), use -e, else treat as file path
      const looksLikeFile = target.trim().endsWith('.js') || target.trim().endsWith('.mjs') || (!target.includes('\n') && !target.includes(';') && !target.includes('return') && target.split(' ').length === 1)
      if (looksLikeFile && !target.includes('\n')) {
        cmdName = 'node'
        args = [target]
      }
      else {
        cmdName = 'node'
        args = ['-e', target]
      }
    }
    else {
      shell = await resolveShell()
      cmdName = shell
      args = createShellArgs(shell as ShellBinary, command.command)
    }

    const cmd = Command.create(cmdName as unknown as string, args, {
      ...(effectiveCwd != null ? { cwd: effectiveCwd } : {}),
      env,
    })

    const hookAbort = new AbortController()
    const tabIdForAbort = input.tabId
    if (tabIdForAbort)
      trackHookController(tabIdForAbort, hookAbort)

    // Abort-aware race: abort signal rejects the execution
    const abortPromise = new Promise<never>((_, reject) => {
      if (hookAbort.signal.aborted) {
        reject(new Error(`Hook aborted for tab ${tabIdForAbort}`))
        return
      }
      hookAbort.signal.addEventListener('abort', () => {
        reject(new Error(`Hook aborted for tab ${tabIdForAbort}`))
      }, { once: true })
    })

    let result: Awaited<ReturnType<typeof cmd.execute>>
    try {
      result = await Promise.race([
        cmd.execute(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Hook timed out after ${timeoutMs / 1000}s: ${command.command}`)), timeoutMs),
        ),
        abortPromise,
      ])
    }
    finally {
      if (tabIdForAbort)
        untrackHookController(tabIdForAbort, hookAbort)
    }

    // Cleanup temp file
    if (inputFilePath) {
      try {
        const { remove } = await import('@tauri-apps/plugin-fs')
        await remove(inputFilePath).catch(() => {})
      }
      catch { /* ignore */ }
    }

    const exitCode = result.code
    const stdout = result.stdout.trim()
    const stderr = result.stderr.trim()

    // Try to parse JSON from stdout
    let output: HookOutput | null = null
    const combined = stdout || stderr
    if (combined) {
      try {
        // Find JSON in stdout (may have non-JSON lines before/after)
        const jsonStart = combined.indexOf('{')
        const jsonEnd = combined.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          output = JSON.parse(combined.slice(jsonStart, jsonEnd + 1)) as HookOutput
        }
        else {
          output = { systemMessage: combined }
        }
      }
      catch {
        // Non-JSON output is treated as a system message
        output = { systemMessage: combined }
      }
    }

    return { output, exitCode }
  }
  catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
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
  entries: Array<{ command: HookCommand; priority?: number; runMode?: string }>
  /** Max cumulative time (ms) for all hooks in this event. No limit if omitted. */
  eventTimeoutMs?: number
  /** Custom events registry for blockable check */
  customEvents?: Record<string, { blockable?: boolean }>
}

/**
 * Run all hook commands for a lifecycle event.
 * Returns an aggregated decision: first deny wins, all systemMessages/additionalContexts collected.
 * Fail-open: errors are swallowed and treated as allow unless continueOnError is false.
 */
export async function runHooksForEntries(options: RunHooksOptions): Promise<HookDecision> {
  const { event, input, workspacePath, entries, eventTimeoutMs, customEvents } = options
  const isBlockable = BLOCKABLE_EVENTS.has(event) || isBlockableEvent(event, customEvents)
  const eventStart = Date.now()

  const decision: HookDecision = {
    allowed: true,
    systemMessages: [],
    additionalContexts: [],
  }

  const flatEntries = entries

  // Support per-entry runMode — for now we flatten to sequential; parallel entries are still executed sequentially
  // Future: if any entry has runMode parallel, we could Promise.all them
  const hasParallel = flatEntries.some(e => (e as unknown as { runMode?: string }).runMode === 'parallel')
  if (hasParallel) {
    // Execute parallel groups concurrently (simple: run all in parallel, then aggregate)
    const promises = flatEntries.map(e => runSingleHookCommand(e.command, input, workspacePath))
    const results = await Promise.all(promises)
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      if (result.error)
        continue
      if (result.output) {
        if (result.output.systemMessage)
          decision.systemMessages.push(result.output.systemMessage)
        if (result.output.additionalContext)
          decision.additionalContexts.push(result.output.additionalContext)
        if (result.output.toolInputPatch) {
          decision.toolInputPatch = { ...(decision.toolInputPatch ?? {}), ...result.output.toolInputPatch }
        }
        if (result.output.envPatch) {
          decision.envPatch = { ...(decision.envPatch ?? {}), ...result.output.envPatch }
        }
        if (isBlockable && result.output.permissionDecision === 'deny') {
          decision.allowed = false
          decision.reason = result.output.permissionDecisionReason ?? 'Blocked by hook'
        }
      }
      if (isBlockable && result.exitCode === 2) {
        decision.allowed = false
        decision.reason = results[i]!.output?.permissionDecisionReason ?? 'Hook exited with code 2'
      }
    }
    return decision
  }

  for (let i = 0; i < flatEntries.length; i++) {
    const entry = flatEntries[i]!
    if (eventTimeoutMs && Date.now() - eventStart >= eventTimeoutMs) {
      break
    }

    const result = await runSingleHookCommand(entry.command, input, workspacePath)

    if (result.error) {
      continue
    }

    if (result.output) {
      if (result.output.systemMessage)
        decision.systemMessages.push(result.output.systemMessage)

      if (result.output.additionalContext)
        decision.additionalContexts.push(result.output.additionalContext)

      if (result.output.toolInputPatch) {
        decision.toolInputPatch = { ...(decision.toolInputPatch ?? {}), ...result.output.toolInputPatch }
      }
      if (result.output.envPatch) {
        decision.envPatch = { ...(decision.envPatch ?? {}), ...result.output.envPatch }
      }

      if (isBlockable && result.output.permissionDecision === 'deny') {
        decision.allowed = false
        decision.reason = result.output.permissionDecisionReason ?? 'Blocked by hook'
        break
      }
    }

    // Exit code 2 = blocking error
    if (isBlockable && result.exitCode === 2) {
      decision.allowed = false
      decision.reason = result.output?.permissionDecisionReason ?? 'Hook exited with code 2'
      break
    }
  }

  return decision
}
