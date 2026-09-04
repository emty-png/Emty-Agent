<script setup lang="ts">
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  MessageSquarePlus,
  Minus,
  MoreVertical,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { createBrowserElementAttachment, isBrowserElementAttachment, parseBrowserElementAttachment } from '@/stores/chat/core/attachmentTypes'
import {
  browserClosePage,
  browserCreateBlankPage,
  browserFindText,
  browserGoHistory,
  browserOpen,
  browserPrint,
  browserReload,
  browserScreenshot,
  browserSetZoom,
  browserSwitchPage,
} from '@/utils/browser/controller'
import { BROWSER_ELEMENT_PICKED_EVENT, setElementAnnotationsSurface, setZoomSurface, startElementPickerSurface, stopElementPickerSurface, syncSurface } from '@/utils/browser/runtime'

const props = defineProps<{
  ownerId: string
}>()

const browser = useBrowserStore()
const chat = useChatStore()
const viewportRef = ref<HTMLElement | null>(null)
const isIntersecting = ref(true)
// Needed so ResizeObserver can fire syncNow() even when no URL is loaded
// and viewportRef is null (the "Browser ready" idle state).
const rootRef = ref<HTMLElement | null>(null)
const addressInput = ref('')
const addressFocused = ref(false)
const menuOpen = ref(false)
const findOpen = ref(false)
const findQuery = ref('')
const findStatus = ref<'idle' | 'found' | 'missing'>('idle')
const findInputRef = ref<HTMLInputElement | null>(null)

const owner = computed(() => browser.getOwner(props.ownerId))
const pages = computed(() => owner.value?.pages ?? [])
const activePage = computed(() => browser.activePage(props.ownerId))
const activeTab = computed(() => chat.tabs.find(tab => tab.id === props.ownerId) ?? null)
const isAnnotating = ref(false)

const canGoBack = computed(() => (activePage.value?.historyIndex ?? -1) > 0)
const canGoForward = computed(() => {
  const page = activePage.value
  return !!page && page.historyIndex >= 0 && page.historyIndex < page.history.length - 1
})
const zoomPercent = computed(() => activePage.value?.zoomPercent ?? 100)
const canZoomOut = computed(() => zoomPercent.value > 25)
const canZoomIn = computed(() => zoomPercent.value < 200)

// Transient lifecycle errors (e.g. surface unmounting during tab switches) — not user-facing.
const INTERNAL_ERROR_PATTERNS = [
  'Browser surface unmounted',
  'Timed out waiting for browser surface',
  'No visible element found',
]
const displayError = computed(() => {
  const err = activePage.value?.lastError
  if (!err)
    return null
  if (INTERNAL_ERROR_PATTERNS.some(p => err.includes(p)))
    return null
  return err
})

let errorDismissTimer: ReturnType<typeof setTimeout> | null = null
watch(displayError, val => {
  if (errorDismissTimer)
    clearTimeout(errorDismissTimer)
  if (val && activePage.value) {
    errorDismissTimer = setTimeout(() => {
      if (activePage.value)
        activePage.value.lastError = ''
    }, 6000)
  }
})

function getFaviconUrl(url: string | undefined): string | null {
  if (!url || url.startsWith('about:') || url.startsWith('chrome:')) {
    return null
  }
  try {
    const { hostname } = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
  }
  catch {
    return null
  }
}

function parseUrlOrSearch(input: string): string {
  const trimmed = input.trim()
  if (!trimmed)
    return ''

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  // Detect likely URLs (IPs, localhost, standard domains)
  const isLikelyUrl
    = /^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/.*)?$/i.test(trimmed)
      || /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(trimmed)

  if (isLikelyUrl) {
    if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
      return `http://${trimmed}`
    }
    return `https://${trimmed}`
  }

  // Fallback to DuckDuckGo search (matches normalizeBrowserUrlInput in shared.ts)
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

function updateAddressInput() {
  if (addressFocused.value)
    return // don't overwrite while user is typing
  if (activePage.value) {
    addressInput.value = activePage.value.inputUrl || activePage.value.url || ''
  }
  else {
    addressInput.value = ''
  }
}

// Selectors for overlays that cover the native webview and require hiding it.
const OVERLAY_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-radix-dialog-overlay]',
  '[data-radix-alert-dialog-overlay]',
  '[data-overlay]',
  '.modal-overlay',
  '.modal-backdrop',
].join(',')

function hasOverlayCoveringBrowser(): boolean {
  return !!document.querySelector(OVERLAY_SELECTORS)
}

let syncTimer: ReturnType<typeof setTimeout> | null = null
let lastSyncKey: string | null = null

async function applySurface(key: string, call: () => Promise<void>) {
  if (lastSyncKey === key)
    return
  lastSyncKey = key
  try {
    await call()
  }
  catch (err) {
    console.warn('[Browser Sync] Failed to sync native surface:', err)
  }
}

function syncNow() {
  if (syncTimer)
    clearTimeout(syncTimer)

  // ── Immediate hide path ──────────────────────────────────────────────
  // Native child webviews render ON TOP of all web content and cannot
  // participate in DOM z-ordering. Any delay before hiding leaves the
  // webview floating above modals, overlays, or hidden views. We must
  // hide synchronously — the debounce is only for *showing*.
  const shouldHide
    = !owner.value?.isPanelOpen
      || !isIntersecting.value
      || menuOpen.value
      || hasOverlayCoveringBrowser()

  if (shouldHide) {
    lastSyncKey = null
    // Hide the native surface instead of parking it off-screen. Negative
    // coordinates (e.g. x:-10000) get clamped to the visible area by
    // Wayland compositors (KWin), causing background tabs to bleed through
    // at the wrong position. hide() preserves webview JS/tab state.
    void applySurface('hidden', () => syncSurface({ visible: false }))
    return
  }

  syncTimer = setTimeout(async () => {
    syncTimer = null
    await nextTick()

    // Re-check hide conditions after the debounce
    if (!owner.value?.isPanelOpen || !isIntersecting.value || hasOverlayCoveringBrowser()) {
      lastSyncKey = null
      await applySurface('hidden', () => syncSurface({ visible: false }))
      return
    }

    if (!activePage.value?.url || !viewportRef.value) {
      await applySurface('no-viewport', () => syncSurface({ visible: false }))
      return
    }

    const rect = viewportRef.value.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      await applySurface('zero-bounds', () => syncSurface({ visible: false }))
      return
    }

    // Native overlay uses the visually scaled placeholder rect as-is.
    // getBoundingClientRect() is post-zoom, matching what the user sees.
    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }

    // Rounding coordinates avoids sub-pixel jitter breaking memoization
    const key = JSON.stringify({
      s: activePage.value.sessionId,
      u: activePage.value.url,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      w: Math.round(bounds.width),
      h: Math.round(bounds.height),
    })

    await applySurface(key, () =>
      syncSurface({
        visible: true,
        sessionId: activePage.value!.sessionId,
        url: activePage.value!.url,
        bounds,
      }))
  }, 30)
}

async function submitAddress() {
  if (!addressInput.value.trim())
    return
  const finalUrl = parseUrlOrSearch(addressInput.value)
  await browserOpen(props.ownerId, finalUrl, { newTab: false })

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur() // Remove focus so user can type on the loaded page naturally
  }
}

async function openNewPage() {
  await browserCreateBlankPage(props.ownerId)
}

async function closePage(pageId: string) {
  await browserClosePage(props.ownerId, pageId)
}

async function switchPage(pageId: string) {
  if (owner.value?.activePageId !== pageId) {
    await browserSwitchPage(props.ownerId, pageId)
  }
}

async function goBack() {
  if (canGoBack.value)
    await browserGoHistory(props.ownerId, 'back')
}

async function goForward() {
  if (canGoForward.value)
    await browserGoHistory(props.ownerId, 'forward')
}

async function reloadPage() {
  if (activePage.value?.url)
    await browserReload(props.ownerId)
}

async function applyPageZoom() {
  const page = activePage.value
  if (!page?.url)
    return

  await setZoomSurface(page.sessionId, page.zoomPercent).catch(err => {
    console.warn('[Browser Settings] Failed to restore zoom:', err)
  })
}

async function setZoomPercent(nextZoom: number) {
  if (!activePage.value?.url)
    return
  await browserSetZoom(props.ownerId, nextZoom).catch(err => {
    console.warn('[Browser Settings] Failed to set zoom:', err)
  })
}

async function adjustZoom(delta: number) {
  await setZoomPercent(zoomPercent.value + delta)
}

async function resetZoom() {
  await setZoomPercent(100)
}

async function printPage() {
  menuOpen.value = false
  syncNow()
  await browserPrint(props.ownerId).catch(err => {
    console.warn('[Browser Settings] Failed to print page:', err)
  })
}

async function takeScreenshot() {
  menuOpen.value = false
  syncNow()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 80))
  await browserScreenshot(props.ownerId).catch(err => {
    console.warn('[Browser Settings] Failed to take screenshot:', err)
  })
}

async function findInPage(backwards = false) {
  if (!findQuery.value.trim())
    return

  const result = await browserFindText(props.ownerId, findQuery.value, backwards).catch(err => {
    console.warn('[Browser Settings] Failed to find text:', err)
    return null
  })
  findStatus.value = result?.found ? 'found' : 'missing'
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) {
    findOpen.value = false
    findStatus.value = 'idle'
  }
  syncNow()
}

function openFind() {
  findOpen.value = !findOpen.value
  findStatus.value = 'idle'
  if (findOpen.value) {
    nextTick(() => findInputRef.value?.focus())
  }
}

function draftAnnotationsForPage() {
  const page = activePage.value
  const tab = activeTab.value
  if (!page || !tab)
    return []

  return tab.draft.attachments
    .filter(isBrowserElementAttachment)
    .map(att => parseBrowserElementAttachment(att))
    .filter(data => data && data.url === page.url)
}

async function restoreDraftAnnotations() {
  const page = activePage.value
  if (!page?.url)
    return

  await setElementAnnotationsSurface(page.sessionId, draftAnnotationsForPage()).catch(err => {
    console.warn('[Browser Picker] Failed to restore annotations:', err)
  })
}

async function toggleAnnotating() {
  const page = activePage.value
  if (!page?.url)
    return

  if (isAnnotating.value) {
    isAnnotating.value = false
    await stopElementPickerSurface(page.sessionId).catch(err => {
      console.warn('[Browser Picker] Failed to stop picker:', err)
    })
    return
  }

  isAnnotating.value = true
  await restoreDraftAnnotations()
  await startElementPickerSurface(page.sessionId).catch(err => {
    isAnnotating.value = false
    console.warn('[Browser Picker] Failed to start picker:', err)
  })
}

function handleTabAuxClick(e: MouseEvent, pageId: string) {
  if (e.button === 1)
    closePage(pageId) // Native middle-click-to-close handling
}

function selectAllText(e: Event) {
  addressFocused.value = true
  ;(e.target as HTMLInputElement).select()
}

function onAddressBlur() {
  addressFocused.value = false
  // Restore to actual URL if user blurred without submitting
  updateAddressInput()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menuOpen.value)
    return
  menuOpen.value = false
  findOpen.value = false
  findStatus.value = 'idle'
  syncNow()
}

let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let intersectionObserver: IntersectionObserver | null = null
let unlistenElementPicked: (() => void) | null = null
let unlistenWindowMoved: (() => void) | null = null
let unlistenWindowResized: (() => void) | null = null

function observeViewport(node: HTMLElement | null) {
  resizeObserver?.disconnect()
  // Always watch the panel root — this ensures syncNow() fires on any panel
  // resize even when viewportRef is null (no URL loaded yet).
  if (rootRef.value)
    resizeObserver?.observe(rootRef.value)
  if (node && node !== rootRef.value)
    resizeObserver?.observe(node)
}

function onWindowResize() {
  syncNow()
}

onMounted(() => {
  updateAddressInput()

  resizeObserver = new ResizeObserver(() => syncNow())
  observeViewport(viewportRef.value)

  window.addEventListener('resize', onWindowResize, { passive: true })
  document.addEventListener('keydown', onDocumentKeydown)

  mutationObserver = new MutationObserver(() => syncNow())
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'aria-modal', 'data-state', 'data-overlay', 'open'],
  })
  // App zoom (Ctrl±) sets documentElement.style.zoom, which rescales the
  // placeholder without touching body attributes — observe it explicitly.
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  })

  // Detect when the component is hidden via v-show (display: none).
  // IntersectionObserver reports ratio=0 when a parent hides this element,
  // which lets us immediately unmount the native surface.
  if (rootRef.value) {
    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        const next = entry?.isIntersecting ?? true
        if (next !== isIntersecting.value) {
          isIntersecting.value = next
          syncNow()
        }
      },
      { threshold: 0.01 },
    )
    intersectionObserver.observe(rootRef.value)
  }

  void listen<{
    sessionId: string
    annotation: Parameters<typeof createBrowserElementAttachment>[0]
  }>(BROWSER_ELEMENT_PICKED_EVENT, ({ payload }) => {
    const page = activePage.value
    const tab = activeTab.value
    if (!page || !tab || payload.sessionId !== page.sessionId)
      return

    const attachment = createBrowserElementAttachment(payload.annotation)
    chat.updateTabDraft(props.ownerId, {
      attachments: [...tab.draft.attachments, attachment],
    })
  }).then(unlisten => {
    unlistenElementPicked = unlisten
  }).catch(err => {
    console.warn('[Browser Picker] Failed to listen for picked elements:', err)
  })

  // Native child position is window-relative. Re-sync after frameless
  // window drags / resizes / scale changes (KWin Wayland) so the surface
  // can't be left at a stale offset.
  try {
    const appWindow = getCurrentWindow()
    void appWindow.onMoved(() => syncNow()).then(u => {
      unlistenWindowMoved = u
    }).catch(() => {})
    void appWindow.onResized(() => syncNow()).then(u => {
      unlistenWindowResized = u
    }).catch(() => {})
  }
  catch {
    // Not running under Tauri (vitest / browser preview) — DOM observers suffice.
  }

  syncNow()
})

onUnmounted(() => {
  if (syncTimer)
    clearTimeout(syncTimer)
  if (errorDismissTimer)
    clearTimeout(errorDismissTimer)

  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  intersectionObserver?.disconnect()
  unlistenElementPicked?.()
  unlistenWindowMoved?.()
  unlistenWindowResized?.()
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('keydown', onDocumentKeydown)

  void syncSurface({ visible: false })
})

watch(activePage, async (page, previous) => {
  updateAddressInput()
  syncNow()
  if (previous?.sessionId && previous.sessionId !== page?.sessionId)
    await stopElementPickerSurface(previous.sessionId).catch(() => {})
  await restoreDraftAnnotations()
  await applyPageZoom()
  if (isAnnotating.value && page?.url)
    await startElementPickerSurface(page.sessionId).catch(() => { isAnnotating.value = false })
}, { deep: true })

watch(() => owner.value?.isPanelOpen, syncNow)
watch(viewportRef, node => {
  observeViewport(node)
  syncNow()
})
watch(
  () => activeTab.value?.draft.attachments.map(att => att.id).join('|') ?? '',
  () => {
    void restoreDraftAnnotations()
  },
)

const rootClasses = 'flex flex-col h-full min-w-0 bg-[var(--color-bg-base,#000000)] text-[var(--color-text-primary,#f2f2f2)] font-sans'

const tabsWrapperClasses = 'flex items-end gap-[2px] h-[36px] px-2 bg-[var(--color-bg-surface,#0a0a0a)] shadow-[inset_0_-1px_0_var(--color-border-subtle,#1a1a1a)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

function getTabClasses(isActive: boolean) {
  const base = 'group inline-flex items-center gap-1.5 min-w-[80px] max-w-[220px] h-[30px] px-2.5 border-t border-l border-r border-b rounded-t-(--radius-sm) text-[12px] font-[450] cursor-pointer select-none shrink-0 transition-[background,color,border-color] duration-[120ms] ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent,#00e5ff)] focus-visible:-outline-offset-1'
  if (isActive) {
    return `${base} bg-[var(--color-bg-base,#000000)] text-[var(--color-text-primary,#f2f2f2)] border-t-[var(--color-border-subtle,#1a1a1a)] border-l-[var(--color-border-subtle,#1a1a1a)] border-r-[var(--color-border-subtle,#1a1a1a)] border-b-[var(--color-bg-base,#000000)] cursor-default`
  }
  return `${base} bg-transparent text-[var(--color-text-tertiary,#8a8a8a)] border-transparent border-b-[var(--color-border-subtle,#1a1a1a)] hover:bg-[var(--color-bg-hover,#1c1c1c)] hover:text-[var(--color-text-secondary,#cccccc)]`
}

const faviconWrapperClasses = 'grid place-items-center w-[14px] h-[14px] shrink-0 -order-1'
const faviconLoadingClasses = 'w-[14px] h-[14px] rounded-(--radius-xs) object-contain transition-opacity duration-150 ease opacity-40 grayscale'
const faviconLoadedClasses = 'w-[14px] h-[14px] rounded-(--radius-xs) object-contain transition-opacity duration-150 ease'
const faviconGlobeClasses = 'text-inherit opacity-70'

const tabTitleClasses = 'flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium'

function getTabCloseClasses(isActive: boolean) {
  const base = 'grid place-items-center w-[18px] h-[18px] rounded-(--radius-sm) shrink-0 transition-[background,color] duration-[120ms] ease outline-none hover:bg-[color-mix(in_srgb,var(--color-danger,#ef4444)_15%,transparent)] hover:!text-[var(--color-danger,#ef4444)] focus-visible:bg-[color-mix(in_srgb,var(--color-danger,#ef4444)_15%,transparent)] focus-visible:!text-[var(--color-danger,#ef4444)]'
  return isActive
    ? `${base} text-[var(--color-text-dim,#595959)]`
    : `${base} text-transparent group-hover:text-[var(--color-text-dim,#595959)]`
}

const btnBase = 'inline-flex items-center justify-center h-[28px] border border-transparent rounded-(--radius-md) bg-transparent text-[var(--color-text-dim,#595959)] shrink-0 cursor-pointer [transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1),color_120ms_ease] active:scale-[0.97] active:duration-[80ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent,#00e5ff)]'
const newTabClasses = `${btnBase} w-[28px] ml-[2px] mb-[4px] hover:bg-[var(--color-state-hover,#1c1c1c)] hover:border-(--color-border-mid) hover:rounded-(--radius-lg) hover:text-[var(--color-text-primary,#f2f2f2)]`
const toolbarBtnClasses = `${btnBase} w-[32px] disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-[var(--color-state-hover,#1c1c1c)] enabled:hover:border-(--color-border-mid) enabled:hover:rounded-(--radius-lg) enabled:hover:text-[var(--color-text-primary,#f2f2f2)]`
const annotateBtnClasses = computed(() => isAnnotating.value
  ? `${toolbarBtnClasses} !bg-[color-mix(in_srgb,var(--color-accent,#00e5ff)_18%,transparent)] !text-[var(--color-accent,#00e5ff)]`
  : toolbarBtnClasses)

const toolbarClasses = 'flex items-center gap-1.5 py-2 px-3 bg-[var(--color-bg-base,#000000)] border-b border-[color-mix(in_srgb,var(--color-border-subtle,#1a1a1a)_40%,transparent)]'
const formClasses = 'flex-1 min-w-0'

// Single crisp border on the address bar shell (outer focus shadow ring removed)
const addressShellClasses = 'flex items-center gap-2 h-[34px] px-[14px] border border-[color-mix(in_srgb,var(--color-border-subtle,#1a1a1a)_60%,transparent)] rounded-(--radius-lg) bg-[color-mix(in_srgb,var(--color-bg-surface,#0a0a0a)_50%,transparent)] transition-[border-color,background] duration-150 ease focus-within:border-[color-mix(in_srgb,var(--color-accent,#00e5ff)_80%,transparent)] focus-within:bg-[var(--color-bg-surface,#0a0a0a)]'

const addressIconClasses = 'text-[var(--color-text-dim,#595959)] shrink-0'
const addressSpinnerClasses = 'text-[var(--color-accent,#00e5ff)] shrink-0 animate-spin'
const addressInputClasses = 'flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--color-text-primary,#f2f2f2)] text-[13px] tracking-[0.01em] placeholder:text-[color-mix(in_srgb,var(--color-text-dim,#595959)_70%,transparent)] placeholder:text-[12.5px]'

// ── Menu / Dropdown classes matching Modelpicker ─────────────────────────────
const menuWrapClasses = 'relative shrink-0'
const menuBtnClasses = computed(() => {
  const shared = [
    'inline-flex items-center justify-center w-[32px] h-[28px] border',
    'shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
    '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]',
    'active:scale-[0.97] active:duration-[80ms]',
    'hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)',
  ].join(' ')

  return menuOpen.value
    ? `${shared} bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg) text-(--color-text-primary)`
    : `${shared} bg-transparent border-transparent rounded-(--radius-md) text-(--color-text-dim,#595959) hover:text-(--color-text-primary)`
})

const menuPanelClasses = 'absolute right-0 top-[calc(100%+8px)] z-[10000] w-[210px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden py-1.5'

const menuItemClasses = [
  'flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 my-[2px] h-[30px] px-2 border border-transparent rounded-(--radius-sm)',
  'text-left box-border cursor-pointer select-none',
  '[transition:background_100ms_cubic-bezier(0.4,0,0.2,1),border-color_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]',
  'bg-transparent text-(--color-text-secondary)',
  'hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:border-transparent disabled:hover:text-(--color-text-secondary)',
].join(' ')

const menuItemTextClasses = 'text-[12.5px] font-medium tracking-[0.01em]'
const menuDividerClasses = 'my-1 mx-1.5 h-px bg-(--color-border-mid)'

const zoomRowClasses = 'flex items-center justify-between w-[calc(100%-12px)] mx-1.5 my-[2px] h-[30px] px-2 text-[12px] font-medium text-(--color-text-secondary)'
const zoomControlsClasses = 'flex items-center overflow-hidden rounded-(--radius-md) border border-(--color-border-mid) bg-(--color-bg-card) h-[24px]'
const zoomButtonClasses = 'grid h-[24px] w-[22px] place-items-center border-0 bg-transparent text-(--color-text-tertiary) cursor-pointer transition-colors duration-100 hover:bg-(--color-state-hover) hover:text-(--color-text-primary) disabled:cursor-not-allowed disabled:opacity-35'
const zoomValueClasses = 'grid h-[24px] min-w-[38px] place-items-center border-x border-(--color-border-mid) px-1 text-[11.5px] font-medium text-(--color-text-primary)'
const zoomResetBtnClasses = 'grid h-[24px] w-[24px] place-items-center rounded-(--radius-md) border border-(--color-border-mid) bg-(--color-bg-card) text-(--color-text-tertiary) cursor-pointer transition-colors duration-100 hover:bg-(--color-state-hover) hover:text-(--color-text-primary)'

const findRowClasses = 'flex items-center gap-1 px-1.5 pb-1 pt-0.5 mx-1.5'
const findInputClasses = 'h-7 min-w-0 flex-1 px-2 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-md) text-(--color-text-primary) text-[12px] outline-none box-border placeholder:text-(--color-text-dim) focus:border-(--color-accent) transition-colors duration-150'
const findNavClasses = 'grid h-7 w-7 place-items-center rounded-(--radius-md) border border-(--color-border-bright) bg-(--color-bg-card) text-(--color-text-tertiary) cursor-pointer transition-colors duration-100 hover:bg-(--color-state-hover) hover:text-(--color-text-primary)'
const findStatusClasses = 'px-2.5 pb-1 text-[11px] font-medium text-(--color-danger-text)'

const stageClasses = 'relative flex-1 min-h-0 bg-[var(--color-bg-base,#000000)]'
const viewportClasses = 'absolute inset-0 z-10'

const emptyWrapClasses = 'absolute inset-0 flex flex-col items-center justify-center gap-3 p-7 text-center bg-[var(--color-bg-base,#000000)]'
const emptyMarkClasses = 'grid place-items-center w-12 h-12 rounded-(--radius-lg) bg-[color-mix(in_srgb,var(--color-accent,#00e5ff)_15%,transparent)] text-[var(--color-accent,#00e5ff)]'
const emptyTitleClasses = 'text-[15px] font-semibold text-[var(--color-text-primary,#f2f2f2)] m-0'
const emptyCopyClasses = 'max-w-[280px] text-[13px] leading-[1.6] text-[var(--color-text-dim,#595959)] m-0'

const loadingOverlayClasses = 'absolute inset-0 z-[15] flex items-center justify-center bg-[var(--color-bg-base,#000000)] pointer-events-none'
const loadingSpinnerClasses = 'text-[var(--color-text-dim,#595959)] animate-spin'

const errorWrapClasses = 'absolute z-20 right-4 bottom-4 flex items-start gap-2 max-w-[min(420px,calc(100%-32px))] py-3 px-[14px] border border-[color-mix(in_srgb,var(--color-danger,#ef4444)_40%,transparent)] rounded-(--radius-lg) bg-[color-mix(in_srgb,var(--color-danger,#ef4444)_12%,var(--color-bg-base,#000000))] text-[var(--color-danger-text,#fca5a5)] text-[13px] leading-[1.5] shadow-[var(--color-shadow-md)]'
const errorIconClasses = 'mt-[2px] shrink-0'

const loadingTransitions = {
  enterActiveClass: 'transition-opacity duration-200 ease',
  enterFromClass: 'opacity-0',
}
</script>

<template>
  <div ref="rootRef" :class="rootClasses">
    <div :class="tabsWrapperClasses" role="tablist">
      <button
        v-for="page in pages"
        :key="page.id"
        role="tab"
        :aria-selected="page.id === owner?.activePageId"
        :title="page.title"
        :class="getTabClasses(page.id === owner?.activePageId)"
        @click="switchPage(page.id)"
        @auxclick.middle="handleTabAuxClick($event, page.id)"
      >
        <span :class="faviconWrapperClasses">
          <template v-if="getFaviconUrl(page.url)">
            <img
              :src="getFaviconUrl(page.url)!"
              :class="(page.status === 'mounting' || page.status === 'loading') ? faviconLoadingClasses : faviconLoadedClasses"
              alt=""
              width="14"
              height="14"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            >
          </template>
          <Globe v-else :size="13" :stroke-width="1.8" :class="faviconGlobeClasses" />
        </span>
        <span :class="tabTitleClasses">{{ page.title || 'New Tab' }}</span>
        <span
          :class="getTabCloseClasses(page.id === owner?.activePageId)"
          role="button"
          title="Close tab"
          aria-label="Close browser tab"
          tabindex="0"
          @click.stop="closePage(page.id)"
          @keydown.enter.stop="closePage(page.id)"
          @keydown.space.stop="closePage(page.id)"
        >
          <X :size="11" :stroke-width="2.5" />
        </span>
      </button>

      <button
        :class="newTabClasses"
        title="Open new tab"
        aria-label="New browser tab"
        @click="openNewPage"
      >
        <Plus :size="14" :stroke-width="2" />
      </button>
    </div>

    <div :class="toolbarClasses">
      <button :class="toolbarBtnClasses" :disabled="!canGoBack" title="Click to go back" aria-label="Back" @click="goBack">
        <ChevronLeft :size="16" :stroke-width="2.25" />
      </button>
      <button :class="toolbarBtnClasses" :disabled="!canGoForward" title="Click to go forward" aria-label="Forward" @click="goForward">
        <ChevronRight :size="16" :stroke-width="2.25" />
      </button>
      <button :class="toolbarBtnClasses" :disabled="!activePage?.url" title="Reload page" aria-label="Reload" @click="reloadPage">
        <RefreshCw :size="14" :stroke-width="2.25" />
      </button>

      <form :class="formClasses" @submit.prevent="submitAddress">
        <div :class="addressShellClasses">
          <Globe :class="addressIconClasses" :size="13" :stroke-width="2" />
          <input
            v-model="addressInput"
            :class="addressInputClasses"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="Search or type a URL"
            @focus="selectAllText"
            @blur="onAddressBlur"
          >
          <Loader2
            v-if="activePage && (activePage.status === 'mounting' || activePage.status === 'loading')"
            :class="addressSpinnerClasses"
            :size="13"
            :stroke-width="2"
          />
        </div>
      </form>

      <button :class="annotateBtnClasses" :disabled="!activePage?.url" :title="isAnnotating ? 'Stop annotating' : 'Annotate page element'" :aria-pressed="isAnnotating" aria-label="Annotate page element" @click="toggleAnnotating">
        <MessageSquarePlus :size="14" :stroke-width="2.25" />
      </button>

      <div :class="menuWrapClasses">
        <button
          :class="menuBtnClasses"
          :disabled="!activePage?.url"
          :aria-expanded="menuOpen"
          title="Browser settings"
          aria-label="Browser settings"
          @click="toggleMenu"
        >
          <MoreVertical :size="15" :stroke-width="2.25" />
        </button>

        <Transition
          enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top-right"
          enter-from-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
          enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-top-right"
          leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-to-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
        >
          <div v-if="menuOpen" :class="menuPanelClasses">
            <button :class="menuItemClasses" @click="openFind">
              <Search :size="13" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
              <span :class="menuItemTextClasses">Find in page</span>
            </button>

            <form v-if="findOpen" :class="findRowClasses" @submit.prevent="findInPage(false)">
              <input
                ref="findInputRef"
                v-model="findQuery"
                :class="findInputClasses"
                type="text"
                placeholder="Find text…"
              >
              <button :class="findNavClasses" type="button" aria-label="Find previous" @click="findInPage(true)">
                <ChevronLeft :size="12" :stroke-width="2" />
              </button>
              <button :class="findNavClasses" type="submit" aria-label="Find next">
                <ChevronRight :size="12" :stroke-width="2" />
              </button>
            </form>
            <div v-if="findStatus === 'missing'" :class="findStatusClasses">
              No matches found
            </div>

            <button :class="menuItemClasses" @click="printPage">
              <Printer :size="13" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
              <span :class="menuItemTextClasses">Print</span>
            </button>

            <div :class="menuDividerClasses" />

            <div :class="zoomRowClasses">
              <span>Zoom</span>
              <div class="flex items-center gap-1 ml-auto">
                <div :class="zoomControlsClasses">
                  <button :class="zoomButtonClasses" :disabled="!canZoomOut" aria-label="Zoom out" @click="adjustZoom(-10)">
                    <Minus :size="11" :stroke-width="2" />
                  </button>
                  <span :class="zoomValueClasses">{{ zoomPercent }}%</span>
                  <button :class="zoomButtonClasses" :disabled="!canZoomIn" aria-label="Zoom in" @click="adjustZoom(10)">
                    <Plus :size="11" :stroke-width="2" />
                  </button>
                </div>
                <button :class="zoomResetBtnClasses" title="Reset zoom" aria-label="Reset zoom" @click="resetZoom">
                  <RotateCcw :size="11" :stroke-width="1.8" />
                </button>
              </div>
            </div>

            <div :class="menuDividerClasses" />

            <button :class="menuItemClasses" @click="takeScreenshot">
              <Camera :size="13" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
              <span :class="menuItemTextClasses">Take a screenshot</span>
            </button>
          </div>
        </Transition>

        <!-- Fixed transparent backdrop for outside clicks -->
        <div v-if="menuOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="toggleMenu" />
      </div>
    </div>

    <div :class="stageClasses">
      <div v-if="!activePage || !activePage.url" :class="emptyWrapClasses">
        <div :class="emptyMarkClasses">
          <Globe :size="24" :stroke-width="1.8" />
        </div>
        <p :class="emptyTitleClasses">
          Browser ready
        </p>
        <p :class="emptyCopyClasses">
          Use the address bar or the browser tools to open a page in this chat tab.
        </p>
      </div>

      <div v-else ref="viewportRef" :class="viewportClasses" />

      <!-- Loading overlay — prevents the white stage flash while Tauri surface mounts -->
      <Transition v-bind="loadingTransitions">
        <div
          v-if="activePage && (activePage.status === 'mounting' || activePage.status === 'loading')"
          :class="loadingOverlayClasses"
        >
          <Loader2 :size="22" :stroke-width="1.8" :class="loadingSpinnerClasses" />
        </div>
      </Transition>

      <div v-if="displayError" :class="errorWrapClasses">
        <AlertTriangle :size="14" :stroke-width="2" :class="errorIconClasses" />
        <span>{{ displayError }}</span>
      </div>
    </div>
  </div>
</template>
