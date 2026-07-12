<script setup lang="ts">
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useBrowserStore } from '@/stores/browser'
import {
  browserClosePage,
  browserCreateBlankPage,
  browserGoHistory,
  browserOpen,
  browserReload,
  browserSwitchPage,
} from '@/utils/browser/controller'
import { syncSurface } from '@/utils/browser/runtime'

const props = defineProps<{
  ownerId: string
}>()

const browser = useBrowserStore()
const viewportRef = ref<HTMLElement | null>(null)
const isIntersecting = ref(true)
// Needed so ResizeObserver can fire syncNow() even when no URL is loaded
// and viewportRef is null (the "Browser ready" idle state).
const rootRef = ref<HTMLElement | null>(null)
const addressInput = ref('')
const addressFocused = ref(false)

const owner = computed(() => browser.getOwner(props.ownerId))
const pages = computed(() => owner.value?.pages ?? [])
const activePage = computed(() => browser.activePage(props.ownerId))

const canGoBack = computed(() => (activePage.value?.historyIndex ?? -1) > 0)
const canGoForward = computed(() => {
  const page = activePage.value
  return !!page && page.historyIndex >= 0 && page.historyIndex < page.history.length - 1
})

/**
 * Internal lifecycle errors (surface unmounting during tab switches etc.)
 * must never be shown to the user — they're transient and auto-resolve.
 */
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

// Auto-dismiss error banner after 6 s
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

/**
 * Safely generate a Google Favicon URL.
 * Falls back to null for internal/empty pages.
 */
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

/**
 * Parses user input into a valid URL or search query.
 */
function parseUrlOrSearch(input: string): string {
  const trimmed = input.trim()
  if (!trimmed)
    return ''

  // Valid protocol already provided
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

// ---------------------------------------------------------------------------
// Overlay detection
// Selectors for modals / dialogs / drawers that cover the native surface.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Core sync — memoized native viewbox syncing
// ---------------------------------------------------------------------------
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
      || hasOverlayCoveringBrowser()

  if (shouldHide) {
    lastSyncKey = null
    void applySurface('hidden', () => syncSurface({ visible: false }))
    return
  }

  // ── Debounced show path ──────────────────────────────────────────────
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

    // Rounding coordinates avoids sub-pixel jitter breaking memoization
    const key = JSON.stringify({
      s: activePage.value.sessionId,
      u: activePage.value.url,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    })

    await applySurface(key, () =>
      syncSurface({
        visible: true,
        sessionId: activePage.value!.sessionId,
        url: activePage.value!.url,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      }))
  }, 30)
}

// ---------------------------------------------------------------------------
// Navigation handlers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Observers & lifecycle
// ---------------------------------------------------------------------------
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let intersectionObserver: IntersectionObserver | null = null

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

  mutationObserver = new MutationObserver(() => syncNow())
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'aria-modal', 'data-state', 'data-overlay', 'open'],
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
  window.removeEventListener('resize', onWindowResize)

  void syncSurface({ visible: false })
})

watch(activePage, () => {
  updateAddressInput()
  syncNow()
}, { deep: true })

watch(() => owner.value?.isPanelOpen, syncNow)
watch(viewportRef, node => {
  observeViewport(node)
  syncNow()
})

// ── Tailwind Class Extractions ──────────────────────────────────────────────
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

const btnBase = 'inline-flex items-center justify-center h-[28px] border border-transparent rounded-(--radius-md) bg-transparent text-[var(--color-text-dim,#595959)] shrink-0 cursor-pointer transition-[background,color] duration-[120ms] ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent,#00e5ff)]'
const newTabClasses = `${btnBase} w-[28px] ml-[2px] mb-[4px] hover:bg-[var(--color-state-hover,#1c1c1c)] hover:text-[var(--color-text-primary,#f2f2f2)]`
const toolbarBtnClasses = `${btnBase} w-[32px] disabled:opacity-30 disabled:cursor-not-allowed hover:not(:disabled):bg-[var(--color-state-hover,#1c1c1c)] hover:not(:disabled):text-[var(--color-text-primary,#f2f2f2)]`

const toolbarClasses = 'flex items-center gap-1.5 py-2 px-3 bg-[var(--color-bg-base,#000000)] border-b border-[color-mix(in_srgb,var(--color-border-subtle,#1a1a1a)_40%,transparent)]'
const formClasses = 'flex-1 min-w-0'
const addressShellClasses = 'flex items-center gap-2 h-[34px] px-[14px] border border-[color-mix(in_srgb,var(--color-border-subtle,#1a1a1a)_60%,transparent)] rounded-(--radius-lg) bg-[color-mix(in_srgb,var(--color-bg-surface,#0a0a0a)_50%,transparent)] transition-[border-color,background,box-shadow] duration-150 ease focus-within:border-[color-mix(in_srgb,var(--color-accent,#00e5ff)_80%,transparent)] focus-within:bg-[var(--color-bg-surface,#0a0a0a)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent,#00e5ff)_15%,transparent)]'

const addressIconClasses = 'text-[var(--color-text-dim,#595959)] shrink-0'
const addressSpinnerClasses = 'text-[var(--color-accent,#00e5ff)] shrink-0 animate-spin'
const addressInputClasses = 'flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--color-text-primary,#f2f2f2)] text-[13px] tracking-[0.01em] placeholder:text-[color-mix(in_srgb,var(--color-text-dim,#595959)_70%,transparent)] placeholder:text-[12.5px]'

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
    <!-- Tab Strip -->
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

    <!-- Navigation & Address Bar -->
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
    </div>

    <!-- Webview Stage -->
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

      <!-- User-visible errors only (internal lifecycle errors are filtered out) -->
      <div v-if="displayError" :class="errorWrapClasses">
        <AlertTriangle :size="14" :stroke-width="2" :class="errorIconClasses" />
        <span>{{ displayError }}</span>
      </div>
    </div>
  </div>
</template>
