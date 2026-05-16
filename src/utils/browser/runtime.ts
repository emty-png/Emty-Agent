import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useBrowserStore } from '@/stores/browser'

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserBridgeRequest {
  id: string
  action: 'snapshot' | 'extract' | 'click' | 'type' | 'press' | 'scroll' | 'wait' | 'history' | 'execute' | 'cookies' | 'screenshot'
  args?: Record<string, unknown>
}

export interface BrowserCookie {
  name: string
  value: string
  domain?: string | undefined
  path?: string | undefined
  expires?: number | undefined
  httpOnly?: boolean | undefined
  secure?: boolean | undefined
  sameSite?: 'Strict' | 'Lax' | 'None' | undefined
}

export interface BrowserStateEventPayload {
  sessionId: string
  kind: 'mounted' | 'shown' | 'navigation-requested' | 'page-load-started' | 'page-load-finished' | 'title-changed' | 'bridge-ready'
  url?: string
  title?: string
  readyState?: string
}

interface BrowserBridgeEventPayload {
  sessionId: string
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

interface BrowserNewTabEventPayload {
  sessionId: string
  url: string
}

const BROWSER_STATE_EVENT = 'browser://state'
const BROWSER_BRIDGE_EVENT = 'browser://bridge'
const BROWSER_NEW_TAB_EVENT = 'browser://new-tab'

let listenersPromise: Promise<void> | null = null
let activeSurfaceSessionId: string | null = null
let readySurfaceSessionId: string | null = null
let lastBoundsKey = ''
const readySurfaceSessions = new Set<string>()

const readyWaiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>>()
const bridgeWaiters = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function boundsKey(bounds: BrowserBounds): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height].map(value => Math.round(value)).join(':')
}

export function currentSurfaceSessionId() {
  return activeSurfaceSessionId
}

export function isSurfaceReady(sessionId: string) {
  return readySurfaceSessionId === sessionId || readySurfaceSessions.has(sessionId)
}

async function ensureListeners(): Promise<void> {
  if (listenersPromise)
    return listenersPromise

  listenersPromise = Promise.all([
    listen<BrowserStateEventPayload>(BROWSER_STATE_EVENT, ({ payload }) => {
      const browser = useBrowserStore()

      switch (payload.kind) {
        case 'mounted':
          activeSurfaceSessionId = payload.sessionId
          readySurfaceSessionId = null
          browser.markPageMounted(payload.sessionId)
          break
        case 'shown':
          activeSurfaceSessionId = payload.sessionId
          if (payload.url)
            browser.syncPageFromBridge(payload.sessionId, { url: payload.url, title: payload.title })
          if (readySurfaceSessions.has(payload.sessionId))
            readySurfaceSessionId = payload.sessionId
          break
        case 'navigation-requested':
        case 'page-load-started':
          if (payload.sessionId === activeSurfaceSessionId)
            readySurfaceSessionId = null
          readySurfaceSessions.delete(payload.sessionId)
          if (payload.url)
            browser.markPageLoading(payload.sessionId, payload.url)
          break
        case 'page-load-finished':
          if (payload.url)
            browser.markPageReady(payload.sessionId, payload.url)
          break
        case 'title-changed':
          if (payload.title)
            browser.setPageTitle(payload.sessionId, payload.title)
          break
        case 'bridge-ready': {
          if (payload.url)
            browser.syncPageFromBridge(payload.sessionId, { url: payload.url, title: payload.title })
          readySurfaceSessionId = payload.sessionId
          readySurfaceSessions.add(payload.sessionId)
          const waiters = readyWaiters.get(payload.sessionId) ?? []
          for (const waiter of waiters) {
            clearTimeout(waiter.timer)
            waiter.resolve()
          }
          readyWaiters.delete(payload.sessionId)
          break
        }
      }
    }),
    listen<BrowserBridgeEventPayload>(BROWSER_BRIDGE_EVENT, ({ payload }) => {
      const browser = useBrowserStore()
      const waiter = bridgeWaiters.get(payload.requestId)
      if (!waiter)
        return

      clearTimeout(waiter.timer)
      bridgeWaiters.delete(payload.requestId)

      if (payload.ok) {
        const result = typeof payload.result === 'object' && payload.result !== null
          ? payload.result as Record<string, unknown>
          : null

        browser.syncPageFromBridge(payload.sessionId, {
          url: typeof result?.url === 'string' ? result.url : undefined,
          title: typeof result?.title === 'string' ? result.title : undefined,
        })
        waiter.resolve(payload.result)
      }
      else {
        browser.setPageError(payload.sessionId, payload.error ?? 'Browser request failed')
        waiter.reject(new Error(payload.error ?? 'Browser request failed'))
      }
    }),
    listen<BrowserNewTabEventPayload>(BROWSER_NEW_TAB_EVENT, ({ payload }) => {
      const browser = useBrowserStore()
      const match = browser.findPageBySession(payload.sessionId)
      if (!match)
        return
      browser.prepareNavigation(match.ownerId, payload.url, { newPage: true, historyMode: 'replace' })
    }),
  ]).then(() => undefined)

  return listenersPromise
}

export async function waitForSurface(sessionId: string, timeoutMs = 60_000): Promise<void> {
  await ensureListeners()

  if (readySurfaceSessionId === sessionId || readySurfaceSessions.has(sessionId))
    return

  const started = Date.now()
  let attempt = 0

  await new Promise<void>((resolve, reject) => {
    function schedule() {
      const elapsed = Date.now() - started
      const remaining = timeoutMs - elapsed
      if (remaining <= 0) {
        const list = readyWaiters.get(sessionId)
        if (list) {
          const idx = list.findIndex(w => w.resolve === resolve)
          if (idx !== -1)
            list.splice(idx, 1)
          if (list.length === 0)
            readyWaiters.delete(sessionId)
        }
        reject(new Error(`Timed out waiting for browser surface ${sessionId}`))
        return
      }

      // Exponential backoff: 500ms, 1s, 2s, 4s, 8s … capped at remaining time
      const delay = Math.min(500 * 2 ** attempt, remaining)
      attempt++

      const timer = setTimeout(() => {
        // If bridge-ready already came in while we were waiting, resolve
        if (readySurfaceSessionId === sessionId || readySurfaceSessions.has(sessionId)) {
          resolve()
          return
        }
        // Swap in a fresh waiter for the next interval
        const list = readyWaiters.get(sessionId)
        if (list) {
          const idx = list.findIndex(w => w.timer === timer)
          if (idx !== -1)
            list.splice(idx, 1)
        }
        schedule()
      }, delay)

      const waiter = { resolve, reject, timer }
      const existing = readyWaiters.get(sessionId)
      if (existing)
        existing.push(waiter)
      else
        readyWaiters.set(sessionId, [waiter])
    }

    schedule()
  })
}

export async function syncSurface(options: {
  visible: boolean
  sessionId?: string | null
  url?: string | null
  bounds?: BrowserBounds | null
}): Promise<void> {
  await ensureListeners()

  if (!options.visible || !options.sessionId || !options.url || !options.bounds) {
    if (activeSurfaceSessionId) {
      // Hide native child webviews instead of destroying them so tab state,
      // scroll position, form input, and JS app state survive UI overlays.
      try {
        await invoke('browser_unmount_surface')
      }
      catch { /* ignore hide errors - surfaces may already be gone */ }
      activeSurfaceSessionId = null
      lastBoundsKey = ''
    }
    return
  }

  const nextBoundsKey = boundsKey(options.bounds)
  if (activeSurfaceSessionId !== options.sessionId) {
    readySurfaceSessionId = null
    // Set optimistically BEFORE the await so concurrent calls don't both
    // pass this check and trigger a duplicate browser_mount_surface.
    activeSurfaceSessionId = options.sessionId
    lastBoundsKey = nextBoundsKey
    try {
      await invoke('browser_mount_surface', {
        sessionId: options.sessionId,
        url: options.url,
        bounds: options.bounds,
      })
      if (readySurfaceSessions.has(options.sessionId))
        readySurfaceSessionId = options.sessionId
    }
    catch (err) {
      activeSurfaceSessionId = null
      lastBoundsKey = ''
      throw new Error(err instanceof Error ? err.message : String(err))
    }
    return
  }

  if (lastBoundsKey !== nextBoundsKey) {
    await invoke('browser_resize_surface', {
      sessionId: options.sessionId,
      bounds: options.bounds,
    })
    lastBoundsKey = nextBoundsKey
  }
}

export async function navigateSurface(sessionId: string, url: string): Promise<void> {
  await ensureListeners()
  readySurfaceSessionId = null
  readySurfaceSessions.delete(sessionId)
  await invoke('browser_surface_navigate', { sessionId, url })
}

export async function reloadSurface(sessionId: string): Promise<void> {
  await ensureListeners()
  readySurfaceSessionId = null
  readySurfaceSessions.delete(sessionId)
  await invoke('browser_surface_reload', { sessionId })
}

export async function closeSurface(sessionId: string): Promise<void> {
  await ensureListeners()
  if (!sessionId)
    return

  readySurfaceSessions.delete(sessionId)
  if (activeSurfaceSessionId === sessionId)
    activeSurfaceSessionId = null
  if (readySurfaceSessionId === sessionId)
    readySurfaceSessionId = null

  await invoke('browser_close_surface', { sessionId })
}

/**
 * Use the browser's native back/forward stack.
 * This covers in-page navigations (link clicks, form submits) that the
 * Pinia store doesn't track — unlike goToHistoryIndex which only knows
 * about URLs the agent explicitly opened.
 */
export async function goBackSurface(sessionId: string): Promise<void> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  await dispatchBridgeRequest(sessionId, 'history', { direction: 'back' }, 5000)
  readySurfaceSessionId = null
  readySurfaceSessions.delete(sessionId)
}

export async function goForwardSurface(sessionId: string): Promise<void> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  await dispatchBridgeRequest(sessionId, 'history', { direction: 'forward' }, 5000)
  readySurfaceSessionId = null
  readySurfaceSessions.delete(sessionId)
}

/**
 * Capture a screenshot of the current surface.
 * Returns a base64-encoded PNG data URI: "data:image/png;base64,…"
 */
export async function screenshotSurface(sessionId: string): Promise<string> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')

  try {
    const dataUrl = await invoke<string>('browser_surface_screenshot', { sessionId })
    if (dataUrl)
      return dataUrl
  }
  catch {
    // Fall back to the DOM bridge renderer on platforms without native capture.
  }

  const result = await dispatchBridgeRequest<{ dataUrl?: string }>(
    sessionId,
    'screenshot',
    {},
    20_000,
  )

  if (!result?.dataUrl)
    throw new Error('Browser screenshot did not return image data.')

  return result.dataUrl
}

/**
 * Execute arbitrary JavaScript inside the current surface and return the result.
 * The script is evaluated in the page's main frame context.
 */
export async function executeScriptSurface(sessionId: string, script: string): Promise<unknown> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  const result = await dispatchBridgeRequest<{ value?: unknown }>(
    sessionId,
    'execute',
    { script },
    30_000,
  )
  return result?.value ?? null
}

/**
 * Retrieve cookies for an optional URL filter.
 * Passing no url returns all cookies for the current domain.
 */
export async function getCookiesSurface(sessionId: string, url?: string): Promise<BrowserCookie[]> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  const result = await dispatchBridgeRequest<{ cookies?: BrowserCookie[] }>(
    sessionId,
    'cookies',
    { action: 'get', ...(url ? { url } : {}) },
    10_000,
  )
  return result?.cookies ?? []
}

/**
 * Set or update a cookie. `domain` is inferred from the active page URL when omitted.
 */
export async function setCookieSurface(sessionId: string, cookie: BrowserCookie): Promise<void> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  await dispatchBridgeRequest(
    sessionId,
    'cookies',
    { action: 'set', cookie },
    10_000,
  )
}

/**
 * Delete cookies matching name (and optional url).
 * Omit name to clear all cookies for the url.
 */
export async function deleteCookiesSurface(sessionId: string, url: string, name?: string): Promise<void> {
  if (!sessionId)
    throw new Error('No browser page is open. Call browser_open first.')
  await dispatchBridgeRequest(
    sessionId,
    'cookies',
    {
      action: 'delete',
      url,
      ...(name ? { name } : {}),
    },
    10_000,
  )
}

export async function dispatchBridgeRequest<T = unknown>(
  sessionId: string,
  action: BrowserBridgeRequest['action'],
  args?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  await ensureListeners()
  await waitForSurface(sessionId)

  const id = makeId()

  const responsePromise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridgeWaiters.delete(id)
      reject(new Error(`Timed out waiting for browser action "${action}"`))
    }, timeoutMs)

    bridgeWaiters.set(id, { resolve, reject, timer })
  })

  await invoke('browser_surface_dispatch', {
    sessionId,
    payload: {
      id,
      action,
      args: args ?? {},
    },
  }).catch(err => {
    bridgeWaiters.delete(id)
    throw new Error(err instanceof Error ? err.message : String(err))
  })

  return responsePromise as Promise<T>
}
