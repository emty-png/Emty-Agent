import type { HookConfig, HookEntry, HookEvent } from './types'
import { join } from '@tauri-apps/api/path'
import { exists, readFile } from '@tauri-apps/plugin-fs'

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

function parseHookConfig(raw: Record<string, unknown>): HookConfig | null {
  const hooks = raw.hooks
  if (!hooks || typeof hooks !== 'object')
    return null

  const config: HookConfig = { hooks: {} }
  const validEvents: HookEvent[] = [
    'SessionStart',
    'SessionEnd',
    'TurnStart',
    'TurnEnd',
    'StopFailure',
    'PreToolUse',
    'PostToolUse',
    'PreFileWrite',
    'PostFileWrite',
    'PreShellExec',
    'PostShellExec',
  ]

  for (const event of validEvents) {
    const entries = (hooks as Record<string, unknown>)[event]
    if (!Array.isArray(entries))
      continue

    const parsed: HookEntry[] = []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object')
        continue
      const obj = entry as Record<string, unknown>
      const hookCmds = obj.hooks
      if (!Array.isArray(hookCmds))
        continue

      const hooks = hookCmds
        .filter((h): h is { command: string; timeoutSec?: number } =>
          h != null && typeof h === 'object' && typeof (h as Record<string, unknown>).command === 'string')
        .map(h => ({
          command: (h as Record<string, unknown>).command as string,
          timeoutSec: typeof (h as Record<string, unknown>).timeoutSec === 'number'
            ? (h as Record<string, unknown>).timeoutSec as number
            : 5,
        }))

      if (hooks.length === 0)
        continue

      parsed.push({
        ...(typeof obj.matcher === 'string' ? { matcher: obj.matcher } : {}),
        hooks,
      })
    }

    if (parsed.length > 0)
      config.hooks[event] = parsed
  }

  return config
}

/**
 * Load the hooks configuration for a given workspace path.
 * Checks `<workspacePath>/.emty/hooks.json` (project-level, opt-in).
 * Returns null if no config file exists or config is invalid.
 */
export async function loadHooksConfig(workspacePath: string | null): Promise<HookConfig | null> {
  if (!workspacePath)
    return null

  const cached = configCache.get(workspacePath)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    console.warn('[hooks] Config cache hit — returning cached config')
    return cached.config
  }

  console.warn(`[hooks] Loading config from ${workspacePath}/.emty/hooks.json`)
  const hooksPath = await join(workspacePath, '.emty', 'hooks.json')
  const raw = await readJsonFile(hooksPath)
  if (!raw) {
    console.warn('[hooks] No hooks.json found or parse failed')
    configCache.set(workspacePath, { config: null, loadedAt: Date.now() })
    return null
  }

  const config = parseHookConfig(raw)
  if (config) {
    const eventSummary = Object.entries(config.hooks)
      .filter(([, entries]) => entries && entries.length > 0)
      .map(([event, entries]) => `${event}(${entries!.reduce((sum, e) => sum + e.hooks.length, 0)})`)
      .join(', ')
    console.warn(`[hooks] Config parsed — events: ${eventSummary || '(none)'}`)
  }
  else {
    console.warn('[hooks] Config parsed but returned null (invalid structure)')
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
  const hooksPath = await join(workspacePath, '.emty', 'hooks.json')
  return exists(hooksPath)
}

/**
 * Create a default `.emty/hooks.json` in the given workspace.
 */
export async function createDefaultHooksConfig(workspacePath: string): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const dirPath = await join(workspacePath, '.emty')
  await mkdir(dirPath, { recursive: true }).catch(() => {})
  const filePath = await join(workspacePath, '.emty', 'hooks.json')
  const defaultConfig: HookConfig = { hooks: {} }
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

// ── Matcher resolution ────────────────────────────────────────────────────────

/**
 * Check if a hook entry matches the given target (tool name or file path).
 */
export function matchesHookEntry(entry: HookEntry, target: string): boolean {
  if (!entry.matcher || entry.matcher === '')
    return true

  // Pipe-separated: "run_command|git_command"
  const patterns = entry.matcher.split('|').map(p => p.trim()).filter(Boolean)
  return patterns.some(pattern =>
    pattern.includes('*') || pattern.includes('?')
      ? minimatch(target, pattern)
      : target === pattern,
  )
}

/** Simple glob matcher (supports * and ? only). */
function minimatch(str: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
  )
  return regex.test(str)
}

export { invalidateCache }
