type TauriHttpModule = typeof import('@tauri-apps/plugin-http')

// Evaluated once at module load — safe because the runtime never changes mid-session.
const _isTauri = typeof (globalThis as Record<string, unknown>).__TAURI__ !== 'undefined'
  || typeof (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'

export async function platformFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (_isTauri) {
    try {
      const mod: TauriHttpModule = await import('@tauri-apps/plugin-http')
      return await mod.fetch(input, init)
    }
    catch (err) {
      console.warn('[platformFetch] tauri fetch failed, falling back to global fetch:', err)
    }
  }
  return fetch(input, init)
}
