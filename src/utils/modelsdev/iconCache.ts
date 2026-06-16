// ── Provider icon cache ──────────────────────────────────────────────────────
// Downloads icons from models.dev CDN, caches as data URIs in localStorage.
// Survives page reloads, works offline after first load.

const CACHE_PREFIX = 'mdev-icon:'
const inMemory = new Map<string, string>()

/** Get icon URL for a provider. Returns cached data URI or CDN URL (triggers background download). */
export function getProviderIconUrl(id: string): string {
  const mem = inMemory.get(id)
  if (mem)
    return mem

  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(CACHE_PREFIX + id)
    if (stored) {
      inMemory.set(id, stored)
      return stored
    }
  }

  const cdnUrl = `https://models.dev/logos/${id}.svg`
  fetchAndCache(id, cdnUrl)
  return cdnUrl
}

/** Pre-download and cache all provider icons. Call once on app start. */
export function warmIconCache(ids: string[]): void {
  for (const id of ids) {
    if (inMemory.has(id))
      continue
    if (typeof localStorage !== 'undefined' && localStorage.getItem(CACHE_PREFIX + id))
      continue
    fetchAndCache(id, `https://models.dev/logos/${id}.svg`)
  }
}

async function fetchAndCache(id: string, url: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok)
      return
    const blob = await res.blob()
    const dataUri = await blobToDataUri(blob)
    inMemory.set(id, dataUri)
    try {
      localStorage.setItem(CACHE_PREFIX + id, dataUri)
    }
    catch {
      // localStorage full — silently skip
    }
  }
  catch {
    // network error — silently skip
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
