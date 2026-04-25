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

import { arch, platform, version } from '@tauri-apps/plugin-os'

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
    const info: OsInfo = {
      platform: p as OsPlatform,
      arch: a,
      version: v,
      shell: p === 'windows' ? 'powershell' : 'sh',
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
  const sep = isWindows ? '\\' : '/'

  const shellLine = isWindows
    ? '- Shell: PowerShell (Windows) — use PowerShell syntax in run_command'
    : '- Shell: sh (POSIX) — use POSIX sh syntax in run_command'

  const syntaxNote = isWindows
    ? `- Command chaining: use semicolons (cmd1; cmd2) or -and / -or operators.
- Environment variables: $env:VAR_NAME
- Path separator: \\`
    : `- Command chaining: use && (stop on failure) or ; (always continue) or | for pipes.
- Environment variables: $VAR_NAME
- Path separator: /`

  const platformNote = isWindows
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
