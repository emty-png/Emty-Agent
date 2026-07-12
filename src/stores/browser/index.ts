import { defineStore } from 'pinia'
import { ref } from 'vue'
import { labelFromUrl, makeBrowserId } from '@/utils/browser/shared'

export type BrowserPageStatus = 'idle' | 'mounting' | 'loading' | 'ready' | 'error'
export type BrowserHistoryMode = 'push' | 'replace' | 'ignore' | 'index'

export interface BrowserPageState {
  id: string
  sessionId: string
  title: string
  url: string
  inputUrl: string
  status: BrowserPageStatus
  lastError: string
  history: string[]
  historyIndex: number
  pendingHistoryMode?: BrowserHistoryMode | undefined
  pendingHistoryIndex?: number | undefined
  updatedAt: number
}

export interface BrowserOwnerState {
  isPanelOpen: boolean
  splitPercent: number
  pages: BrowserPageState[]
  activePageId: string | null
}

const DEFAULT_SPLIT_PERCENT = 50

function now() {
  return Date.now()
}

function createOwnerState(): BrowserOwnerState {
  return {
    isPanelOpen: false,
    splitPercent: DEFAULT_SPLIT_PERCENT,
    pages: [],
    activePageId: null,
  }
}

function createPageState(url = ''): BrowserPageState {
  return {
    id: makeBrowserId(),
    sessionId: makeBrowserId(),
    title: url ? labelFromUrl(url) : 'New page',
    url,
    inputUrl: url,
    status: url ? 'mounting' : 'idle',
    lastError: '',
    history: [],
    historyIndex: -1,
    updatedAt: now(),
  }
}

export const useBrowserStore = defineStore('browser', () => {
  const owners = ref<Record<string, BrowserOwnerState>>({})

  function ensureOwner(ownerId: string): BrowserOwnerState {
    owners.value[ownerId] ??= createOwnerState()
    return owners.value[ownerId]!
  }

  function getOwner(ownerId: string): BrowserOwnerState {
    return ensureOwner(ownerId)
  }

  function activePage(ownerId: string): BrowserPageState | null {
    const owner = ensureOwner(ownerId)
    return owner.pages.find(page => page.id === owner.activePageId) ?? null
  }

  function findPageBySession(sessionId: string): { ownerId: string; owner: BrowserOwnerState; page: BrowserPageState } | null {
    for (const [ownerId, owner] of Object.entries(owners.value)) {
      const page = owner.pages.find(candidate => candidate.sessionId === sessionId)
      if (page)
        return { ownerId, owner, page }
    }
    return null
  }

  function createPage(ownerId: string, url = ''): BrowserPageState {
    const owner = ensureOwner(ownerId)
    const page = createPageState(url)
    owner.pages.push(page)
    owner.activePageId = page.id
    return page
  }

  function activatePage(ownerId: string, pageId: string): BrowserPageState | null {
    const owner = ensureOwner(ownerId)
    if (!owner.pages.some(page => page.id === pageId))
      return null
    owner.activePageId = pageId
    return activePage(ownerId)
  }

  function openPanel(ownerId: string): void {
    ensureOwner(ownerId).isPanelOpen = true
  }

  function closePanel(ownerId: string): void {
    ensureOwner(ownerId).isPanelOpen = false
  }

  function setSplitPercent(ownerId: string, percent: number): void {
    ensureOwner(ownerId).splitPercent = percent
  }

  function prepareNavigation(ownerId: string, url: string, options?: {
    newPage?: boolean | undefined
    historyMode?: BrowserHistoryMode | undefined
    historyIndex?: number | undefined
  }): BrowserPageState {
    const owner = ensureOwner(ownerId)
    const page = options?.newPage || !activePage(ownerId)
      ? createPage(ownerId, url)
      : activePage(ownerId)!

    page.url = url
    page.inputUrl = url
    page.title = labelFromUrl(url)
    page.status = 'mounting'
    page.lastError = ''
    page.pendingHistoryMode = options?.historyMode ?? 'push'
    page.pendingHistoryIndex = options?.historyIndex
    page.updatedAt = now()

    owner.activePageId = page.id
    owner.isPanelOpen = true
    return page
  }

  function markReload(ownerId: string): BrowserPageState | null {
    const page = activePage(ownerId)
    if (!page || !page.url)
      return null
    page.status = 'loading'
    page.lastError = ''
    page.pendingHistoryMode = 'replace'
    page.updatedAt = now()
    return page
  }

  function markPageMounted(sessionId: string): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return
    match.page.status = match.page.url ? 'loading' : 'idle'
    match.page.updatedAt = now()
  }

  function markPageLoading(sessionId: string, url: string): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return
    match.page.url = url
    match.page.inputUrl = url
    match.page.title = labelFromUrl(url)
    match.page.status = 'loading'
    match.page.lastError = ''
    match.page.updatedAt = now()
  }

  function commitNavigation(match: { page: BrowserPageState }, url: string): void {
    const page = match.page
    const mode = page.pendingHistoryMode

    if (mode === 'index' && typeof page.pendingHistoryIndex === 'number') {
      page.historyIndex = page.pendingHistoryIndex
    }
    else if (mode === 'replace') {
      if (page.historyIndex >= 0) {
        page.history[page.historyIndex] = url
      }
      else {
        page.history.push(url)
        page.historyIndex = page.history.length - 1
      }
    }
    else if (mode === 'ignore') {
      if (page.historyIndex < 0) {
        page.history.push(url)
        page.historyIndex = page.history.length - 1
      }
    }
    else if (page.history[page.historyIndex] !== url) {
      page.history.splice(page.historyIndex + 1)
      page.history.push(url)
      page.historyIndex = page.history.length - 1
    }

    page.pendingHistoryMode = undefined
    page.pendingHistoryIndex = undefined
  }

  function markPageReady(sessionId: string, url: string): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return

    match.page.url = url
    match.page.inputUrl = url
    match.page.title = labelFromUrl(url)
    match.page.status = 'ready'
    match.page.lastError = ''
    match.page.updatedAt = now()
    commitNavigation(match, url)
  }

  function setPageTitle(sessionId: string, title: string): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return
    match.page.title = title.trim() || labelFromUrl(match.page.url)
    match.page.updatedAt = now()
  }

  function setPageError(sessionId: string, message: string): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return
    match.page.status = 'error'
    match.page.lastError = message
    match.page.updatedAt = now()
  }

  function syncPageFromBridge(
    sessionId: string,
    payload: { url?: string | undefined; title?: string | undefined },
  ): void {
    const match = findPageBySession(sessionId)
    if (!match)
      return

    if (payload.url) {
      match.page.url = payload.url
      match.page.inputUrl = payload.url
      if (!match.page.history.length) {
        match.page.history.push(payload.url)
        match.page.historyIndex = 0
      }
    }

    if (payload.title) {
      match.page.title = payload.title
    }

    match.page.status = 'ready'
    match.page.updatedAt = now()
  }

  function closePage(ownerId: string, pageId: string): BrowserPageState | null {
    const owner = ensureOwner(ownerId)
    const index = owner.pages.findIndex(page => page.id === pageId)
    if (index === -1)
      return activePage(ownerId)

    owner.pages.splice(index, 1)

    if (owner.activePageId === pageId) {
      const next = owner.pages[Math.max(0, index - 1)] ?? owner.pages[0] ?? null
      owner.activePageId = next?.id ?? null
    }

    return activePage(ownerId)
  }

  function listPages(ownerId: string): BrowserPageState[] {
    return [...ensureOwner(ownerId).pages]
  }

  function goToHistoryIndex(ownerId: string, nextIndex: number): BrowserPageState | null {
    const page = activePage(ownerId)
    if (!page)
      return null
    if (nextIndex < 0 || nextIndex >= page.history.length)
      return null

    const targetUrl = page.history[nextIndex]!
    page.url = targetUrl
    page.inputUrl = targetUrl
    page.status = 'loading'
    page.lastError = ''
    page.pendingHistoryMode = 'index'
    page.pendingHistoryIndex = nextIndex
    page.updatedAt = now()
    return page
  }

  function disposeOwner(ownerId: string): void {
    delete owners.value[ownerId]
  }

  return {
    owners,
    getOwner,
    activePage,
    findPageBySession,
    createPage,
    activatePage,
    openPanel,
    closePanel,
    setSplitPercent,
    prepareNavigation,
    markReload,
    markPageMounted,
    markPageLoading,
    markPageReady,
    setPageTitle,
    setPageError,
    syncPageFromBridge,
    closePage,
    listPages,
    goToHistoryIndex,
    disposeOwner,
  }
})
