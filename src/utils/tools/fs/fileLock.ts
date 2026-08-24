/**
 * File-specific wrapper around the generic production serializer.
 *
 * - Normalizes file paths (absolute-ish, slash, case on Windows) so
 *   `C:\proj\a.txt`, `c:/proj/a.txt` and `./a.txt` map to the same key.
 * - Defaults: reads `exclusive:false` (parallel allowed), writes `exclusive:true`
 *   (same-file writes serialize FIFO, different files stay parallel).
 * - Re-exports `ConcurrencyLimitError` and `Serializer` for advanced use.
 * - Global limit 30 — 31st concurrent tool call throws immediately.
 */

import { Serializer } from '@/utils/concurrency/serializer'

// Single shared serializer for all FS tools — global limit 30
const serializer = new Serializer({ globalLimit: 30 })

function normalizeFileKey(key: string): string {
  // Trim, unify slashes, strip trailing slash, lower-case on Windows
  let k = key.trim().replace(/\\/g, '/')
  // Collapse duplicate slashes (keep leading // for UNC? not needed for project paths)
  k = k.replace(/\/+/g, '/')
  // Remove trailing slash (except root `/`)
  if (k.length > 1 && k.endsWith('/'))
    k = k.slice(0, -1)
  // Windows case-insensitive (check navigator when available; Tauri desktop is Windows)
  if (typeof navigator !== 'undefined' && /Win/.test(navigator.platform))
    k = k.toLowerCase()
  return k
}

export class FileLockManager {
  // Serialize `fn` per normalized file key. `exclusive:true` queues same-file, `false` parallel.
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: { exclusive?: boolean; signal?: AbortSignal },
  ): Promise<T> {
    const nkey = normalizeFileKey(key)
    return serializer.run(nkey, fn, options)
  }

  /** Convenience: run with exclusive lock (for writes). */
  async withWriteLock<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.withLock(key, fn, {
      exclusive: true,
      ...(signal !== undefined ? { signal } : {}),
    })
  }

  /** Convenience: run with shared lock (for reads) — parallel. */
  async withReadLock<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.withLock(key, fn, {
      exclusive: false,
      ...(signal !== undefined ? { signal } : {}),
    })
  }

  // Introspection helpers (useful for tests)
  get running(): number {
    return serializer.running
  }

  get limit(): number {
    return serializer.limit
  }

  queuedFor(key: string): number {
    return serializer.queuedFor(normalizeFileKey(key))
  }
}

export { ConcurrencyLimitError, Serializer } from '@/utils/concurrency/serializer'
export const fileLockSerializer = serializer
