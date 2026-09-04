import type { HookCommand, HookConfig, HookEntry, HookEvent, HookInput, HookMatcher } from './types'
import { homeDir, join } from '@tauri-apps/api/path'
import { exists, readFile } from '@tauri-apps/plugin-fs'

const GLOBAL_CACHE_KEY = '__global__'

// ── Config cache (per workspace path) ─────────────────────────────────────────

const configCache = new Map<string, { config: HookConfig | null; loadedAt: number }>()
const CACHE_TTL_MS = 5_000

function invalidateCache(workspacePath: string): void {
  configCache.delete(workspacePath)
}

// ── Config loading ────────────────────────────────────────────────────────────

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!await exists(filePath))
      return null
    const bytes = await readFile(filePath)
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text) as Record<string, unknown>
  }
  catch {
    return null
  }
}

const KNOWN_EVENTS: HookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'TurnStart',
  'TurnEnd',
  'StopFailure',
  'PreToolUse',
  'PostToolUse',
  'PreFileWrite',
  'PostFileWrite',
  'PreFileEdit',
  'PostFileEdit',
  'PreFileRead',
  'PostFileRead',
  'PreShellExec',
  'PostShellExec',
  'PreMcpUse',
  'PostMcpUse',
  'BeforePromptBuild',
  'AfterPromptBuild',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentEnd',
  'PermissionRequest',
]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseMatcher(raw: unknown): HookMatcher | undefined {
  if (!isRecord(raw))
    return undefined
  const m: HookMatcher = {}
  if (typeof raw.toolName === 'string')
    m.toolName = raw.toolName
  if (typeof raw.filePath === 'string')
    m.filePath = raw.filePath
  if (typeof raw.command === 'string')
    m.command = raw.command
  if (typeof raw.projectName === 'string')
    m.projectName = raw.projectName
  if (typeof raw.mode === 'string')
    m.mode = raw.mode
  if (typeof raw.prompt === 'string')
    m.prompt = raw.prompt
  if (isRecord(raw.input)) {
    const input: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.input)) {
      if (typeof v === 'string')
        input[k] = v
    }
    if (Object.keys(input).length > 0)
      m.input = input
  }
  return Object.keys(m).length > 0 ? m : undefined
}

function parseHookCommands(raw: unknown): HookCommand[] {
  if (!Array.isArray(raw))
    return []
  const out: HookCommand[] = []
  for (const h of raw) {
    if (!isRecord(h) || typeof h.command !== 'string')
      continue
    const cmd: HookCommand = { command: h.command }
    if (typeof h.timeoutSec === 'number')
      cmd.timeoutSec = h.timeoutSec
    if (typeof h.cwd === 'string')
      cmd.cwd = h.cwd
    if (isRecord(h.env)) {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(h.env)) {
        if (typeof v === 'string')
          env[k] = v
      }
      if (Object.keys(env).length > 0)
        cmd.env = env
    }
    if (h.type === 'shell' || h.type === 'node' || h.type === 'js')
      cmd.type = h.type
    if (typeof h.file === 'string')
      cmd.file = h.file
    if (typeof h.enabled === 'boolean')
      cmd.enabled = h.enabled
    out.push(cmd)
  }
  return out
}

function parseHookEntry(raw: unknown): HookEntry | null {
  if (!isRecord(raw))
    return null
  const hooks = parseHookCommands(raw.hooks)
  if (hooks.length === 0)
    return null
  const entry: HookEntry = { hooks }
  if (typeof raw.matcher === 'string')
    entry.matcher = raw.matcher
  const m = parseMatcher(raw.match)
  if (m)
    entry.match = m
  if (typeof raw.name === 'string')
    entry.name = raw.name
  if (typeof raw.description === 'string')
    entry.description = raw.description
  if (typeof raw.enabled === 'boolean')
    entry.enabled = raw.enabled
  if (typeof raw.priority === 'number')
    entry.priority = raw.priority
  if (raw.runMode === 'sequential' || raw.runMode === 'parallel' || raw.runMode === 'race')
    entry.runMode = raw.runMode
  return entry
}

export function parseHookConfig(raw: Record<string, unknown>): HookConfig | null {
  const hooksRaw = raw.hooks
  if (!hooksRaw || typeof hooksRaw !== 'object')
    return null

  const config: HookConfig = { hooks: {} }
  if (typeof raw.version === 'number')
    config.version = raw.version
  if (Array.isArray(raw.extends)) {
    const ext = raw.extends.filter((e): e is string => typeof e === 'string')
    if (ext.length > 0)
      config.extends = ext
  }
  if (isRecord(raw.customEvents)) {
    const ce: Record<string, { description?: string; blockable?: boolean }> = {}
    for (const [k, v] of Object.entries(raw.customEvents)) {
      if (!isRecord(v))
        continue
      const def: { description?: string; blockable?: boolean } = {}
      if (typeof v.description === 'string')
        def.description = v.description
      if (typeof v.blockable === 'boolean')
        def.blockable = v.blockable
      ce[k] = def
    }
    if (Object.keys(ce).length > 0)
      config.customEvents = ce
  }
  if (isRecord(raw.eventTimeoutMs)) {
    const etm: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.eventTimeoutMs)) {
      if (typeof v === 'number')
        etm[k] = v
    }
    if (Object.keys(etm).length > 0)
      config.eventTimeoutMs = etm as unknown as NonNullable<HookConfig['eventTimeoutMs']>
  }

  const allEvents = new Set<string>(KNOWN_EVENTS)
  if (config.customEvents) {
    for (const k of Object.keys(config.customEvents))
      allEvents.add(k)
  }
  // Also include any event key present in raw hooks (for custom without registry — allow passthrough)
  for (const k of Object.keys(hooksRaw as Record<string, unknown>)) {
    allEvents.add(k)
  }

  for (const event of allEvents) {
    const entries = (hooksRaw as Record<string, unknown>)[event]
    if (!Array.isArray(entries))
      continue
    const parsed: HookEntry[] = []
    for (const e of entries) {
      const pe = parseHookEntry(e)
      if (pe)
        parsed.push(pe)
    }
    if (parsed.length > 0)
      config.hooks[event as HookEvent] = parsed
  }

  return config
}

function mergeHookConfigs(base: HookConfig, overlay: HookConfig): HookConfig {
  const merged: HookConfig = {
    hooks: { ...base.hooks },
    ...(base.version !== undefined ? { version: base.version } : {}),
    ...(overlay.version !== undefined ? { version: overlay.version } : {}),
  }
  if (base.customEvents || overlay.customEvents) {
    merged.customEvents = { ...(base.customEvents ?? {}), ...(overlay.customEvents ?? {}) }
  }
  if (base.eventTimeoutMs || overlay.eventTimeoutMs) {
    merged.eventTimeoutMs = { ...(base.eventTimeoutMs ?? {}), ...(overlay.eventTimeoutMs ?? {}) } as unknown as NonNullable<HookConfig['eventTimeoutMs']>
  }
  if (overlay.extends)
    merged.extends = overlay.extends
  else if (base.extends)
    merged.extends = base.extends

  for (const [evt, entries] of Object.entries(overlay.hooks)) {
    const existing = merged.hooks[evt as HookEvent]
    if (existing) {
      merged.hooks[evt as HookEvent] = [...existing, ...entries!]
    }
    else {
      merged.hooks[evt as HookEvent] = entries!
    }
  }
  return merged
}

async function loadExtendedConfigs(baseDir: string, extendsList: string[]): Promise<HookConfig | null> {
  let acc: HookConfig | null = null
  for (const ext of extendsList) {
    let extPath: string
    if (ext.startsWith('/') || ext.startsWith('\\') || /^[a-z]:[\\/]/i.test(ext)) {
      extPath = ext
    }
    else {
      extPath = await join(baseDir, ext)
    }
    const raw = await readJsonFile(extPath)
    if (!raw)
      continue
    const cfg = parseHookConfig(raw)
    if (!cfg)
      continue
    // Recursively resolve nested extends
    let resolved = cfg
    if (cfg.extends && cfg.extends.length > 0) {
      const baseOfExt = extPath.includes('/') || extPath.includes('\\')
        ? extPath.slice(0, Math.max(extPath.lastIndexOf('/'), extPath.lastIndexOf('\\')))
        : baseDir
      const nested = await loadExtendedConfigs(baseOfExt, cfg.extends)
      if (nested)
        resolved = mergeHookConfigs(nested, cfg)
    }
    acc = acc ? mergeHookConfigs(acc, resolved) : resolved
  }
  return acc
}

async function loadHooksFromFolder(workspacePath: string): Promise<HookConfig | null> {
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const hooksDir = await join(workspacePath, '.emty', 'hooks')
    if (!await exists(hooksDir))
      return null
    const entries = await readDir(hooksDir)
    let acc: HookConfig | null = null
    for (const ent of entries) {
      const name = (ent as unknown as { name: string }).name ?? ''
      if (!name.endsWith('.json'))
        continue
      if (name === 'hooks.json')
        continue
      const full = await join(hooksDir, name)
      const raw = await readJsonFile(full)
      if (!raw)
        continue
      const cfg = parseHookConfig(raw)
      if (!cfg)
        continue
      acc = acc ? mergeHookConfigs(acc, cfg) : cfg
    }
    return acc
  }
  catch {
    return null
  }
}

/**
 * Load the hooks configuration for a given workspace path.
 * Checks `<workspacePath>/.emty/hooks.json` (project-level, opt-in).
 * Also loads `<workspace>/.emty/hooks/*.json` folder and `extends` cascade.
 * Returns null if no config file exists or config is invalid.
 */
export async function loadHooksConfig(workspacePath: string | null): Promise<HookConfig | null> {
  if (!workspacePath)
    return null

  const cached = configCache.get(workspacePath)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS)
    return cached.config

  const hooksPath = await join(workspacePath, '.emty', 'hooks.json')
  const raw = await readJsonFile(hooksPath)
  let config: HookConfig | null = null
  if (raw) {
    config = parseHookConfig(raw)
    if (config && config.extends && config.extends.length > 0) {
      const baseDir = await join(workspacePath, '.emty')
      const extCfg = await loadExtendedConfigs(baseDir, config.extends)
      if (extCfg)
        config = mergeHookConfigs(extCfg, config)
    }
  }

  const folderCfg = await loadHooksFromFolder(workspacePath)
  if (folderCfg) {
    if (config)
      config = mergeHookConfigs(config, folderCfg)
    else
      config = folderCfg
  }

  if (!raw && !folderCfg) {
    configCache.set(workspacePath, { config: null, loadedAt: Date.now() })
    return null
  }

  if (!config) {
    configCache.set(workspacePath, { config: null, loadedAt: Date.now() })
    return null
  }

  configCache.set(workspacePath, { config, loadedAt: Date.now() })
  return config
}

/**
 * Check if a hooks config file exists for the given workspace path.
 */
export async function hooksConfigExists(workspacePath: string | null): Promise<boolean> {
  if (!workspacePath)
    return false
  try {
    const hooksPath = await join(workspacePath, '.emty', 'hooks.json')
    if (await exists(hooksPath))
      return true
  }
  catch { /* scope denial or missing file -> treat as absent */ }
  // Also check folder
  try {
    const hooksDir = await join(workspacePath, '.emty', 'hooks')
    if (await exists(hooksDir)) {
      const { readDir } = await import('@tauri-apps/plugin-fs')
      const entries = await readDir(hooksDir)
      return entries.some((e: unknown) => {
        const name = (e as { name: string }).name ?? ''
        return name.endsWith('.json')
      })
    }
  }
  catch { /* ignore */ }
  return false
}

/**
 * Create a default `.emty/hooks.json` in the given workspace.
 */
export async function createDefaultHooksConfig(workspacePath: string): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const dirPath = await join(workspacePath, '.emty')
  await mkdir(dirPath, { recursive: true }).catch(() => {})
  const filePath = await join(workspacePath, '.emty', 'hooks.json')
  const defaultConfig: HookConfig = { version: 2, hooks: {} }
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(filePath, new TextEncoder().encode(JSON.stringify(defaultConfig, null, 2)))
  invalidateCache(workspacePath)
}

/**
 * Get the path to the hooks config file.
 */
export async function getHooksConfigPath(workspacePath: string): Promise<string> {
  return join(workspacePath, '.emty', 'hooks.json')
}

// ── Global config ( ~/.emty/hooks/global_hooks.json ) ─────────────────────

export async function getGlobalHooksConfigPath(): Promise<string> {
  const home = await homeDir()
  return join(home, '.emty', 'hooks', 'global_hooks.json')
}

export async function globalHooksConfigExists(): Promise<boolean> {
  try {
    const p = await getGlobalHooksConfigPath()
    if (await exists(p))
      return true
  }
  catch { /* scope denial -> treat as absent */ }
  // check global folder glob
  try {
    const home = await homeDir()
    const dir = await join(home, '.emty', 'hooks')
    if (await exists(dir)) {
      const { readDir } = await import('@tauri-apps/plugin-fs')
      const entries = await readDir(dir)
      return entries.some((e: unknown) => {
        const name = (e as { name: string }).name ?? ''
        return name.endsWith('.json') && name !== 'global_hooks.json'
      })
    }
  }
  catch { /* ignore */ }
  return false
}

export async function loadGlobalHooksConfig(): Promise<HookConfig | null> {
  const cached = configCache.get(GLOBAL_CACHE_KEY)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS)
    return cached.config

  const hooksPath = await getGlobalHooksConfigPath()
  const raw = await readJsonFile(hooksPath)
  let config: HookConfig | null = null
  if (raw) {
    config = parseHookConfig(raw)
    if (config && config.extends && config.extends.length > 0) {
      const home = await homeDir()
      const baseDir = await join(home, '.emty', 'hooks')
      const extCfg = await loadExtendedConfigs(baseDir, config.extends)
      if (extCfg)
        config = mergeHookConfigs(extCfg, config)
    }
  }

  // Load additional global folder jsons
  try {
    const home = await homeDir()
    const dir = await join(home, '.emty', 'hooks')
    if (await exists(dir)) {
      const { readDir } = await import('@tauri-apps/plugin-fs')
      const entries = await readDir(dir)
      for (const ent of entries) {
        const name = (ent as { name: string }).name ?? ''
        if (name === 'global_hooks.json' || !name.endsWith('.json'))
          continue
        const full = await join(dir, name)
        const r = await readJsonFile(full)
        if (!r)
          continue
        const c = parseHookConfig(r)
        if (!c)
          continue
        config = config ? mergeHookConfigs(config, c) : c
      }
    }
  }
  catch { /* ignore */ }

  if (!raw && !config) {
    configCache.set(GLOBAL_CACHE_KEY, { config: null, loadedAt: Date.now() })
    return null
  }
  if (!config) {
    configCache.set(GLOBAL_CACHE_KEY, { config: null, loadedAt: Date.now() })
    return null
  }

  configCache.set(GLOBAL_CACHE_KEY, { config, loadedAt: Date.now() })
  return config
}

export async function createDefaultGlobalHooksConfig(): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const dirPath = await join(await homeDir(), '.emty', 'hooks')
  await mkdir(dirPath, { recursive: true }).catch(() => {})
  const filePath = await getGlobalHooksConfigPath()
  const defaultConfig: HookConfig = { version: 2, hooks: {} }
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(filePath, new TextEncoder().encode(JSON.stringify(defaultConfig, null, 2)))
  configCache.delete(GLOBAL_CACHE_KEY)
}

export function invalidateGlobalCache(): void {
  configCache.delete(GLOBAL_CACHE_KEY)
}

// ── Matcher resolution ────────────────────────────────────────────────────────

function isRegexPattern(pattern: string): { regex: RegExp } | null {
  if (pattern.length >= 2 && pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/')
    const body = pattern.slice(1, lastSlash)
    const flags = pattern.slice(lastSlash + 1)
    if (body.length === 0)
      return null
    // Only allow valid flags i,g,m,s,u,y
    if (flags && !/^[gimsuy]+$/.test(flags))
      return null
    try {
      const re = new RegExp(body, flags)
      return { regex: re }
    }
    catch { return null }
  }
  return null
}

function globToRegExp(pattern: string): RegExp {
  // Escape regex chars except * ? [ { ! already handled
  let reStr = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** handling
        if (pattern[i + 2] === '/') {
          // **/ → (?:.*\/)?
          reStr += '(?:.*\\/)?'
          i += 3
          continue
        }
        reStr += '.*'
        i += 2
        continue
      }
      reStr += '[^/\\\\]*'
      i += 1
      continue
    }
    if (c === '?') {
      reStr += '[^/\\\\]'
      i += 1
      continue
    }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close !== -1) {
        // Preserve bracket expression as-is (basic support)
        reStr += pattern.slice(i, close + 1)
        i = close + 1
        continue
      }
    }
    if (c === '{') {
      const close = pattern.indexOf('}', i + 1)
      if (close !== -1) {
        const inside = pattern.slice(i + 1, close)
        // {a,b,c} → (a|b|c)
        const parts = inside.split(',').map(p => p.trim()).filter(Boolean)
        if (parts.length > 0) {
          reStr += `(?:${parts.map(p => globToRegExp(p).source.slice(1, -1)).join('|')})`
          i = close + 1
          continue
        }
      }
    }
    if ('.+^${}()|\\'.includes(c)) {
      reStr += `\\${c}`
    }
    else {
      reStr += c
    }
    i += 1
  }
  return new RegExp(`^${reStr}$`)
}

function testPattern(target: string, pattern: string): boolean {
  // Check negation prefix !
  let negate = false
  let pat = pattern
  if (pat.startsWith('!')) {
    negate = true
    pat = pat.slice(1)
  }
  const regexInfo = isRegexPattern(pat)
  if (regexInfo) {
    const matched = regexInfo.regex.test(target)
    return negate ? !matched : matched
  }
  // Glob
  if (pat.includes('*') || pat.includes('?') || pat.includes('[') || pat.includes('{')) {
    const re = globToRegExp(pat)
    const matched = re.test(target)
    // Also test basename for file paths (so *.ts matches C:\a\b.ts)
    if (!matched && (target.includes('/') || target.includes('\\'))) {
      const base = target.split(/[/\\]/).pop() ?? target
      if (re.test(base))
        return !negate
    }
    return negate ? !matched : matched
  }
  const eq = target === pat
  return negate ? !eq : eq
}

function getStringFieldForMatcherKey(input: HookInput | null, key: string): string {
  if (!input)
    return ''
  switch (key) {
    case 'toolName':
      return 'toolName' in input ? (input as unknown as { toolName: string }).toolName : ''
    case 'filePath':
      return 'filePath' in input ? (input as unknown as { filePath: string }).filePath : ''
    case 'command':
      return 'command' in input ? String((input as unknown as { command: string }).command ?? '') : ''
    case 'projectName':
      return input.projectName ?? ''
    case 'mode':
      return 'mode' in input ? String((input as unknown as { mode: string }).mode ?? '') : ''
    case 'prompt':
      return 'prompt' in input ? String((input as unknown as { prompt: string }).prompt ?? '') : ''
    default:
      return ''
  }
}

export function matchesStructuredMatcher(match: HookMatcher, input: HookInput | null, target: string): boolean {
  // All specified keys must match (AND)
  if (match.toolName !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'toolName') || target
    if (!testPattern(v, match.toolName))
      return false
  }
  if (match.filePath !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'filePath') || target
    // Test both full and relative; if pattern has ** treat as path glob, already handled
    if (!testPattern(v, match.filePath))
      return false
  }
  if (match.command !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'command') || target
    if (!testPattern(v, match.command))
      return false
  }
  if (match.projectName !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'projectName')
    if (!testPattern(v, match.projectName))
      return false
  }
  if (match.mode !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'mode')
    if (!testPattern(v, match.mode))
      return false
  }
  if (match.prompt !== undefined) {
    const v = getStringFieldForMatcherKey(input, 'prompt')
    if (!testPattern(v, match.prompt))
      return false
  }
  if (match.input) {
    const toolInput = input && 'toolInput' in input ? (input as unknown as { toolInput: Record<string, unknown> }).toolInput : null
    for (const [k, pat] of Object.entries(match.input)) {
      const rawVal = toolInput ? toolInput[k] : undefined
      const strVal = rawVal === undefined || rawVal === null ? '' : String(rawVal)
      if (!testPattern(strVal, pat))
        return false
    }
  }
  return true
}

/**
 * Check if a hook entry matches the given target (tool name or file path).
 * Supports legacy pipe-separated matcher plus structured `match` object.
 */
export function matchesHookEntry(entry: HookEntry, target: string, input?: HookInput | null): boolean {
  if (entry.enabled === false)
    return false
  // Structured matcher takes AND precedence
  if (entry.match) {
    if (!matchesStructuredMatcher(entry.match, input ?? null, target))
      return false
  }
  if (!entry.matcher || entry.matcher === '')
    return true
  // Handle legacy pipe OR with negation support
  const patterns = entry.matcher.split('|').map(p => p.trim()).filter(Boolean)
  if (patterns.length === 0)
    return true
  // If any pattern starts with ! and all are negations, require all to pass
  const hasPositive = patterns.some(p => !p.startsWith('!'))
  if (!hasPositive) {
    // All negations: must pass all
    return patterns.every(p => testPattern(target, p))
  }
  return patterns.some(p => testPattern(target, p))
}

/** Expose for UI tester */
export function testGlobPattern(target: string, pattern: string): boolean {
  return testPattern(target, pattern)
}

export { invalidateCache }
