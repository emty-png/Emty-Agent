import type { BrowserCookie } from './runtime'
import { join } from '@tauri-apps/api/path'
import { writeFile } from '@tauri-apps/plugin-fs'
import { nextTick } from 'vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { resolveTabWorkspacePath } from '@/stores/chat/utils/workspace'
import { useProjectStore } from '@/stores/project'
import {
  closeSurface,
  currentSurfaceSessionId,
  deleteCookiesSurface,
  dispatchBridgeRequest,
  executeScriptSurface,
  findTextSurface,
  getCookiesSurface,
  goBackSurface,
  goForwardSurface,
  navigateSurface,
  printSurface,
  reloadSurface,
  screenshotSurface,
  setCookieSurface,
  setZoomSurface,
  syncSurface,
  waitForSurface,
} from './runtime'
import { labelFromUrl, normalizeBrowserUrlInput } from './shared'

function sanitizeScreenshotSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

function screenshotTimestamp(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function screenshotFileName(url: string): string {
  let host = 'page'

  try {
    host = new URL(url).hostname || host
  }
  catch {
    // Ignore URL parsing issues and keep the fallback host label.
  }

  return `emty-agent-browser-screenshot-${screenshotTimestamp()}-${sanitizeScreenshotSegment(host, 'page')}.png`
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const match = dataUri.match(/^data:image\/png;base64,(.+)$/)
  if (!match?.[1])
    throw new Error('Browser screenshot did not return a PNG data URI.')

  const binary = atob(match[1])
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)

  return bytes
}

async function saveScreenshotToProject(ownerId: string, url: string, dataUri: string): Promise<string | null> {
  const project = useProjectStore()
  const chat = useChatStore()
  const workspacePath = resolveTabWorkspacePath(
    chat.tabs.find(tab => tab.id === ownerId),
    project.projectPath,
  )
  if (!workspacePath)
    return null

  const filePath = await join(workspacePath, screenshotFileName(url))
  await writeFile(filePath, dataUriToBytes(dataUri))
  return filePath
}

function requireActivePage(ownerId: string) {
  const browser = useBrowserStore()
  const page = browser.activePage(ownerId)
  if (!page)
    throw new Error('No browser page is open. Call browser_open first.')
  if (!page.url)
    throw new Error('The active browser page does not have a URL yet. Call browser_open first.')
  return page
}

export async function browserOpen(ownerId: string, rawUrl: string, options?: { newTab?: boolean }) {
  const browser = useBrowserStore()
  const url = normalizeBrowserUrlInput(rawUrl)
  const page = browser.prepareNavigation(
    ownerId,
    url,
    options?.newTab
      ? {
          newPage: true,
          historyMode: 'push',
        }
      : {
          historyMode: 'push',
        },
  )

  const shouldDirectNavigate = currentSurfaceSessionId() === page.sessionId

  await nextTick()

  if (shouldDirectNavigate)
    await navigateSurface(page.sessionId, url)
  else
    await waitForSurface(page.sessionId)

  return {
    pageId: page.id,
    sessionId: page.sessionId,
    title: page.title,
    url,
  }
}

export async function browserCreateBlankPage(ownerId: string) {
  const browser = useBrowserStore()
  const page = browser.createPage(ownerId)
  await nextTick()

  await syncSurface({ visible: false })

  return {
    pageId: page.id,
    sessionId: page.sessionId,
    title: page.title,
    url: page.url,
  }
}

export async function browserSwitchPage(ownerId: string, pageId: string) {
  const browser = useBrowserStore()
  const page = browser.activatePage(ownerId, pageId)
  if (!page)
    throw new Error(`Browser page "${pageId}" was not found. Use browser_tabs action="list" to get valid page IDs.`)

  await nextTick()

  if (page.url)
    await waitForSurface(page.sessionId)
  else
    await syncSurface({ visible: false })

  return {
    pageId: page.id,
    sessionId: page.sessionId,
    title: page.title,
    url: page.url,
  }
}

export async function browserClosePage(ownerId: string, pageId: string) {
  const browser = useBrowserStore()
  const closingPage = browser.getOwner(ownerId).pages.find(page => page.id === pageId)
  const nextPage = browser.closePage(ownerId, pageId)
  await nextTick()

  if (closingPage)
    await closeSurface(closingPage.sessionId).catch(() => {})

  if (!nextPage?.url)
    await syncSurface({ visible: false })

  return browserListPages(ownerId)
}

export function browserListPages(ownerId: string) {
  const browser = useBrowserStore()
  const owner = browser.getOwner(ownerId)

  return owner.pages.map((page, index) => ({
    index,
    id: page.id,
    sessionId: page.sessionId,
    title: page.title || labelFromUrl(page.url),
    url: page.url,
    status: page.status,
    active: owner.activePageId === page.id,
  }))
}

export async function browserGoHistory(ownerId: string, direction: 'back' | 'forward') {
  const browser = useBrowserStore()
  const page = browser.activePage(ownerId)
  if (!page)
    throw new Error('No browser page is open. Call browser_open first.')

  try {
    if (direction === 'back')
      await goBackSurface(page.sessionId)
    else
      await goForwardSurface(page.sessionId)

    await waitForSurface(page.sessionId, 6000)

    const current = browser.activePage(ownerId)
    return {
      pageId: current?.id ?? page.id,
      url: current?.url ?? page.url,
      historyIndex: current?.historyIndex ?? page.historyIndex,
    }
  }
  catch {
    const delta = direction === 'back' ? -1 : 1
    const nextPage = browser.goToHistoryIndex(ownerId, page.historyIndex + delta)
    if (!nextPage) {
      throw new Error(
        direction === 'back'
          ? 'Cannot go back - already at the start of the tracked history. If you navigated by clicking links, back/forward uses the browser\'s native stack automatically.'
          : 'Cannot go forward - already at the most recent tracked page.',
      )
    }

    await nextTick()
    await navigateSurface(nextPage.sessionId, nextPage.url)
    await waitForSurface(nextPage.sessionId)

    return {
      pageId: nextPage.id,
      url: nextPage.url,
      historyIndex: nextPage.historyIndex,
    }
  }
}

export async function browserReload(ownerId: string) {
  const browser = useBrowserStore()
  const page = browser.markReload(ownerId)
  if (!page)
    throw new Error('No browser page is open. Call browser_open first.')

  await nextTick()
  await waitForSurface(page.sessionId)
  await reloadSurface(page.sessionId)

  return {
    pageId: page.id,
    url: page.url,
  }
}

export async function browserRead(ownerId: string, mode: 'snapshot' | 'element', args?: Record<string, unknown>) {
  const page = requireActivePage(ownerId)
  const action = mode === 'snapshot' ? 'snapshot' : 'extract'
  const result = await dispatchBridgeRequest(page.sessionId, action, args)
  return {
    pageId: page.id,
    sessionId: page.sessionId,
    result,
  }
}

export async function browserAct(
  ownerId: string,
  action: 'click' | 'type' | 'press' | 'scroll' | 'wait',
  args?: Record<string, unknown>,
) {
  const page = requireActivePage(ownerId)
  const result = await dispatchBridgeRequest(page.sessionId, action, args)
  return {
    pageId: page.id,
    sessionId: page.sessionId,
    result,
  }
}

export async function browserScreenshot(ownerId: string) {
  const page = requireActivePage(ownerId)
  const dataUri = await screenshotSurface(page.sessionId)
  const savedPath = await saveScreenshotToProject(ownerId, page.url, dataUri)
  return {
    pageId: page.id,
    url: page.url,
    screenshot: dataUri,
    saved: Boolean(savedPath),
    savedPath,
  }
}

export async function browserExecuteScript(ownerId: string, script: string) {
  const page = requireActivePage(ownerId)
  const result = await executeScriptSurface(page.sessionId, script)
  return {
    pageId: page.id,
    url: page.url,
    result,
  }
}

export async function browserSetZoom(ownerId: string, zoomPercent: number) {
  const browser = useBrowserStore()
  const page = requireActivePage(ownerId)
  browser.setPageZoom(ownerId, page.id, zoomPercent)
  await setZoomSurface(page.sessionId, zoomPercent)
  return {
    pageId: page.id,
    url: page.url,
    zoomPercent: page.zoomPercent,
  }
}

export async function browserPrint(ownerId: string) {
  const page = requireActivePage(ownerId)
  await printSurface(page.sessionId)
  return {
    pageId: page.id,
    url: page.url,
    ok: true,
  }
}

export async function browserFindText(ownerId: string, query: string, backwards = false) {
  const page = requireActivePage(ownerId)
  const result = await findTextSurface(page.sessionId, query, backwards)
  return {
    pageId: page.id,
    url: page.url,
    found: result.found === true,
  }
}

export async function browserLogs(ownerId: string, clear = true) {
  const page = requireActivePage(ownerId)
  const result = await executeScriptSurface(
    page.sessionId,
    `
      const logs = window.__EMTY_AGENT_LOGS__ || [];
      ${clear ? 'window.__EMTY_AGENT_LOGS__ = [];' : ''}
      return logs;
    `,
  )
  return {
    pageId: page.id,
    url: page.url,
    logs: Array.isArray(result) ? result : [],
  }
}

export async function browserCookies(
  ownerId: string,
  action: 'get' | 'set' | 'delete',
  params?: { cookie?: BrowserCookie | undefined; url?: string | undefined; name?: string | undefined },
) {
  const page = requireActivePage(ownerId)

  switch (action) {
    case 'get': {
      const cookies = await getCookiesSurface(page.sessionId, params?.url ?? page.url)
      return { pageId: page.id, url: page.url, cookies }
    }
    case 'set': {
      if (!params?.cookie)
        throw new Error('browser_cookies action="set" requires a cookie object.')
      await setCookieSurface(page.sessionId, params.cookie)
      return { pageId: page.id, url: page.url, ok: true }
    }
    case 'delete': {
      const targetUrl = params?.url ?? page.url
      if (!targetUrl)
        throw new Error('browser_cookies action="delete" requires a URL or an open page.')
      await deleteCookiesSurface(page.sessionId, targetUrl, params?.name)
      return { pageId: page.id, url: page.url, ok: true }
    }
  }
}
