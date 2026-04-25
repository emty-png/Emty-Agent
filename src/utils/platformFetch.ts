/**
 * platformFetch.ts
 *
 * Wrapper around HTTP fetch that prefers the Tauri `@tauri-apps/plugin-http`
 * implementation when running inside a Tauri app, and falls back to the
 * standard `fetch` in a browser/dev environment.
 */

type TauriHttpModule = typeof import('@tauri-apps/plugin-http')

function isTauriRuntime(): boolean {
  const tauriGlobal = globalThis as typeof globalThis & {
    __TAURI__?: unknown
  }

  return typeof tauriGlobal.__TAURI__ !== 'undefined'
}

export async function platformFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (isTauriRuntime()) {
    try {
      const mod: TauriHttpModule = await import('@tauri-apps/plugin-http')
      return await mod.fetch(input, init)
    }
    catch (err) {
      console.warn(
        '[platformFetch] tauri fetch failed, falling back to global fetch:',
        err,
      )
    }
  }

  return fetch(input, init)
}
