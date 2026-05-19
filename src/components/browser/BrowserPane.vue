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
// and viewportRef is null (the "Embedded browser ready" idle state).
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
</script>

<template>
  <div ref="rootRef" class="browser-root">
    <!-- Tab Strip -->
    <div class="browser-tabs" role="tablist">
      <button
        v-for="page in pages"
        :key="page.id"
        role="tab"
        :aria-selected="page.id === owner?.activePageId"
        :title="page.title"
        class="browser-tab"
        :class="{ 'browser-tab--active': page.id === owner?.activePageId }"
        @click="switchPage(page.id)"
        @auxclick.middle="handleTabAuxClick($event, page.id)"
      >
        <span class="browser-tab-favicon">
          <template v-if="getFaviconUrl(page.url)">
            <img
              :src="getFaviconUrl(page.url)!"
              class="browser-tab-favicon-img"
              :class="{ 'browser-tab-favicon-img--loading': page.status === 'mounting' || page.status === 'loading' }"
              alt=""
              width="14"
              height="14"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            >
          </template>
          <Globe v-else :size="13" :stroke-width="1.8" class="browser-tab-favicon-globe" />
        </span>
        <span class="browser-tab-title">{{ page.title || 'New Tab' }}</span>
        <span
          class="browser-tab-close"
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
        class="browser-tab-new"
        title="Open new tab"
        aria-label="New browser tab"
        @click="openNewPage"
      >
        <Plus :size="14" :stroke-width="2" />
      </button>
    </div>

    <!-- Navigation & Address Bar -->
    <div class="browser-toolbar">
      <button class="toolbar-btn" :disabled="!canGoBack" title="Click to go back" aria-label="Back" @click="goBack">
        <ChevronLeft :size="16" :stroke-width="2.25" />
      </button>
      <button class="toolbar-btn" :disabled="!canGoForward" title="Click to go forward" aria-label="Forward" @click="goForward">
        <ChevronRight :size="16" :stroke-width="2.25" />
      </button>
      <button class="toolbar-btn" :disabled="!activePage?.url" title="Reload page" aria-label="Reload" @click="reloadPage">
        <RefreshCw :size="14" :stroke-width="2.25" />
      </button>

      <form class="address-form" @submit.prevent="submitAddress">
        <div class="address-shell" :class="{ 'address-shell--loading': activePage?.status === 'loading' }">
          <Globe class="address-icon" :size="13" :stroke-width="2" />
          <input
            v-model="addressInput"
            class="address-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="Search or type a URL"
            @focus="selectAllText"
            @blur="onAddressBlur"
          >
          <Loader2
            v-if="activePage && (activePage.status === 'mounting' || activePage.status === 'loading')"
            class="address-spinner"
            :size="13"
            :stroke-width="2"
          />
        </div>
      </form>
    </div>

    <!-- Webview Stage -->
    <div class="browser-stage">
      <div v-if="!activePage || !activePage.url" class="browser-empty">
        <div class="browser-empty-mark">
          <Globe :size="24" :stroke-width="1.8" />
        </div>
        <p class="browser-empty-title">
          Embedded browser ready
        </p>
        <p class="browser-empty-copy">
          Use the address bar or the browser tools to open a page in this chat tab.
        </p>
      </div>

      <div v-else ref="viewportRef" class="browser-viewport" />

      <!-- Loading overlay — prevents the white stage flash while Tauri surface mounts -->
      <Transition name="browser-loading">
        <div
          v-if="activePage && (activePage.status === 'mounting' || activePage.status === 'loading')"
          class="browser-loading-overlay"
        >
          <Loader2 :size="22" :stroke-width="1.8" class="browser-loading-spinner" />
        </div>
      </Transition>

      <!-- User-visible errors only (internal lifecycle errors are filtered out) -->
      <div v-if="displayError" class="browser-error">
        <AlertTriangle :size="14" :stroke-width="2" class="browser-error-icon" />
        <span>{{ displayError }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-bg-base, #000000);
  color: var(--color-text-primary, #f2f2f2);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

/* ── Tab Strip ─────────────────────────────────────────────── */
.browser-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 10px;
  background: color-mix(in srgb, var(--color-bg-base, #000000) 80%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle, #1a1a1a) 40%, transparent);
  overflow-x: auto;
  scrollbar-width: none;
}
.browser-tabs::-webkit-scrollbar {
  display: none;
}

.browser-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 80px;
  max-width: 220px;
  height: 30px;
  padding: 0 8px 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text-dim, #595959);
  cursor: pointer;
  user-select: none;
  transition:
    background 150ms ease,
    color 150ms ease,
    border-color 150ms ease;
}

.browser-tab:hover:not(.browser-tab--active) {
  background: color-mix(in srgb, var(--color-bg-surface, #0a0a0a) 50%, transparent);
  color: var(--color-text-secondary, #cccccc);
}

.browser-tab--active {
  background: var(--color-bg-surface, #0a0a0a);
  color: var(--color-text-primary, #f2f2f2);
  border-color: color-mix(in srgb, var(--color-border-subtle, #1a1a1a) 60%, transparent);
  box-shadow: var(--color-shadow-sm);
}

.browser-tab:focus-visible {
  outline: 2px solid var(--color-accent, #00e5ff);
  outline-offset: -1px;
}

.browser-tab-favicon {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  order: -1;
}

.browser-tab-favicon-img {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-xs);
  object-fit: contain;
  transition: opacity 150ms ease;
}

.browser-tab-favicon-img--loading {
  opacity: 0.4;
  filter: grayscale(1);
}

.browser-tab-favicon-globe {
  color: inherit;
  opacity: 0.7;
}

.browser-tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}

.browser-tab-close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  color: transparent;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
  outline: none;
}

.browser-tab:hover .browser-tab-close,
.browser-tab--active .browser-tab-close {
  color: var(--color-text-dim, #595959);
}

.browser-tab-close:hover,
.browser-tab-close:focus-visible {
  background: color-mix(in srgb, var(--color-danger, #ef4444) 15%, transparent);
  color: var(--color-danger, #ef4444) !important;
}

/* ── New-tab + Toolbar buttons ──────────────────────────────── */
.browser-tab-new,
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-dim, #595959);
  flex-shrink: 0;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.browser-tab-new {
  width: 28px;
  margin-left: 2px;
}

.browser-tab-new:hover,
.toolbar-btn:hover:not(:disabled) {
  background: var(--color-state-hover, #1c1c1c);
  color: var(--color-text-primary, #f2f2f2);
}

.browser-tab-new:focus-visible,
.toolbar-btn:focus-visible {
  outline: 2px solid var(--color-accent, #00e5ff);
}

.toolbar-btn {
  width: 32px;
}

.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Toolbar + Address Bar ──────────────────────────────────── */
.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-bg-base, #000000);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle, #1a1a1a) 40%, transparent);
}

.address-form {
  flex: 1;
  min-width: 0;
}

.address-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--color-border-subtle, #1a1a1a) 60%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-bg-surface, #0a0a0a) 50%, transparent);
  transition:
    border-color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease;
}

.address-shell:focus-within {
  border-color: color-mix(in srgb, var(--color-accent, #00e5ff) 80%, transparent);
  background: var(--color-bg-surface, #0a0a0a);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent, #00e5ff) 15%, transparent);
}

.address-icon,
.address-spinner {
  color: var(--color-text-dim, #595959);
  flex-shrink: 0;
}

.address-spinner {
  animation: spin 1s linear infinite;
  color: var(--color-accent, #00e5ff);
}

.address-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary, #f2f2f2);
  font-size: 13px;
  letter-spacing: 0.01em;
}

.address-input::placeholder {
  color: color-mix(in srgb, var(--color-text-dim, #595959) 70%, transparent);
  font-size: 12.5px;
}

/* ── Browser Stage & Empty States ────────────────────────────── */
.browser-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--color-bg-base, #000000);
}

.browser-viewport {
  position: absolute;
  inset: 0;
  z-index: 10;
}

.browser-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  text-align: center;
  background: var(--color-bg-base, #000000);
}

.browser-empty-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-accent, #00e5ff) 15%, transparent);
  color: var(--color-accent, #00e5ff);
}

.browser-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary, #f2f2f2);
  margin: 0;
}

.browser-empty-copy {
  max-width: 280px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-dim, #595959);
  margin: 0;
}

.browser-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-base, #000000);
  pointer-events: none;
}

.browser-loading-spinner {
  color: var(--color-text-dim, #595959);
  animation: spin 1s linear infinite;
}

.browser-loading-enter-active {
  transition: opacity 200ms ease;
}
.browser-loading-enter-from {
  opacity: 0;
}

.browser-error {
  position: absolute;
  z-index: 20;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: min(420px, calc(100% - 32px));
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--color-danger, #ef4444) 40%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-danger, #ef4444) 12%, var(--color-bg-base, #000000));
  color: var(--color-danger-text, #fca5a5);
  font-size: 13px;
  line-height: 1.5;
  box-shadow: var(--color-shadow-md);
}

.browser-error-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
