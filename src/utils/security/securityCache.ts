/**
 * Shared cache for security overrides.
 * Extracted from securityConfigs to break circular import with settings store.
 * Settings store is the sole writer; security helpers are readers.
 */

let cachedOverrides: Record<string, string> | null = null

function tryHydrateFromStorage(): Record<string, string> | null {
  try {
    if (typeof localStorage === 'undefined')
      return null
    const raw = localStorage.getItem('settings')
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as { state?: { securityOverrides?: unknown } } & Record<string, unknown>
    // pinia-plugin-persistedstate stores under `settings` key with `state` wrapper or flat
    const overrides = (parsed as unknown as { state?: { securityOverrides?: Record<string, string> } })?.state?.securityOverrides
      ?? (parsed as unknown as { securityOverrides?: Record<string, string> })?.securityOverrides
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides))
      return overrides as Record<string, string>
  }
  catch {
    // ignore
  }
  return null
}

// Attempt sync hydration on module load so early callers (isShellCommandBlocked, safePath)
// see persisted overrides before Pinia hydrates.
try {
  const hydrated = tryHydrateFromStorage()
  if (hydrated)
    cachedOverrides = { ...hydrated }
}
catch {
  // ignore
}

export function getSecurityOverridesFromStore(): Record<string, string> {
  // Lazy re-hydrate if still empty (e.g., storage was not available at import time)
  if (cachedOverrides == null) {
    const hydrated = tryHydrateFromStorage()
    if (hydrated) {
      cachedOverrides = { ...hydrated }
      return cachedOverrides
    }
    return {}
  }
  return cachedOverrides
}

/** Used by the settings store to keep a synchronous cache for non-Vue callers. */
export function setSecurityOverridesCache(overrides: Record<string, string>): void {
  cachedOverrides = { ...overrides }
}
