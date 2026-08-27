/**
 * Security blocklists — defaults for path & command protection.
 * Each item is editable via the Developer → Security panel.
 * Overrides are stored in settings.securityOverrides (persisted).
 */

import type { SecurityPlatform } from './platform'
import { getPlatformAsync, getPlatformSync } from './platform'
import { getSecurityOverridesFromStore as getCache, setSecurityOverridesCache as setCache } from './securityCache'

export type { SecurityPlatform }

export interface SecurityItem {
  id: string
  label: string
  content: string
  group: string
  description: string
}

export const SHELL_BLOCKED_MESSAGE
  = 'Blocked by security policy: command matches shell blocklist. Edit Developer → Security → "Blocked Shell Commands" to allow it.'

export const SENSITIVE_READ_BLOCKED_MESSAGE
  = 'Access denied: sensitive file blocked for read. The read tool is not allowed to open secrets like .env / keys / credentials. If the user explicitly requested this file, use run_command (e.g., `cat` or `type`) to read it instead.'

// ── Default contents ───────────────────────────────────────────────────────

// One path per line. Windows-style absolute paths. Case-insensitive.
// Lines starting with # are ignored (comments).
const DEFAULT_WINDOWS_DENY_ROOTS = `# Windows system paths that are blocked for WRITE operations.
# One absolute path per line. These are matched as prefix (children are also blocked).
C:\\Windows
C:\\Program Files
C:\\Program Files (x86)
C:\\ProgramData`

const DEFAULT_LINUX_DENY_ROOTS = `# Linux system paths that are blocked for WRITE operations.
# One absolute path per line. Applied only when running on Linux.
# Matched as prefix — children are also blocked.
/etc
/usr
/bin
/sbin
/boot
/proc
/sys
/dev
/root
/var/log
/var/lib
/snap`

const DEFAULT_MACOS_DENY_ROOTS = `# macOS system paths that are blocked for WRITE operations.
# One absolute path per line. Applied only when running on macOS.
# macOS merges Linux list + this list (Unix-like).
/System
/Library
/private
/usr
/etc
/var
/bin
/sbin
/Applications`

// One segment path per line, slash-separated. Example: ".config/gh" → matches ~/.config/gh
// Lines starting with # are ignored.
const DEFAULT_SENSITIVE_SEGMENTS = `# Sensitive home sub-paths — matched as path segments relative to home dir.
# One entry per line, segments separated by "/". Blocked when accessed OUTSIDE the project workspace.
# Cross-platform core
.ssh
.aws
.gnupg
.codex
.claude
.anthropic
.openai
.gemini
.cursor
.config/gh
.config/op
# Windows
AppData/Roaming/Code/User
AppData/Local/Google/Chrome/User Data
AppData/Local/Microsoft/Edge/User Data
# Linux
.pki
.docker
.kube
.config/sudo
.local/share/keyrings
.snap
# macOS
Library/Keychains
Library/Application Support
Library/Preferences`

// One regex per line (case-insensitive). Lines starting with # are ignored.
// Supports plain pattern (e.g. "^\\.env(?:\\..+)?$") → compiled as /pattern/i
// Or delimited form "/pattern/flags" (e.g. "/^passwd$/i").
const DEFAULT_SENSITIVE_PATTERNS = `# Sensitive filenames — matched against the basename. One regex per line (treated as case-insensitive unless flags specified).
^\\.env(?:\\..+)?$
^\\.npmrc$
^\\.pypirc$
^\\.?netrc$
^auth\\.json$
^credentials\\.json$
^id_(rsa|dsa|ecdsa|ed25519)(?:\\.pub)?$
\\.(?:pem|key|p12|pfx)$
^passwd$
^shadow$
^sudoers$`

// One regex per line for shell commands. Lines starting with # are ignored.
// The command string is tested against each regex (case-insensitive by default).
// Examples are deliberately broad — tighten or loosen to taste.
const DEFAULT_SHELL_BLOCKLIST = `# Common blocked shell commands — one regex per line (applies on all platforms).
# Empty file = no extra blocking beyond permission-mode checks.
# Lines starting with # are comments.

# --- destructive filesystem (cross-platform) ---
\\brm\\s+.*-rf\\s+/
\\bmkfs\\.
\\bdd\\s+.*of=\\s*/dev/
\\bchmod\\s+.*777\\s+/
\\bchown\\s+.*\\s+/

# --- system power (cross-platform) ---
\\bshutdown\\b
\\breboot\\b
\\bhalt\\b
\\bpoweroff\\b

# --- fork bomb & similar ---
:\\(\\)\\s*\\{\\s*:\\|:\\&
`

const DEFAULT_SHELL_BLOCKLIST_WINDOWS = `# Windows-specific blocked shell commands — applied only on Windows.
# One regex per line, case-insensitive.

\\bformat\\b.*[a-z]:
\\bdel\\s+/[fqs]\\s+.*\\\\Windows
\\breg\\s+delete\\b
\\bpowershell\\b.*-EncodedCommand
\\bbcdedit\\b
`

const DEFAULT_SHELL_BLOCKLIST_LINUX = `# Linux-specific blocked shell commands — applied only on Linux.
# One regex per line, case-insensitive.

\\bsudo\\s+rm\\s+.*-rf\\s+/
\\bsudo\\s+mkfs\\.
\\bchmod\\s+-R\\s+777\\s+/
\\bchown\\s+-R\\s+.*\\s+/
\\bwipefs\\b
\\bshred\\b
`

const DEFAULT_SHELL_BLOCKLIST_MACOS = `# macOS-specific blocked shell commands — applied only on macOS.
# One regex per line, case-insensitive.
# macOS also inherits Linux list (Unix-like).

\\bcsrutil\\s+disable\\b
\\bspctl\\s+--master-disable\\b
\\bdiskutil\\s+eraseDisk\\b
\\blaunchctl\\s+unload\\b
\\bcsrutil\\b
`

export const SECURITY_ITEMS: SecurityItem[] = [
  {
    id: 'windows-deny-roots',
    label: 'Windows System Deny Roots',
    content: DEFAULT_WINDOWS_DENY_ROOTS,
    group: 'Path Protection',
    description: 'Absolute Windows paths blocked for write operations (prefix match). One per line.',
  },
  {
    id: 'linux-deny-roots',
    label: 'Linux System Deny Roots',
    content: DEFAULT_LINUX_DENY_ROOTS,
    group: 'Path Protection',
    description: 'Absolute Linux paths blocked for write operations (prefix match). Applied only on Linux. One per line.',
  },
  {
    id: 'macos-deny-roots',
    label: 'macOS System Deny Roots',
    content: DEFAULT_MACOS_DENY_ROOTS,
    group: 'Path Protection',
    description: 'Absolute macOS paths blocked for write operations (prefix match). Applied only on macOS. Merges Linux list.',
  },
  {
    id: 'sensitive-segments',
    label: 'Sensitive Home Segments',
    content: DEFAULT_SENSITIVE_SEGMENTS,
    group: 'Path Protection',
    description: 'Home-relative segment paths whose files are hidden from the agent. One slash-separated entry per line.',
  },
  {
    id: 'sensitive-patterns',
    label: 'Sensitive File Patterns',
    content: DEFAULT_SENSITIVE_PATTERNS,
    group: 'Path Protection',
    description: 'Basename regex blocklist for sensitive files (.env, keys, etc.). One regex per line, case-insensitive.',
  },
  {
    id: 'shell-blocklist',
    label: 'Common Shell Blocklist',
    content: DEFAULT_SHELL_BLOCKLIST,
    group: 'Command Protection',
    description: 'Cross-platform regex blocklist for shell commands. Tested against the full command string.',
  },
  {
    id: 'shell-blocklist-windows',
    label: 'Windows Shell Blocklist',
    content: DEFAULT_SHELL_BLOCKLIST_WINDOWS,
    group: 'Command Protection',
    description: 'Windows-specific shell regex blocklist. Applied only on Windows.',
  },
  {
    id: 'shell-blocklist-linux',
    label: 'Linux Shell Blocklist',
    content: DEFAULT_SHELL_BLOCKLIST_LINUX,
    group: 'Command Protection',
    description: 'Linux-specific shell regex blocklist. Applied only on Linux.',
  },
  {
    id: 'shell-blocklist-macos',
    label: 'macOS Shell Blocklist',
    content: DEFAULT_SHELL_BLOCKLIST_MACOS,
    group: 'Command Protection',
    description: 'macOS-specific shell regex blocklist. Applied only on macOS. Merges Linux list.',
  },
]

export const SECURITY_ITEM_MAP = new Map(SECURITY_ITEMS.map(i => [i.id, i]))

// ── Helpers to read effective content ─────────────────────────────────────

export function getSecurityDefault(id: string): string {
  return SECURITY_ITEM_MAP.get(id)?.content ?? ''
}

export function getSecurityEffectiveContent(
  id: string,
  overrides: Record<string, string> | undefined | null,
): string {
  const ov = overrides?.[id]
  if (typeof ov === 'string')
    return ov
  return getSecurityDefault(id)
}

// ── Parsers ────────────────────────────────────────────────────────────────

function cleanLines(content: string): string[] {
  return content
    .split(/\r?\n/g)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

// Memoization caches — avoid recompiling identical blocklists every call
const sensitivePatternsCache = new Map<string, RegExp[]>()
const shellBlocklistCache = new Map<string, RegExp[]>()
const shellPatternsCache = new Map<string, RegExp[]>()
let shellPatternsCacheVersion = 0

// Invalidate shell patterns cache when overrides change (called via securityCache)
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('storage', e => {
      if (e.key === 'settings')
        shellPatternsCacheVersion++
    })
  }
  catch {}
}

export function parseDenyRoots(content: string): string[] {
  return cleanLines(content)
}
export const parseWindowsDenyRoots = parseDenyRoots
export const parseLinuxDenyRoots = parseDenyRoots
export const parseMacosDenyRoots = parseDenyRoots

export function parseSensitiveSegments(content: string): string[][] {
  return cleanLines(content)
    .map(line => line.split('/').map(s => s.trim()).filter(Boolean))
    .filter(segs => segs.length > 0)
}

export function parseSensitivePatterns(content: string): RegExp[] {
  const cached = sensitivePatternsCache.get(content)
  if (cached)
    return cached
  const lines = cleanLines(content)
  const out: RegExp[] = []
  for (const line of lines) {
    const re = compileUserRegex(line, 'i')
    if (re)
      out.push(re)
  }
  sensitivePatternsCache.set(content, out)
  // Bound cache size to avoid unbounded growth from custom overrides
  if (sensitivePatternsCache.size > 50) {
    const firstKey = sensitivePatternsCache.keys().next().value as string | undefined
    if (firstKey)
      sensitivePatternsCache.delete(firstKey)
  }
  return out
}

export function parseShellBlocklist(content: string): RegExp[] {
  const cached = shellBlocklistCache.get(content)
  if (cached)
    return cached
  const lines = cleanLines(content)
  const out: RegExp[] = []
  for (const line of lines) {
    const re = compileUserRegex(line, 'i')
    if (re)
      out.push(re)
  }
  shellBlocklistCache.set(content, out)
  if (shellBlocklistCache.size > 50) {
    const firstKey = shellBlocklistCache.keys().next().value as string | undefined
    if (firstKey)
      shellBlocklistCache.delete(firstKey)
  }
  return out
}

export function clearSecurityPatternCaches(): void {
  sensitivePatternsCache.clear()
  shellBlocklistCache.clear()
  shellPatternsCache.clear()
  shellPatternsCacheVersion++
}

// Validate without swallowing errors — used by SecurityPanel UI
export function getBlocklistParseErrors(content: string): string[] {
  const lines = content.split(/\r?\n/g).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'))
  const errors: string[] = []
  for (const line of lines) {
    const err = compileUserRegexWithError(line, 'i')
    if (err.error)
      errors.push(`"${line}": ${err.error}`)
  }
  return errors
}

function getEffectiveParsed<T>(id: string, parser: (content: string) => T, overrides?: Record<string, string>): T {
  const map = overrides ?? getCache()
  return parser(getSecurityEffectiveContent(id, map))
}

export function getEffectiveWindowsDenyRoots(overrides?: Record<string, string>): string[] {
  return getEffectiveParsed('windows-deny-roots', parseDenyRoots, overrides)
}

export function getEffectiveLinuxDenyRoots(overrides?: Record<string, string>): string[] {
  return getEffectiveParsed('linux-deny-roots', parseDenyRoots, overrides)
}

export function getEffectiveMacosDenyRoots(overrides?: Record<string, string>): string[] {
  return getEffectiveParsed('macos-deny-roots', parseDenyRoots, overrides)
}

// ── Platform helpers (re-export for back-compat) ─────────────────────────
export { getPlatformAsync, getPlatformSync } from './platform'

// ── System roots / shell patterns ────────────────────────────────────────

export function getEffectiveSystemDenyRoots(
  platform: SecurityPlatform,
  overrides?: Record<string, string>,
): string[] {
  const map = overrides ?? getCache()
  if (platform === 'windows')
    return getEffectiveWindowsDenyRoots(map)
  if (platform === 'linux')
    return getEffectiveLinuxDenyRoots(map)
  if (platform === 'macos') {
    // macOS inherits Linux (Unix-like) + its own
    return [...getEffectiveLinuxDenyRoots(map), ...getEffectiveMacosDenyRoots(map)]
  }
  // unknown: return all to be safe
  return [...getEffectiveWindowsDenyRoots(map), ...getEffectiveLinuxDenyRoots(map), ...getEffectiveMacosDenyRoots(map)]
}

function collectShellPatterns(platform: SecurityPlatform, map: Record<string, string>): RegExp[] {
  const common = parseShellBlocklist(getSecurityEffectiveContent('shell-blocklist', map))
  const byId = (id: string) => parseShellBlocklist(getSecurityEffectiveContent(id, map))
  if (platform === 'windows')
    return [...common, ...byId('shell-blocklist-windows')]
  if (platform === 'linux')
    return [...common, ...byId('shell-blocklist-linux')]
  if (platform === 'macos')
    return [...common, ...byId('shell-blocklist-linux'), ...byId('shell-blocklist-macos')]
  return [...common, ...byId('shell-blocklist-windows'), ...byId('shell-blocklist-linux'), ...byId('shell-blocklist-macos')]
}

function shellPatternsCacheKey(platform: SecurityPlatform, map: Record<string, string>): string {
  // Hash relevant blocklist contents + platform + version
  const ids = platform === 'windows'
    ? ['shell-blocklist', 'shell-blocklist-windows']
    : platform === 'linux'
      ? ['shell-blocklist', 'shell-blocklist-linux']
      : platform === 'macos'
        ? ['shell-blocklist', 'shell-blocklist-linux', 'shell-blocklist-macos']
        : ['shell-blocklist', 'shell-blocklist-windows', 'shell-blocklist-linux', 'shell-blocklist-macos']
  const parts = ids.map(id => `${id}:${getSecurityEffectiveContent(id, map).length}:${getSecurityEffectiveContent(id, map).slice(0, 64)}`)
  return `${platform}:${shellPatternsCacheVersion}:${parts.join('|')}`
}

export function getEffectiveShellPatterns(
  platform: SecurityPlatform,
  overrides?: Record<string, string>,
): RegExp[] {
  // If caller supplied explicit overrides, bypass cache (caller-managed)
  if (overrides) {
    return collectShellPatterns(platform, overrides)
  }
  const map = getCache()
  const key = shellPatternsCacheKey(platform, map)
  const cached = shellPatternsCache.get(key)
  if (cached)
    return cached
  const result = collectShellPatterns(platform, map)
  shellPatternsCache.set(key, result)
  if (shellPatternsCache.size > 20) {
    const firstKey = shellPatternsCache.keys().next().value as string | undefined
    if (firstKey)
      shellPatternsCache.delete(firstKey)
  }
  return result
}

function compileUserRegex(raw: string, defaultFlags: string): RegExp | null {
  const result = compileUserRegexWithError(raw, defaultFlags)
  return result.regex
}

function compileUserRegexWithError(raw: string, defaultFlags: string): { regex: RegExp | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed)
    return { regex: null, error: null }
  // delimited form: /pattern/flags
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/')
    const pattern = trimmed.slice(1, lastSlash)
    const flags = trimmed.slice(lastSlash + 1) || defaultFlags
    try {
      return { regex: new RegExp(pattern, flags), error: null }
    }
    catch (e) {
      return { regex: null, error: e instanceof Error ? e.message : String(e) }
    }
  }
  try {
    return { regex: new RegExp(trimmed, defaultFlags), error: null }
  }
  catch (e) {
    return { regex: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Runtime access to store (re-export for back-compat) ──────────────────
export { getSecurityOverridesFromStore, setSecurityOverridesCache } from './securityCache'
export const getSecurityOverridesFromStoreAlias = getCache
export const setSecurityOverridesCacheAlias = setCache

export function isShellCommandBlocked(command: string, overrides?: Record<string, string>): boolean {
  const platform = getPlatformSync()
  const patterns = getEffectiveShellPatterns(platform, overrides)
  if (patterns.length === 0)
    return false
  return patterns.some(re => re.test(command))
}

export async function isShellCommandBlockedAsync(
  command: string,
  overrides?: Record<string, string>,
): Promise<boolean> {
  const platform = await getPlatformAsync()
  const patterns = getEffectiveShellPatterns(platform, overrides)
  if (patterns.length === 0)
    return false
  return patterns.some(re => re.test(command))
}
