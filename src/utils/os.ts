/**
 * src/utils/os.ts
 *
 * Thin wrapper around @tauri-apps/plugin-os.
 * Provides a typed OsInfo struct and a helper to format it
 * as a system-prompt injection for the AI agent.
 *
 * getOsInfo() is safe to call on every sendMessage — the result is cached
 * after the first successful resolution and subsequent calls return instantly.
 *
 * Requires: @tauri-apps/plugin-os (see SETUP.md)
 */

import { exists } from '@tauri-apps/plugin-fs'
import { arch, platform, version } from '@tauri-apps/plugin-os'
import { Command } from '@tauri-apps/plugin-shell'

// ── types ─────────────────────────────────────────────────────────────────────

export type OsPlatform
  = | 'linux'
    | 'macos'
    | 'freebsd'
    | 'dragonfly'
    | 'netbsd'
    | 'openbsd'
    | 'solaris'
    | 'windows'

export interface OsInfo {
  platform: OsPlatform
  arch: string
  version: string
  /** Shell used by run_command: 'sh' on all Unix-like platforms, 'powershell' on Windows. */
  shell: 'sh' | 'powershell'
  /** User-facing shell name for prompt injection. Git Bash is described as Bash. */
  shellName: 'sh' | 'Bash' | 'PowerShell'
  /** Human-readable platform name for display and prompt injection. */
  displayName: string
}

// ── cache ─────────────────────────────────────────────────────────────────────

const PLATFORM_DISPLAY: Partial<Record<string, string>> = {
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
  ios: 'iOS',
  android: 'Android',
  freebsd: 'FreeBSD',
  dragonfly: 'DragonFly BSD',
  netbsd: 'NetBSD',
  openbsd: 'OpenBSD',
  solaris: 'Solaris',
}

/**
 * Module-level cache. Populated on the first successful call to getOsInfo().
 * Never re-fetched — the OS cannot change while the app is running.
 */
let _cache: OsInfo | null = null

/**
 * In-flight promise deduplication: if two callers hit getOsInfo() before the
 * first one resolves, they share the same underlying Promise rather than
 * firing three concurrent Tauri IPC calls.
 */
let _inflight: Promise<OsInfo> | null = null

async function hasWindowsBash(): Promise<boolean> {
  try {
    const result = await Command.create('sh', ['-c', 'exit 0']).execute()
    if (result.code === 0)
      return true
  }
  catch {
    // Bash may still be available as Git's bundled bash.exe outside PATH.
  }

  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]

  for (const candidate of commonPaths) {
    if (await exists(candidate))
      return true
  }

  try {
    const result = await Command.create('cmd', ['/d', '/s', '/c', 'where git']).execute()
    if (result.code !== 0 || !result.stdout.trim())
      return false

    const gitPaths = result.stdout
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean)

    for (const gitPath of gitPaths) {
      const bashPath = gitPath.replace(/\//g, '\\').replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe')
      const isAllowedPath = commonPaths.some(path => path.toLowerCase() === bashPath.toLowerCase())
      if (isAllowedPath && await exists(bashPath))
        return true
    }
  }
  catch {
    return false
  }

  return false
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Fetch OS information from the Tauri OS plugin.
 *
 * All three native calls are issued in parallel on the first invocation.
 * The result is cached for the lifetime of the process — subsequent calls
 * return the cached value synchronously inside the resolved Promise.
 */
export async function getOsInfo(): Promise<OsInfo> {
  if (_cache)
    return _cache

  if (_inflight)
    return _inflight

  _inflight = (async () => {
    const [p, a, v] = await Promise.all([platform(), arch(), version()])
    let shellName: OsInfo['shellName'] = 'sh'
    if (p === 'windows')
      shellName = await hasWindowsBash() ? 'Bash' : 'PowerShell'

    const info: OsInfo = {
      platform: p as OsPlatform,
      arch: a,
      version: v,
      shell: p === 'windows' ? 'powershell' : 'sh',
      shellName,
      displayName: PLATFORM_DISPLAY[p] ?? p,
    }
    _cache = info
    _inflight = null
    return info
  })()

  return _inflight
}

/**
 * Build the "## Operating Environment" section injected into system prompts.
 * Tells the agent which shell syntax to use, the correct path separator,
 * and any platform-specific caveats.
 */
export function osPromptSection(info: OsInfo): string {
  const isWindows = info.platform === 'windows'
  const usesBash = info.shellName === 'Bash' || (!isWindows && info.shell === 'sh')
  const sep = usesBash ? '/' : isWindows ? '\\' : '/'

  const shellLine = usesBash
    ? `- Shell: Bash${isWindows ? ' (Windows)' : ''} — use Bash syntax in run_command`
    : isWindows
      ? '- Shell: PowerShell (Windows) — use PowerShell syntax in run_command'
      : '- Shell: sh (POSIX) — use POSIX sh syntax in run_command'

  const syntaxNote = usesBash
    ? `- Command chaining: use && (stop on failure) or ; (always continue) or | for pipes.
- Environment variables: $VAR_NAME
- Path separator in shell commands: /`
    : isWindows
      ? `- Command chaining: use semicolons (cmd1; cmd2) or -and / -or operators.
- Environment variables: $env:VAR_NAME
- Path separator: \\`
      : `- Command chaining: use && (stop on failure) or ; (always continue) or | for pipes.
- Environment variables: $VAR_NAME
- Path separator: /`

  const platformNote = usesBash
    ? '- Prefer portable Bash commands and relative paths when possible.'
    : isWindows
      ? '- Prefer PowerShell-native commands (Get-ChildItem, Copy-Item) over Unix aliases when available.'
      : '- Prefer POSIX-portable commands when writing scripts intended to run on CI.'

  return `\
## Operating Environment
- Platform: ${info.displayName} ${info.version} (${info.arch})
${shellLine}
${syntaxNote}
${platformNote}
- Default path separator: ${sep}`
}
