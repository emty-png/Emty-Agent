/**
 * src/utils/tools/fs/allowedPaths.ts
 *
 * Reusable path whitelist and security module.
 * All filesystem tools should import path-safety functions from here.
 */

import {
  appCacheDir,
  appConfigDir,
  appDataDir,
  appLocalDataDir,
  desktopDir,
  dirname,
  documentDir,
  downloadDir,
  homeDir,
  join,
  normalize,
  tempDir,
} from '@tauri-apps/api/path'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxAccessKind = 'read' | 'write' | 'list' | 'search'

// ---------------------------------------------------------------------------
// Sensitive-path blocklist
// ---------------------------------------------------------------------------

const WINDOWS_SYSTEM_WRITE_DENY_ROOTS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
]

const SENSITIVE_HOME_SEGMENTS = [
  ['.ssh'],
  ['.aws'],
  ['.gnupg'],
  ['.codex'],
  ['.claude'],
  ['.anthropic'],
  ['.openai'],
  ['.gemini'],
  ['.cursor'],
  ['.config', 'gh'],
  ['.config', 'op'],
  ['AppData', 'Roaming', 'Code', 'User'],
  ['AppData', 'Local', 'Google', 'Chrome', 'User Data'],
  ['AppData', 'Local', 'Microsoft', 'Edge', 'User Data'],
] as const

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.?netrc$/i,
  /^auth\.json$/i,
  /^credentials\.json$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  // Unix sensitive files
  /^passwd$/i,
  /^shadow$/i,
  /^sudoers$/i,
] as const

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

export const BINARY_EXTENSIONS = new Set([
  '7z',
  'avi',
  'bin',
  'bmp',
  'class',
  'dll',
  'doc',
  'docx',
  'dylib',
  'eot',
  'exe',
  'gif',
  'gz',
  'ico',
  'jar',
  'jpeg',
  'jpg',
  'lockb',
  'mov',
  'mp3',
  'mp4',
  'o',
  'otf',
  'pdf',
  'png',
  'pyc',
  'so',
  'tar',
  'ttf',
  'wasm',
  'webm',
  'webp',
  'woff',
  'woff2',
  'zip',
])

export function hasBinaryExtension(path: string): boolean {
  const idx = path.lastIndexOf('.')
  if (idx === -1)
    return false
  return BINARY_EXTENSIONS.has(path.slice(idx + 1).toLowerCase())
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  if (sample.length === 0)
    return false

  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0)
      return true
    const isControl = byte < 7 || (byte > 13 && byte < 32)
    if (isControl)
      suspicious++
  }
  return suspicious / sample.length > 0.2
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function trimTrailingSeparators(path: string): string {
  if (/^[a-z]:[\\/]*$/i.test(path))
    return `${path[0]}:\\`
  if (/^[/\\]{2}[^/\\]+[/\\]+[^/\\]+[/\\]*$/.test(path))
    return path.replace(/[\\/]+$/g, '')

  const trimmed = path.replace(/[\\/]+$/g, '')
  return trimmed || path
}

function normalizeForCompare(path: string): string {
  const trimmed = trimTrailingSeparators(path)
  const unified = trimmed.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(unified) ? unified.toLowerCase() : unified
}

function isAbsoluteInputPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

function isWithinPath(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate)
  const normalizedParent = normalizeForCompare(parent)
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

function relativeSegments(basePath: string, absolutePath: string): string[] {
  const normalizedBase = normalizeForCompare(basePath)
  const normalizedAbsolute = normalizeForCompare(absolutePath)
  if (!isWithinPath(normalizedAbsolute, normalizedBase))
    return []

  const relative = normalizedAbsolute.slice(normalizedBase.length).replace(/^\/+/, '')
  return relative ? relative.split('/').filter(Boolean) : []
}

function pathBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

// ---------------------------------------------------------------------------
// Sandbox root resolution
// ---------------------------------------------------------------------------

const sandboxRootsCache = new Map<string, Promise<string[]>>()

async function loadTauriConfigRoots(projectPath: string): Promise<string[]> {
  try {
    const tauriDir = await join(projectPath, 'src-tauri')
    const tauriConfigPath = await join(tauriDir, 'tauri.conf.json')
    if (!await exists(tauriConfigPath))
      return []

    const raw = await readTextFile(tauriConfigPath)
    const config = JSON.parse(raw) as {
      build?: { frontendDist?: string }
      bundle?: { icon?: string[] }
    }

    const roots: string[] = []
    const addConfigPath = async (value: string | undefined, treatAsFile: boolean) => {
      if (!value || /^https?:\/\//i.test(value))
        return

      const absolute = isAbsoluteInputPath(value)
        ? await normalize(value)
        : await normalize(await join(tauriDir, value))

      roots.push(treatAsFile ? await dirname(absolute) : absolute)
    }

    await addConfigPath(config.build?.frontendDist, false)
    for (const iconPath of config.bundle?.icon ?? [])
      await addConfigPath(iconPath, true)

    return roots
  }
  catch {
    return []
  }
}

async function getSandboxRoots(projectPath: string): Promise<string[]> {
  const normalizedProject = await normalize(projectPath)
  const cacheKey = normalizeForCompare(normalizedProject)
  const cached = sandboxRootsCache.get(cacheKey)
  if (cached)
    return await cached

  const pending = (async () => {
    const roots = await Promise.all([
      Promise.resolve(normalizedProject),
      homeDir().catch(() => null),
      desktopDir().catch(() => null),
      documentDir().catch(() => null),
      downloadDir().catch(() => null),
      tempDir().catch(() => null),
      appConfigDir().catch(() => null),
      appDataDir().catch(() => null),
      appLocalDataDir().catch(() => null),
      appCacheDir().catch(() => null),
    ])

    const configRoots = await loadTauriConfigRoots(normalizedProject)
    return [...roots, ...configRoots]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => trimTrailingSeparators(value))
      .filter((value, index, all) =>
        all.findIndex(other => normalizeForCompare(other) === normalizeForCompare(value)) === index)
  })()

  sandboxRootsCache.set(cacheKey, pending)
  return await pending
}

// ---------------------------------------------------------------------------
// Sensitive-path detection
// ---------------------------------------------------------------------------

async function isSensitivePath(
  absolutePath: string,
  projectPath: string,
  kind: SandboxAccessKind,
): Promise<boolean> {
  if (isWithinPath(absolutePath, projectPath))
    return false

  if (kind === 'write' && WINDOWS_SYSTEM_WRITE_DENY_ROOTS.some(root => isWithinPath(absolutePath, root)))
    return true

  const home = await homeDir().catch(() => null)
  if (!home || !isWithinPath(absolutePath, home))
    return false

  const fileName = pathBasename(absolutePath).toLowerCase()
  if (SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(fileName)))
    return true

  const segments = relativeSegments(home, absolutePath).map(segment => segment.toLowerCase())
  return SENSITIVE_HOME_SEGMENTS.some(pattern =>
    pattern.every((segment, index) => segments[index] === segment.toLowerCase()))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a user-provided path (absolute or relative) to a normalized absolute path.
 */
export async function resolveToAbsolutePath(
  projectPath: string,
  inputPath: string,
): Promise<string> {
  const trimmed = inputPath.trim()
  if (!trimmed)
    throw new Error('Path cannot be empty')

  if (isAbsoluteInputPath(trimmed))
    return await normalize(trimmed)

  return await normalize(await join(projectPath, trimmed))
}

/**
 * Check whether an absolute path is within the allowed sandbox roots
 * and does not target a sensitive file.
 *
 * Returns `true` if the path is allowed, `false` if it should be blocked.
 */
export async function isPathAllowed(
  absolutePath: string,
  projectPath: string,
  kind: SandboxAccessKind = 'read',
): Promise<boolean> {
  const normalizedProject = await normalize(projectPath)
  const sandboxRoots = await getSandboxRoots(normalizedProject)

  if (!sandboxRoots.some(root => isWithinPath(absolutePath, root)))
    return false

  if (await isSensitivePath(absolutePath, normalizedProject, kind))
    return false

  return true
}

/**
 * Resolve + validate a path in one call. Throws on rejection.
 * This is the primary entry point for tools that need path security.
 */
export async function safePath(
  projectPath: string,
  inputPath: string,
  options: { kind?: SandboxAccessKind } = {},
): Promise<string> {
  const absolutePath = await resolveToAbsolutePath(projectPath, inputPath)
  const kind = options.kind ?? 'read'

  if (!await isPathAllowed(absolutePath, projectPath, kind)) {
    throw new Error(
      `Access denied: "${inputPath}" resolves outside the approved sandbox roots (workspace, user-space, temp, and Tauri config paths) or targets a sensitive file.`,
    )
  }

  return absolutePath
}
