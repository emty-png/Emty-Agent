<script setup lang="ts">
import type { DesignManifest, DesignProjectType } from '@/stores/chat/core/types'
import type { DesignConsoleEntry, DesignConsoleLevel } from '@/utils/tools/designProject'
import { join } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { exists, readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import {
  ChevronUp,
  Code2,
  Download,
  Expand,
  LayoutGrid,
  Loader2,
  MessageSquarePlus,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Shrink,
  Trash2,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppView } from '@/composables/ui/useAppView'
import { useIllustrationComponent } from '@/composables/ui/useIllustration'
import { useChatStore } from '@/stores/chat'
import { createBrowserElementAttachment, isBrowserElementAttachment, parseBrowserElementAttachment } from '@/stores/chat/core/attachmentTypes'
import { useProjectStore } from '@/stores/project'
import { useThemeStore } from '@/stores/themes'
import { VIEWPORT_PRESETS } from '@/utils/tools/design/constants'
import {
  clearConsoleBuffer,
  DESIGN_FILES,
  DESIGN_PICKER_HOST_SOURCE,
  DESIGN_PICKER_SOURCE,
  DESIGN_SCREENSHOT_HOST_SOURCE,
  DESIGN_SCREENSHOT_SOURCE,
  injectConsoleBootstrap,
  injectPickerBootstrap,
  injectScreenshotBootstrap,
  pushConsoleEntries,
  readDesignManifest,
} from '@/utils/tools/designProject'
import { createZip, sanitizeFilename } from '@/utils/zip'

const props = defineProps<{
  projectVersion: number
  activeProject?: { path: string; name: string; type: DesignProjectType } | null
  activeDesign?: { path: string; name: string } | null
  designManifest?: DesignManifest | null
  designScreens?: Array<{ name: string; path: string }> | null
  tabId?: string | null
  isFullscreen?: boolean
  previewVersionId?: string | null
}>()

const emit = defineEmits<{
  toggleFullscreen: []
}>()

// ── Resolve effective design ───────────────────────────────────────────────

const effectiveDesign = computed(() => {
  if (props.activeDesign)
    return props.activeDesign
  if (props.activeProject)
    return { path: props.activeProject.path, name: props.activeProject.name }
  return null
})

// Screens list derived from manifest or props or fallback to legacy
const effectiveScreens = computed<string[]>(() => {
  if (props.designScreens && props.designScreens.length > 0)
    return props.designScreens.map(s => s.name)
  if (props.designManifest?.screens && props.designManifest.screens.length > 0)
    return props.designManifest.screens
  // Legacy fallback: if we have an activeDesign but no manifest, try to treat as single legacy screen
  // The parent DesignView will have loaded manifest; if empty we show empty state
  if (effectiveDesign.value && props.activeProject) {
    // legacy single-project is not multi-screen; we represent as ["__legacy__"] internally handled separately
    return []
  }
  return []
})

const connections = computed(() => props.designManifest?.connections ?? [])

const screenViewports = computed<Record<string, Viewport>>(() => {
  const map: Record<string, Viewport> = {}
  const raw = (props.designManifest as unknown as { viewports?: Record<string, Viewport> })?.viewports
  if (raw) {
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.width === 'number' && typeof v.height === 'number' && v.preset in VIEWPORT_PRESETS)
        map[k] = v
    }
  }
  return map
})

function getVp(screen: string): Viewport {
  const vp = screenViewports.value[screen]
  if (vp)
    return vp
  const preset = VIEWPORT_PRESETS.mobile
  return { width: preset.width, height: preset.height, preset: 'mobile' }
}

const hasMultiScreen = computed(() => effectiveScreens.value.length > 0)
const isLegacySingle = computed(() => !hasMultiScreen.value && !!props.activeProject)

// ── Zoom & pan (shared for grid) ───────────────────────────────────────────

const canvasRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)

const MIN_SCALE = 0.05
const MAX_SCALE = 4
const ZOOM_FACTOR = 1.2
const WHEEL_ZOOM_SENSITIVITY = 0.0022
const SCALE_SNAP_TOLERANCE = 0.03
const PAN_EDGE_MARGIN = 80
const FIT_PADDING = 48

// Grid layout constants — defaults (per-screen via viewports override)
const DEFAULT_SCREEN_W = 390
const DEFAULT_SCREEN_H = 844
const GRID_GAP = 64

interface Viewport { width: number; height: number; preset: keyof typeof VIEWPORT_PRESETS }

const zoomPercent = computed(() => Math.round(scale.value * 100))

function clampScale(v: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

function setZoom(next: number, originX?: number, originY?: number) {
  const el = canvasRef.value
  const rect = el?.getBoundingClientRect()
  const cx = originX ?? (rect ? rect.width / 2 : 0)
  const cy = originY ?? (rect ? rect.height / 2 : 0)

  let nextScale = clampScale(next)
  if (Math.abs(nextScale - 1) < SCALE_SNAP_TOLERANCE)
    nextScale = 1

  const prevScale = scale.value
  if (nextScale === prevScale)
    return
  const ratio = nextScale / prevScale

  panX.value = cx + (panX.value - cx) * ratio
  panY.value = cy + (panY.value - cy) * ratio
  scale.value = nextScale
  clampPan()
}

function zoomIn() { setZoom(scale.value * ZOOM_FACTOR) }
function zoomOut() { setZoom(scale.value / ZOOM_FACTOR) }

function getMaxCellSize(): { maxW: number; maxH: number } {
  if (!hasMultiScreen.value)
    return { maxW: DEFAULT_SCREEN_W, maxH: DEFAULT_SCREEN_H }
  let maxW = DEFAULT_SCREEN_W
  let maxH = DEFAULT_SCREEN_H
  for (const s of effectiveScreens.value) {
    const vp = getVp(s)
    if (vp.width > maxW)
      maxW = vp.width
    if (vp.height > maxH)
      maxH = vp.height
  }
  return { maxW, maxH }
}

function computeGridMetrics() {
  const count = hasMultiScreen.value ? effectiveScreens.value.length : isLegacySingle.value ? 1 : 0
  if (count === 0)
    return { cols: 0, rows: 0, gridW: 0, gridH: 0, maxW: DEFAULT_SCREEN_W, maxH: DEFAULT_SCREEN_H, count }
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const { maxW, maxH } = getMaxCellSize()
  const gridW = cols * maxW + (cols - 1) * GRID_GAP
  const gridH = rows * maxH + (rows - 1) * GRID_GAP
  return { cols, rows, gridW, gridH, maxW, maxH, count }
}

function fitToCanvas() {
  const el = canvasRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const { cols, rows, gridW, gridH, count } = computeGridMetrics()
  if (count === 0) {
    scale.value = 1
    panX.value = rect.width / 2
    panY.value = rect.height / 2
    return
  }
  void cols; void rows
  const scaleX = (rect.width - FIT_PADDING * 2) / gridW
  const scaleY = (rect.height - FIT_PADDING * 2) / gridH
  const fit = clampScale(Math.min(scaleX, scaleY, 1))
  scale.value = fit
  panX.value = rect.width / 2
  panY.value = rect.height / 2
}

function clampPan() {
  const el = canvasRef.value
  if (!el)
    return
  const { width, height } = el.getBoundingClientRect()
  const { gridW, gridH } = computeGridMetrics()
  const halfW = (gridW * scale.value) / 2
  const halfH = (gridH * scale.value) / 2
  panX.value = Math.min(Math.max(panX.value, PAN_EDGE_MARGIN - halfW), width - PAN_EDGE_MARGIN + halfW)
  panY.value = Math.min(Math.max(panY.value, PAN_EDGE_MARGIN - halfH), height - PAN_EDGE_MARGIN + halfH)
}

function panBy(dx: number, dy: number) {
  panX.value += dx
  panY.value += dy
  clampPan()
}

// ── Annotation picker & Export state (must be defined before use in handlers) ─
const isPicking = ref(false)
const chatStore = useChatStore()
const exportOpen = ref(false)
const exportName = ref('')
const exporting = ref(false)
const exportError = ref<string | null>(null)
const exportSuccess = ref<string | null>(null)
let exportSuccessTimer: ReturnType<typeof setTimeout> | null = null
const exportInputRef = ref<HTMLInputElement | null>(null)

// ── Screenshot capture bridge ────────────────────────────────────────────────
const screenshotWaiters = new Map<string, { resolve: (v: { dataUrl: string; width: number; height: number; viewport: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function makeScreenshotId(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── Multi-screen srcdoc management (declared early to satisfy no-use-before-define) ──

const iframeKey = ref(0)
const iframeRefs = ref<Record<string, HTMLIFrameElement | null>>({})
const srcdocs = ref<Record<string, string>>({})
const screenLoadErrors = ref<Record<string, string>>({})

function setIframeRef(screen: string, el: unknown) {
  iframeRefs.value[screen] = el as HTMLIFrameElement | null
}

async function waitForIframeMounted(screen: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const f = iframeRefs.value[screen]
    if (f?.contentWindow && f.contentDocument?.readyState === 'complete')
      return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
}

// ── Lazy mounting + screen nav + console state (declared early) ──────────────

const mountedScreens = ref<Set<string>>(new Set())
const screenWrapRefs = ref<Record<string, HTMLElement | null>>({})
let screenObserver: IntersectionObserver | null = null

const screenListOpen = ref(false)
const highlightScreenName = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

const canvasRootRef = ref<HTMLElement | null>(null)
const consoleSearch = ref('')
const consoleDragging = ref(false)
const consoleHeight = ref(240)
try {
  const storedH = Number(localStorage.getItem('emty.designConsoleHeight'))
  if (Number.isFinite(storedH) && storedH >= 120 && storedH <= 1200)
    consoleHeight.value = Math.round(storedH)
}
catch {}

function setScreenWrapRef(screen: string, el: unknown) {
  screenWrapRefs.value[screen] = el as HTMLElement | null
}

onMounted(() => {
  fitToCanvas()
})

watch(() => [hasMultiScreen.value, isLegacySingle.value, effectiveDesign.value?.path, effectiveScreens.value.join('|'), JSON.stringify(screenViewports.value)], () => {
  fitToCanvas()
}, { deep: true })

watch(() => props.isFullscreen, () => {
  nextTick(() => fitToCanvas())
})

function onWheel(e: WheelEvent) {
  if (isPicking.value) {
    e.preventDefault()
    return
  }
  e.preventDefault()
  const el = canvasRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  let dx = e.deltaX
  let dy = e.deltaY
  if (e.deltaMode === 1) {
    dx *= 16
    dy *= 16
  }
  else if (e.deltaMode === 2) {
    dx *= rect.width
    dy *= rect.height
  }
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)
    setZoom(scale.value * factor, e.clientX - rect.left, e.clientY - rect.top)
    return
  }
  if (e.shiftKey && dx === 0) {
    dx = dy
    dy = 0
  }
  panBy(-dx, -dy)
}

const isPanning = ref(false)
const spaceDown = ref(false)
let lastPanX = 0
let lastPanY = 0
const activePointers = new Map<number, { x: number; y: number }>()
let pinchDist = 0
let pinchMidX = 0
let pinchMidY = 0
let resizeObserver: ResizeObserver | null = null

function isEditableTarget(e: Event) {
  const target = e.target as HTMLElement | null
  if (!target)
    return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function onDocPointerDown(e: Event) {
  if (!screenListOpen.value)
    return
  const target = e.target as HTMLElement | null
  if (target?.closest('.dc-screen-list') || target?.closest('.dc-screen-list-anchor'))
    return
  screenListOpen.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (exportOpen.value && e.key === 'Escape') {
    e.preventDefault()
    closeExportModal()
    return
  }
  if (isPicking.value && e.key === 'Escape') {
    e.preventDefault()
    stopPicker()
    return
  }
  if (screenListOpen.value && e.key === 'Escape') {
    e.preventDefault()
    screenListOpen.value = false
    return
  }
  if (props.isFullscreen && e.key === 'Escape') {
    e.preventDefault()
    emit('toggleFullscreen')
    return
  }
  if (isEditableTarget(e))
    return
  if (isPicking.value || exportOpen.value)
    return
  if (e.code === 'Space' && !e.repeat) {
    spaceDown.value = true
    e.preventDefault()
  }
  else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    zoomIn()
  }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault()
    zoomOut()
  }
  else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault()
    fitToCanvas()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceDown.value = false
    isPanning.value = false
  }
}

function updatePinchState() {
  const pts = Array.from(activePointers.values())
  const a = pts[0]
  const b = pts[1]
  if (!a || !b)
    return
  pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
  pinchMidX = (a.x + b.x) / 2
  pinchMidY = (a.y + b.y) / 2
}

function onPointerDown(e: PointerEvent) {
  if (isPicking.value)
    return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePointers.size >= 2) {
    isPanning.value = false
    updatePinchState()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    return
  }
  if (e.button === 1 || spaceDown.value) {
    e.preventDefault()
    isPanning.value = true
    lastPanX = e.clientX
    lastPanY = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e: PointerEvent) {
  if (isPicking.value)
    return
  if (!activePointers.has(e.pointerId))
    return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePointers.size >= 2) {
    const el = canvasRef.value
    if (!el)
      return
    const prevDist = pinchDist
    const prevMidX = pinchMidX
    const prevMidY = pinchMidY
    updatePinchState()
    const rect = el.getBoundingClientRect()
    const originX = pinchMidX - rect.left
    const originY = pinchMidY - rect.top
    if (prevDist > 0 && pinchDist !== prevDist)
      setZoom(scale.value * (pinchDist / prevDist), originX, originY)
    panBy(pinchMidX - prevMidX, pinchMidY - prevMidY)
    return
  }
  if (!isPanning.value)
    return
  panBy(e.clientX - lastPanX, e.clientY - lastPanY)
  lastPanX = e.clientX
  lastPanY = e.clientY
}

function onPointerUp(e: PointerEvent) {
  activePointers.delete(e.pointerId)
  if (activePointers.size === 1) {
    const p = Array.from(activePointers.values())[0]
    if (p) {
      isPanning.value = true
      lastPanX = p.x
      lastPanY = p.y
    }
  }
  else if (activePointers.size === 0) {
    isPanning.value = false
    pinchDist = 0
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('message', onWindowMessage)
  window.addEventListener('pointerdown', onDocPointerDown)
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(() => clampPan())
    resizeObserver.observe(canvasRef.value)
  }
  if (canvasRef.value && typeof IntersectionObserver !== 'undefined') {
    screenObserver = new IntersectionObserver(obsEntries => {
      const next = new Set(mountedScreens.value)
      let changed = false
      for (const oe of obsEntries) {
        const screen = (oe.target as HTMLElement).dataset.screen
        if (!screen)
          continue
        if (oe.isIntersecting && !next.has(screen)) {
          next.add(screen)
          changed = true
        }
      }
      if (changed)
        mountedScreens.value = next
    }, { root: canvasRef.value, rootMargin: '400px' })
  }
  // Expose global capture bridge for screenshot_screen tool
  // Tries modern-screenshot first (higher fidelity, handles CORS), falls back to iframe foreignObject bootstrap
  ;(window as unknown as Record<string, unknown>).__EMTY_DESIGN_SCREENSHOT_CAPTURE__ = async (design: string, screen: string) => {
    const ed = effectiveDesign.value
    if (!ed || ed.name !== design)
      throw new Error(`Active design is "${ed?.name ?? 'none'}", not "${design}" — open the correct design first.`)
    // Lazy-mount fallback: force the target screen's iframe into the DOM and wait for it
    if (!iframeRefs.value[screen]) {
      const next = new Set(mountedScreens.value)
      next.add(screen)
      mountedScreens.value = next
      await waitForIframeMounted(screen)
    }
    const frame = iframeRefs.value[screen] ?? (screen === '__legacy__' ? iframeRefs.value.__legacy__ : null)
    if (!frame?.contentWindow)
      throw new Error(`Screen "${screen}" preview not ready — ensure DesignCanvas is visible and screen exists.`)
    const vp = getVp(screen)
    const width = vp.width
    const height = vp.height
    const viewportLabel = width >= 1440 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile'
    // ── Attempt 1: modern-screenshot on iframe document (handles external images via fetch, no taint) ──
    const doc = frame.contentDocument
    if (doc?.documentElement) {
      try {
        const { domToPng } = await import('modern-screenshot')
        // Hide picker markers inside iframe to avoid capturing UI chrome
        const pickerInFrame = doc.getElementById('__emty_design_picker__') as HTMLElement | null
        const prevDisplay = pickerInFrame?.style.display
        if (pickerInFrame)
          pickerInFrame.style.display = 'none'
        try {
          const dataUrl = await Promise.race([
            domToPng(doc.documentElement as unknown as HTMLElement, {
              scale: 1,
              width,
              height,
              backgroundColor: '#ffffff',
              timeout: 8000,
              fetch: { requestInit: { cache: 'force-cache' } as RequestInit, placeholderImage: 'data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
              filter: (node: Node) => {
                if (node instanceof Element) {
                  const id = (node as HTMLElement).id
                  if (id === '__emty_design_picker__' || id === '__emty_agent_browser_picker__')
                    return false
                }
                return true
              },
            } as unknown as Record<string, unknown>),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('modern-screenshot timeout')), 9000)),
          ]) as string
          if (pickerInFrame)
            pickerInFrame.style.display = prevDisplay ?? ''
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png')) {
            console.warn(`[DesignCanvas] modern-screenshot succeeded ${screen} ${width}x${height}`)
            return { dataUrl, width, height, viewport: viewportLabel }
          }
        }
        catch (innerErr) {
          if (pickerInFrame)
            pickerInFrame.style.display = prevDisplay ?? ''
          throw innerErr
        }
      }
      catch (e) {
        console.warn('[DesignCanvas] modern-screenshot failed, falling back to foreignObject', e)
        // fall through to postMessage fallback
      }
    }
    // ── Attempt 2: fallback to iframe bootstrap foreignObject (sanitized, never taints) ──
    const requestId = makeScreenshotId()
    return await new Promise<{ dataUrl: string; width: number; height: number; viewport: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        screenshotWaiters.delete(requestId)
        reject(new Error('Screenshot capture timed out after 15s'))
      }, 15_000)
      screenshotWaiters.set(requestId, { resolve, reject, timer })
      try {
        frame.contentWindow!.postMessage({ source: DESIGN_SCREENSHOT_HOST_SOURCE, action: 'capture', requestId, width, height }, '*')
      }
      catch (e) {
        clearTimeout(timer)
        screenshotWaiters.delete(requestId)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('message', onWindowMessage)
  window.removeEventListener('pointerdown', onDocPointerDown)
  resizeObserver?.disconnect()
  resizeObserver = null
  screenObserver?.disconnect()
  screenObserver = null
  if (highlightTimer) {
    clearTimeout(highlightTimer)
    highlightTimer = null
  }
  if (exportSuccessTimer) {
    clearTimeout(exportSuccessTimer)
    exportSuccessTimer = null
  }
  try { delete (window as unknown as Record<string, unknown>).__EMTY_DESIGN_SCREENSHOT_CAPTURE__ }
  catch {}
  for (const [, w] of screenshotWaiters) {
    clearTimeout(w.timer)
    try { w.reject(new Error('DesignCanvas unmounted')) }
    catch {}
  }
  screenshotWaiters.clear()
})

function draftAnnotations() {
  const tabId = props.tabId
  if (!tabId)
    return []
  const tab = chatStore.tabs.find(t => t.id === tabId)
  if (!tab)
    return []
  const raw = tab.draft.attachments
    .filter(isBrowserElementAttachment)
    .map(att => parseBrowserElementAttachment(att))
    .filter((data): data is NonNullable<ReturnType<typeof parseBrowserElementAttachment>> => data != null)
  try {
    return JSON.parse(JSON.stringify(raw)) as typeof raw
  }
  catch {
    return raw
  }
}

function sendPickerCommandToAll(action: 'startPicker' | 'stopPicker' | 'setAnnotations', payload?: Record<string, unknown>) {
  for (const screen of effectiveScreens.value) {
    const frame = iframeRefs.value[screen]
    const win = frame?.contentWindow
    if (!win)
      continue
    try {
      const msg = JSON.parse(JSON.stringify({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }))
      win.postMessage(msg, '*')
    }
    catch {
      try { win.postMessage({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }, '*') }
      catch {}
    }
  }
  // Also legacy single
  if (isLegacySingle.value) {
    const frame = iframeRefs.value.__legacy__
    const win = frame?.contentWindow
    if (win) {
      try {
        const msg = JSON.parse(JSON.stringify({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }))
        win.postMessage(msg, '*')
      }
      catch {
        try { win.postMessage({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }, '*') }
        catch {}
      }
    }
  }
}

function syncAnnotationsToIframe() {
  const annotations = draftAnnotations()
  for (const screen of effectiveScreens.value) {
    const frame = iframeRefs.value[screen]
    if (!frame?.contentWindow)
      continue
    try {
      const msg = JSON.parse(JSON.stringify({ source: DESIGN_PICKER_HOST_SOURCE, action: 'setAnnotations', annotations }))
      frame.contentWindow.postMessage(msg, '*')
    }
    catch {
      try { frame.contentWindow.postMessage({ source: DESIGN_PICKER_HOST_SOURCE, action: 'setAnnotations', annotations }, '*') }
      catch {}
    }
  }
  if (isLegacySingle.value) {
    const frame = iframeRefs.value.__legacy__
    if (frame?.contentWindow) {
      try {
        const msg = JSON.parse(JSON.stringify({ source: DESIGN_PICKER_HOST_SOURCE, action: 'setAnnotations', annotations }))
        frame.contentWindow.postMessage(msg, '*')
      }
      catch {}
    }
  }
}

function mountAllScreens() {
  const names = hasMultiScreen.value
    ? effectiveScreens.value
    : isLegacySingle.value ? ['__legacy__'] : []
  if (names.length === 0)
    return
  const next = new Set(mountedScreens.value)
  let changed = false
  for (const s of names) {
    if (!next.has(s)) {
      next.add(s)
      changed = true
    }
  }
  if (changed)
    mountedScreens.value = next
}

function startPicker() {
  if (!effectiveDesign.value)
    return
  // Force-mount every screen so each one is annotatable
  mountAllScreens()
  isPicking.value = true
  sendPickerCommandToAll('startPicker')
  syncAnnotationsToIframe()
}

function stopPicker() {
  if (!isPicking.value)
    return
  isPicking.value = false
  sendPickerCommandToAll('stopPicker')
}

function toggleAnnotating() {
  if (isPicking.value)
    stopPicker()
  else startPicker()
}

function openExportModal() {
  const d = effectiveDesign.value
  if (!d)
    return
  exportName.value = d.name
  exportError.value = null
  exportSuccess.value = null
  if (exportSuccessTimer) {
    clearTimeout(exportSuccessTimer)
    exportSuccessTimer = null
  }
  exportOpen.value = true
  nextTick(() => {
    exportInputRef.value?.focus()
    exportInputRef.value?.select()
  })
}

function closeExportModal() {
  if (exporting.value)
    return
  exportOpen.value = false
  exportError.value = null
}

async function confirmExport() {
  const design = effectiveDesign.value
  if (!design || exporting.value)
    return
  const rawName = exportName.value.trim() || design.name
  const safe = sanitizeFilename(rawName)
  const zipName = safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`
  exportError.value = null
  exportSuccess.value = null
  exporting.value = true
  try {
    const dest = await save({
      defaultPath: zipName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      title: 'Export design',
    })
    if (!dest) {
      exporting.value = false
      return
    }
    const finalDest = dest.toLowerCase().endsWith('.zip') ? dest : `${dest}.zip`
    const entries: Array<{ name: string; data: Uint8Array }> = []
    const enc = new TextEncoder()

    if (hasMultiScreen.value) {
      // Export each screen folder + design.json
      try {
        const manifestPath = await join(design.path, 'design.json')
        if (await exists(manifestPath)) {
          const mContent = await readTextFile(manifestPath)
          entries.push({ name: 'design.json', data: enc.encode(mContent) })
        }
      }
      catch {}
      for (const screen of effectiveScreens.value) {
        for (const fileName of DESIGN_FILES) {
          try {
            const fullPath = await join(design.path, screen, fileName)
            const content = await readTextFile(fullPath)
            entries.push({ name: `${screen}/${fileName}`, data: enc.encode(content) })
          }
          catch (e) {
            console.warn(`[DesignCanvas Export] Skip ${screen}/${fileName}:`, e)
          }
        }
      }
    }
    else if (isLegacySingle.value) {
      const project = props.activeProject!
      for (const fileName of DESIGN_FILES) {
        try {
          const fullPath = await join(project.path, fileName)
          const content = await readTextFile(fullPath)
          entries.push({ name: fileName, data: enc.encode(content) })
        }
        catch (e) {
          console.warn(`[DesignCanvas Export] Skip ${fileName}:`, e)
        }
      }
    }

    if (entries.length === 0)
      throw new Error('No design files found to export.')

    const zipBytes = createZip(entries)
    await writeFile(finalDest, zipBytes)
    exportOpen.value = false
  }
  catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    exporting.value = false
  }
}

function onExportKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeExportModal()
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    void confirmExport()
  }
}

function refresh() {
  iframeKey.value++
  if (effectiveDesign.value)
    readAllScreens()
}

// ── Open code in project view ────────────────────────────────────────────────

const projectStore = useProjectStore()
const { setView } = useAppView()

function openInProjectView() {
  const path = effectiveDesign.value?.path
  if (!path)
    return
  projectStore.addProject(path, true)
  setView('projects')
}

async function buildSrcdocForScreen(screen: string, filesOverride?: Record<string, string>): Promise<string> {
  const design = effectiveDesign.value
  if (!design)
    return ''
  let html = ''
  let css: string | undefined
  let js: string | undefined

  if (filesOverride) {
    html = filesOverride['index.html'] ?? ''
    css = filesOverride['styles.css']
    js = filesOverride['script.js']
    if (!html) {
      try { html = await readTextFile(await join(design.path, screen, 'index.html')) }
      catch { html = '<html><body>No snapshot</body></html>' }
    }
  }
  else {
    // live files
    try { html = await readTextFile(await join(design.path, screen, 'index.html')) }
    catch { html = `<html><body style="font-family:system-ui;padding:40px;color:#666;"><h2>Screen "${screen}" empty</h2><p>Create content with edit_design.</p></body></html>` }
    try { css = await readTextFile(await join(design.path, screen, 'styles.css')) }
    catch {}
    try { js = await readTextFile(await join(design.path, screen, 'script.js')) }
    catch {}
  }

  html = injectConsoleBootstrap(html)
  html = injectPickerBootstrap(html)
  html = injectScreenshotBootstrap(html)
  // ── DEBUG (dev builds only) ────────────────────────────────────────────────
  const debugEnabled = import.meta.env.DEV
  function escapeForInlineScript(s: string): string {
    // Escape $ for String.replace replacement semantics, and closing tags to avoid premature closing
    // Split literals to avoid Vite Vue SFC parsing the closing tag
    return s.replaceAll('$', '$$$$').replaceAll('</' + 'script>', '<\\/' + 'script>').replaceAll('</' + 'SCRIPT>', '<\\/' + 'SCRIPT>').replaceAll('<!--', '<\\!--')
  }
  function escapeForInlineStyle(s: string): string {
    return s.replaceAll('$', '$$$$').replaceAll('</' + 'style>', '<\\/' + 'style>').replaceAll('</' + 'STYLE>', '<\\/' + 'STYLE>')
  }
  if (debugEnabled) {
    console.warn(`[DesignCanvas][buildSrcdoc] screen=${screen} html=${html.length} css=${css?.length ?? 'none'} js=${js?.length ?? 'none'} hasLink=${/<link[^>]*styles\.css/i.test(html)} hasScript=${/<script[^>]*script\.js/i.test(html)}`)
  }
  if (css !== undefined) {
    html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${escapeForInlineStyle(css)}</style>`)
  }
  else {
    try {
      const cssLive = filesOverride ? undefined : await readTextFile(await join(design.path, screen, 'styles.css'))
      if (cssLive !== undefined)
        html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${escapeForInlineStyle(cssLive)}</style>`)
    }
    catch {}
  }
  if (js !== undefined) {
    html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${escapeForInlineScript(js)}<\/script>`)
  }
  else {
    try {
      const jsLive = filesOverride ? undefined : await readTextFile(await join(design.path, screen, 'script.js'))
      if (jsLive !== undefined)
        html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${escapeForInlineScript(jsLive)}<\/script>`)
    }
    catch {}
  }
  if (debugEnabled) {
    // Store for post-mortem debugging when SyntaxError occurs
    try {
      const w = window as unknown as Record<string, unknown>
      w.__EMTY_LAST_SRCDOC__ = html
      w.__EMTY_LAST_SCREEN__ = screen
    }
    catch {}
    // Validate that we didn't leave stray src references (would cause double-load)
    if (/<script[^>]*src=["'].*script\.js/i.test(html)) {
      console.error(`[DesignCanvas][buildSrcdoc] screen=${screen} still has <script src> after inline — inline failed. Prev html snippet:`, html.slice(0, 2000))
    }
  }
  return html
}

async function readAllScreens() {
  const design = effectiveDesign.value
  if (!design) {
    srcdocs.value = {}
    return
  }

  // Multi-screen case
  if (hasMultiScreen.value) {
    const next: Record<string, string> = {}
    const errors: Record<string, string> = {}
    for (const screen of effectiveScreens.value) {
      try {
        // If previewing a historical version for this screen, load snapshot
        if (props.previewVersionId) {
          try {
            const { useDesignVersionStore } = await import('@/stores/designVersions')
            const dvStore = useDesignVersionStore()
            const version = dvStore.versionsByConversation[props.previewVersionId ? (chatStore.activeTab.conversationId ?? '') : '']?.find(v => v.id === props.previewVersionId)
              ?? dvStore.getByMessageId(props.previewVersionId ?? '') as unknown as { screenName?: string } | undefined
            // Only use snapshot if it belongs to this screen
            const belongs = !version || (version as { screenName?: string }).screenName === screen || !(version as { screenName?: string }).screenName
            if (belongs && props.previewVersionId) {
              const files = await dvStore.readSnapshotFiles(props.previewVersionId)
              // Check if files look like they belong to this screen — if snapshot has content, use it
              if (Object.keys(files).length > 0) {
                // Heuristic: if previewVersion's screenName doesn't match, skip snapshot for this screen
                const vScreen = (version as unknown as { screenName?: string })?.screenName
                if (!vScreen || vScreen === screen) {
                  next[screen] = await buildSrcdocForScreen(screen, files)
                  continue
                }
              }
            }
          }
          catch (e) {
            console.warn('[DesignCanvas] preview snapshot read failed', e)
          }
        }
        next[screen] = await buildSrcdocForScreen(screen)
      }
      catch (e) {
        errors[screen] = e instanceof Error ? e.message : String(e)
        next[screen] = `<html><body style=\"font-family:system-ui;padding:40px;color:#666;\"><h2>Preview unavailable for ${screen}</h2><p>${errors[screen]}</p></body></html>`
      }
    }
    srcdocs.value = next
    screenLoadErrors.value = errors
    iframeKey.value++
    return
  }

  // Fallback for multi-screen where props haven't hydrated yet but effectiveDesign exists (no activeProject)
  if (effectiveDesign.value && !hasMultiScreen.value && !isLegacySingle.value) {
    try {
      const m = await readDesignManifest(effectiveDesign.value.name)
      if (m && m.screens.length > 0) {
        console.warn(`[DesignCanvas] DEBUG non-legacy fallback manifest screens=${m.screens.join(',')}`)
        const next: Record<string, string> = {}
        const errors: Record<string, string> = {}
        for (const screen of m.screens) {
          try {
            if (props.previewVersionId) {
              try {
                const { useDesignVersionStore } = await import('@/stores/designVersions')
                const dvStore = useDesignVersionStore()
                const version = dvStore.versionsByConversation[props.previewVersionId ? (chatStore.activeTab.conversationId ?? '') : '']?.find(v => v.id === props.previewVersionId) ?? dvStore.getByMessageId(props.previewVersionId ?? '') as unknown as { screenName?: string } | undefined
                const vScreen = (version as unknown as { screenName?: string })?.screenName
                if (!vScreen || vScreen === screen) {
                  const files = await dvStore.readSnapshotFiles(props.previewVersionId!)
                  if (Object.keys(files).length > 0) {
                    next[screen] = await buildSrcdocForScreen(screen, files)
                    continue
                  }
                }
              }
              catch {}
            }
            next[screen] = await buildSrcdocForScreen(screen)
          }
          catch (e) {
            errors[screen] = e instanceof Error ? e.message : String(e)
            next[screen] = `<html><body style=\"font-family:system-ui;padding:40px;color:#666;\"><h2>Preview unavailable for ${screen}</h2><p>${errors[screen]}</p></body></html>`
          }
        }
        if (Object.keys(next).length > 0) {
          srcdocs.value = next
          screenLoadErrors.value = errors
          iframeKey.value++
          return
        }
      }
    }
    catch (e) {
      console.warn('[DesignCanvas] DEBUG non-legacy manifest fallback failed', e)
    }
  }

  // Legacy single project (with fallback for new multi-screen designs where props haven't hydrated yet)
  if (isLegacySingle.value) {
    const project = props.activeProject!
    // DEBUG: check if this is actually a multi-screen design that hasn't hydrated
    try {
      const legacyIdx = await join(project.path, 'index.html')
      const legacyExists = await exists(legacyIdx).catch(() => false)
      console.warn(`[DesignCanvas] DEBUG legacy check path=${legacyIdx} exists=${legacyExists} hasMulti=${hasMultiScreen.value} screens=${effectiveScreens.value.join(',')}`)
      if (!legacyExists) {
        try {
          const m = await readDesignManifest(project.name)
          if (m && m.screens.length > 0) {
            console.warn(`[DesignCanvas] DEBUG fallback to multi-screen manifest screens=${m.screens.join(',')}`)
            const next: Record<string, string> = {}
            const errors: Record<string, string> = {}
            for (const screen of m.screens) {
              try {
                // If previewing a version for this screen, use snapshot
                if (props.previewVersionId) {
                  try {
                    const { useDesignVersionStore } = await import('@/stores/designVersions')
                    const dvStore = useDesignVersionStore()
                    const version = dvStore.versionsByConversation[props.previewVersionId ? (chatStore.activeTab.conversationId ?? '') : '']?.find(v => v.id === props.previewVersionId) ?? dvStore.getByMessageId(props.previewVersionId ?? '') as unknown as { screenName?: string } | undefined
                    const vScreen = (version as unknown as { screenName?: string })?.screenName
                    if (!vScreen || vScreen === screen) {
                      const files = await dvStore.readSnapshotFiles(props.previewVersionId!)
                      if (Object.keys(files).length > 0) {
                        next[screen] = await buildSrcdocForScreen(screen, files)
                        continue
                      }
                    }
                  }
                  catch {}
                }
                next[screen] = await buildSrcdocForScreen(screen)
              }
              catch (e) {
                errors[screen] = e instanceof Error ? e.message : String(e)
                next[screen] = `<html><body style=\"font-family:system-ui;padding:40px;color:#666;\"><h2>Preview unavailable for ${screen}</h2><p>${errors[screen]}</p></body></html>`
              }
            }
            srcdocs.value = next
            screenLoadErrors.value = errors
            iframeKey.value++
            return
          }
        }
        catch (e) {
          console.warn('[DesignCanvas] DEBUG manifest fallback failed', e)
        }
      }
    }
    catch {}
    // If previewing historical version, read from snapshot dir
    if (props.previewVersionId) {
      try {
        const { useDesignVersionStore } = await import('@/stores/designVersions')
        const dvStore = useDesignVersionStore()
        const files = await dvStore.readSnapshotFiles(props.previewVersionId)
        let html = files['index.html'] ?? await readTextFile(await join(project.path, 'index.html'))
        html = injectConsoleBootstrap(html)
        html = injectPickerBootstrap(html)
        const css = files['styles.css']
        if (css !== undefined) {
          html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${css.replaceAll('$', '$$$$')}</style>`)
        }
        else {
          try {
            const cssLive = await readTextFile(await join(project.path, 'styles.css'))
            html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${cssLive.replaceAll('$', '$$$$')}</style>`)
          }
          catch {}
        }
        const js = files['script.js']
        if (js !== undefined) {
          html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${js.replaceAll('$', '$$$$')}<\/script>`)
        }
        else {
          try {
            const jsLive = await readTextFile(await join(project.path, 'script.js'))
            html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${jsLive.replaceAll('$', '$$$$')}<\/script>`)
          }
          catch {}
        }
        srcdocs.value = { __legacy__: html }
        iframeKey.value++
        return
      }
      catch (e) {
        console.warn('[DesignCanvas] preview snapshot read failed, falling back to live', e)
      }
    }

    try {
      let html = await readTextFile(await join(project.path, 'index.html'))
      html = injectConsoleBootstrap(html)
      html = injectPickerBootstrap(html)
      try {
        const css = await readTextFile(await join(project.path, 'styles.css'))
        html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${css.replaceAll('$', '$$$$')}</style>`)
      }
      catch {}
      try {
        const js = await readTextFile(await join(project.path, 'script.js'))
        html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${js.replaceAll('$', '$$$$')}<\/script>`)
      }
      catch {}
      srcdocs.value = { __legacy__: html }
    }
    catch (e) {
      console.error('[DesignCanvas] Failed to read project files:', e)
      srcdocs.value = { __legacy__: `<html><body style="font-family:system-ui;padding:40px;color:#666;"><h2>Preview unavailable</h2><p>Could not read project files: ${e instanceof Error ? e.message : String(e)}</p></body></html>` }
    }
    iframeKey.value++
    return
  }

  // No design
  srcdocs.value = {}
}

watch(
  [() => props.projectVersion, () => effectiveDesign.value?.path, () => props.previewVersionId, () => effectiveScreens.value.join('|')],
  () => {
    if (effectiveDesign.value) {
      readAllScreens()
    }
    else {
      srcdocs.value = {}
    }
  },
  { immediate: true },
)

// ── Console capture ──────────────────────────────────────────────────────────

const MAX_ENTRIES = 500
const entries = ref<DesignConsoleEntry[]>([])
const panelOpen = ref(false)
const unread = ref(0)
const filter = ref<'all' | 'log' | 'warn' | 'error'>('all')
const consoleListRef = ref<HTMLElement | null>(null)

const errorCount = computed(() => entries.value.filter(e => e.level === 'error').length)
const warnCount = computed(() => entries.value.filter(e => e.level === 'warn').length)
const logCount = computed(() => entries.value.length - errorCount.value - warnCount.value)

const filteredEntries = computed(() => {
  let list = entries.value
  if (filter.value === 'log')
    list = list.filter(e => e.level === 'log' || e.level === 'info' || e.level === 'debug')
  else if (filter.value !== 'all')
    list = list.filter(e => e.level === filter.value)
  const q = consoleSearch.value.trim().toLowerCase()
  if (q)
    list = list.filter(e => e.args.join(' ').toLowerCase().includes(q))
  return list
})

const LEVEL_CLASS: Record<DesignConsoleLevel, string> = {
  log: 'dc-log--log',
  info: 'dc-log--info',
  debug: 'dc-log--debug',
  warn: 'dc-log--warn',
  error: 'dc-log--error',
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false })
}

function onWindowMessage(e: MessageEvent) {
  const data = e.data as {
    source?: string
    kind?: string
    annotation?: { id: string; comment: string; element: Record<string, unknown> }
    level?: string
    args?: unknown[]
    timestamp?: number
  } | null
  if (!data || typeof data.source !== 'string')
    return

  // Find which screen iframe sent this
  const allFrames = { ...iframeRefs.value }
  const matchedEntry = Object.entries(allFrames).find(([, frame]) => frame && e.source === frame.contentWindow)
  const isFromDesignFrame = !!matchedEntry
  const screenOfMessage = matchedEntry?.[0] ?? undefined

  // Screenshot capture response
  if (data.source === DESIGN_SCREENSHOT_SOURCE) {
    const ext = e.data as { requestId?: string; ok?: boolean; dataUrl?: string; width?: number; height?: number; viewport?: string; error?: string } | null
    const rid = typeof ext?.requestId === 'string' ? ext.requestId : ''
    if (rid && screenshotWaiters.has(rid)) {
      const waiter = screenshotWaiters.get(rid)!
      screenshotWaiters.delete(rid)
      clearTimeout(waiter.timer)
      if (ext?.ok && typeof ext.dataUrl === 'string' && ext.dataUrl.startsWith('data:image/png')) {
        const w = typeof ext.width === 'number' ? ext.width : 390
        const h = typeof ext.height === 'number' ? ext.height : 844
        const vp = typeof ext.viewport === 'string' ? ext.viewport : (w >= 1440 ? 'desktop' : w >= 768 ? 'tablet' : 'mobile')
        waiter.resolve({ dataUrl: ext.dataUrl, width: w, height: h, viewport: vp })
      }
      else {
        waiter.reject(new Error(typeof ext?.error === 'string' ? ext.error : 'Screenshot failed'))
      }
    }
    return
  }

  if (data.source === DESIGN_PICKER_SOURCE) {
    if (!isFromDesignFrame)
      return
    if (data.kind === 'annotation' && data.annotation) {
      const tabId = props.tabId
      if (!tabId)
        return
      const tab = chatStore.tabs.find(t => t.id === tabId)
      if (!tab)
        return
      try {
        const ann = data.annotation as Record<string, unknown>
        // Enrich annotation with design/screen path
        if (effectiveDesign.value?.path && typeof ann.url === 'string')
          ann.url = effectiveDesign.value.path
        if (screenOfMessage && screenOfMessage !== '__legacy__')
          (ann as Record<string, unknown>).screen = screenOfMessage
        const attachment = createBrowserElementAttachment(ann as never)
        chatStore.updateTabDraft(tabId, {
          attachments: [...tab.draft.attachments, attachment],
        })
        nextTick(() => syncAnnotationsToIframe())
      }
      catch (err) {
        console.warn('[DesignCanvas Picker] Failed to handle annotation:', err)
      }
    }
    return
  }

  if (data.source !== 'emty-design-console')
    return
  if (!isFromDesignFrame)
    return

  const validLevels: DesignConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  const level = validLevels.includes(data.level as DesignConsoleLevel) ? data.level as DesignConsoleLevel : 'log'

  const entry: DesignConsoleEntry = {
    level,
    args: Array.isArray(data.args) ? data.args.map(a => String(a)) : [],
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
  }

  entries.value.push(entry)
  if (entries.value.length > MAX_ENTRIES)
    entries.value.splice(0, entries.value.length - MAX_ENTRIES)

  const designPath = effectiveDesign.value?.path
  if (designPath) {
    // Per-screen buffer
    if (screenOfMessage && screenOfMessage !== '__legacy__') {
      const screenPath = `${designPath}/${screenOfMessage}`.replace(/\/\//g, '/')
      pushConsoleEntries(screenPath, [entry])
      pushConsoleEntries(designPath, [entry])
    }
    else if (isLegacySingle.value && props.activeProject) {
      pushConsoleEntries(props.activeProject.path, [entry])
    }
    else {
      pushConsoleEntries(designPath, [entry])
    }
  }

  if (!panelOpen.value && (level === 'error' || level === 'warn'))
    unread.value++
}

function onIframeLoad(screen: string) {
  nextTick(() => {
    syncAnnotationsToIframe()
    if (isPicking.value)
      sendPickerCommandToAll('startPicker')
    void screen
  })
}

function togglePanel() {
  panelOpen.value = !panelOpen.value
  if (panelOpen.value)
    unread.value = 0
}

function clearLogs() {
  entries.value = []
  unread.value = 0
  const designPath = effectiveDesign.value?.path
  if (designPath) {
    clearConsoleBuffer(designPath)
    if (isLegacySingle.value && props.activeProject)
      clearConsoleBuffer(props.activeProject.path)
    for (const s of effectiveScreens.value) clearConsoleBuffer(`${designPath}/${s}`)
  }
}

watch(() => entries.value.length, async () => {
  await nextTick()
  const el = consoleListRef.value
  if (!el)
    return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (nearBottom)
    el.scrollTop = el.scrollHeight
})

watch(filter, async () => {
  await nextTick()
  const el = consoleListRef.value
  if (el)
    el.scrollTop = el.scrollHeight
})

watch(() => effectiveDesign.value?.path, () => {
  entries.value = []
  unread.value = 0
  if (isPicking.value)
    stopPicker()
  nextTick(() => syncAnnotationsToIframe())
})

watch(
  () => {
    const tabId = props.tabId
    if (!tabId)
      return ''
    const tab = chatStore.tabs.find(t => t.id === tabId)
    return tab?.draft.attachments.map(a => a.id).join('|') ?? ''
  },
  () => { nextTick(() => syncAnnotationsToIframe()) },
)

watch(() => !!effectiveDesign.value, hasProject => {
  if (!hasProject && isPicking.value)
    stopPicker()
})

// ── Grid layout computed ─────────────────────────────────────────────────────

const gridCols = computed(() => {
  const n = hasMultiScreen.value ? effectiveScreens.value.length : isLegacySingle.value ? 1 : 0
  if (n <= 1)
    return 1
  return Math.ceil(Math.sqrt(n))
})

interface GridPos { x: number; y: number; screen: string; w: number; h: number }

const gridPositions = computed<GridPos[]>(() => {
  if (hasMultiScreen.value) {
    const cols = gridCols.value
    const { maxW, maxH } = getMaxCellSize()
    const cellW = maxW + GRID_GAP
    const cellH = maxH + GRID_GAP
    return effectiveScreens.value.map((screen, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const vp = getVp(screen)
      // Center horizontally within max cell, top-align vertically
      const offsetX = (maxW - vp.width) / 2
      const x = col * cellW + offsetX
      const y = row * cellH
      return { screen, x, y, w: vp.width, h: vp.height }
    })
  }
  if (isLegacySingle.value)
    return [{ screen: '__legacy__', x: 0, y: 0, w: DEFAULT_SCREEN_W, h: DEFAULT_SCREEN_H }]
  return []
})

const gridSize = computed(() => {
  if (gridPositions.value.length === 0)
    return { w: 0, h: 0 }
  const { maxW, maxH } = getMaxCellSize()
  const cols = gridCols.value
  const rows = Math.ceil(gridPositions.value.length / cols)
  return {
    w: cols * maxW + (cols - 1) * GRID_GAP,
    h: rows * maxH + (rows - 1) * GRID_GAP,
  }
})

// Connection lines: center-to-center (using actual viewport size)
interface Line { x1: number; y1: number; x2: number; y2: number; key: string; label?: string }
const connectionLines = computed<Line[]>(() => {
  if (!hasMultiScreen.value)
    return []
  const posMap = new Map(gridPositions.value.map(p => [p.screen, p]))
  const out: Line[] = []
  for (const c of connections.value) {
    const from = posMap.get(c.from)
    const to = posMap.get(c.to)
    if (!from || !to)
      continue
    const x1 = from.x + from.w / 2
    const y1 = from.y + from.h / 2
    const x2 = to.x + to.w / 2
    const y2 = to.y + to.h / 2
    out.push({ x1, y1, x2, y2, key: `${c.from}->${c.to}`, ...(c.label ? { label: c.label } : {}) })
  }
  return out
})

const gridContainerStyle = computed(() => ({
  width: `${gridSize.value.w}px`,
  height: `${gridSize.value.h}px`,
  left: `${panX.value}px`,
  top: `${panY.value}px`,
  transform: `translate(-50%, -50%) scale(${scale.value})`,
}))

// Keep legacy frameStyle for single fallback if needed

// ── Screen navigation (zoom-to-screen + list dropdown) ──────────────────────

function highlightScreen(screen: string) {
  highlightScreenName.value = screen
  if (highlightTimer)
    clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightScreenName.value = null
    highlightTimer = null
  }, 1200)
}

function zoomToScreen(screen: string) {
  const el = canvasRef.value
  if (!el)
    return
  const pos = gridPositions.value.find(p => p.screen === screen)
  if (!pos)
    return
  const rect = el.getBoundingClientRect()
  const fit = Math.min(
    (rect.width - FIT_PADDING * 2) / pos.w,
    (rect.height - FIT_PADDING * 2) / pos.h,
  )
  const nextScale = clampScale(Math.min(fit, 1))
  const gridCx = gridSize.value.w / 2
  const gridCy = gridSize.value.h / 2
  panX.value = rect.width / 2 - nextScale * (pos.x + pos.w / 2 - gridCx)
  panY.value = rect.height / 2 - nextScale * (pos.y + pos.h / 2 - gridCy)
  scale.value = nextScale
  clampPan()
  highlightScreen(screen)
}

function toggleScreenList() {
  screenListOpen.value = !screenListOpen.value
}

function pickScreen(screen: string) {
  screenListOpen.value = false
  zoomToScreen(screen)
}

// Mount lazily: observe screen wraps so offscreen frames stay unmounted
watch([gridPositions, () => effectiveDesign.value?.path], async () => {
  await nextTick()
  if (!screenObserver)
    return
  for (const pos of gridPositions.value) {
    const el = screenWrapRefs.value[pos.screen]
    if (el)
      screenObserver.observe(el)
  }
}, { immediate: true })

// ── Console resize ───────────────────────────────────────────────────────────

function onConsoleHandleDown(e: PointerEvent) {
  e.preventDefault()
  consoleDragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onConsoleHandleMove(e: PointerEvent) {
  if (!consoleDragging.value)
    return
  const root = canvasRootRef.value
  if (!root)
    return
  const rect = root.getBoundingClientRect()
  const maxH = Math.max(120, rect.height * 0.6)
  consoleHeight.value = Math.round(Math.min(maxH, Math.max(120, rect.bottom - e.clientY)))
}

function onConsoleHandleUp(e: PointerEvent) {
  if (!consoleDragging.value)
    return
  consoleDragging.value = false
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) }
  catch {}
  try { localStorage.setItem('emty.designConsoleHeight', String(consoleHeight.value)) }
  catch {}
}

// ── Empty-grid CTA ───────────────────────────────────────────────────────────

const theme = useThemeStore()
const { illustrationComponent } = useIllustrationComponent()

const emptyPrompts = [
  'Create the first screen for this design',
  'Create a home screen and a settings screen',
]

function sendEmptyPrompt(prompt: string) {
  const tabId = props.tabId
  if (!tabId)
    return
  const tab = chatStore.tabs.find(t => t.id === tabId)
  if (!tab)
    return
  chatStore.sendMessage(prompt, tab.mode)
}
</script>

<template>
  <div ref="canvasRootRef" class="design-canvas-root" :class="{ 'dc-resizing': consoleDragging }">
    <div class="dc-toolbar">
      <div class="dc-toolbar-group">
        <button class="dc-icon-btn" :disabled="!effectiveDesign" title="Show code" @click="openInProjectView">
          <Code2 :size="14" :stroke-width="1.8" />
        </button>
      </div>

      <div v-if="hasMultiScreen" class="dc-toolbar-group dc-screen-list-anchor">
        <button
          class="dc-icon-btn"
          :class="{ 'dc-icon-btn--active': screenListOpen }"
          :title="`Screens (${effectiveScreens.length})`"
          @click="toggleScreenList"
        >
          <LayoutGrid :size="14" :stroke-width="1.8" />
        </button>
      </div>

      <div class="dc-toolbar-sep" />

      <div class="dc-toolbar-group">
        <button class="dc-icon-btn" title="Zoom out" @click="zoomOut">
          <Minus :size="13" :stroke-width="2" />
        </button>
        <span class="dc-zoom-label">{{ zoomPercent }}%</span>
        <button class="dc-icon-btn" title="Zoom in" @click="zoomIn">
          <Plus :size="13" :stroke-width="2" />
        </button>
        <button class="dc-icon-btn" :title="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="emit('toggleFullscreen')">
          <Shrink v-if="isFullscreen" :size="13" :stroke-width="2" />
          <Expand v-else :size="13" :stroke-width="2" />
        </button>
      </div>

      <div class="dc-toolbar-sep" />

      <button class="dc-icon-btn" title="Refresh preview" @click="refresh">
        <RefreshCw :size="13" :stroke-width="2" />
      </button>

      <div class="dc-toolbar-spacer" />

      <div class="dc-toolbar-group">
        <button
          class="dc-icon-btn"
          :class="{ 'dc-icon-btn--active': isPicking }"
          :disabled="!effectiveDesign"
          title="Annotate element"
          :aria-pressed="isPicking"
          @click="toggleAnnotating"
        >
          <MessageSquarePlus :size="14" :stroke-width="1.8" />
        </button>
        <button class="dc-icon-btn" :disabled="!effectiveDesign" title="Export design as ZIP" @click="openExportModal">
          <Download :size="14" :stroke-width="1.8" />
        </button>
      </div>
    </div>

    <!-- Screen list dropdown -->
    <div v-if="screenListOpen" class="dc-screen-list">
      <button
        v-for="pos in gridPositions"
        :key="pos.screen"
        class="dc-screen-item"
        @click="pickScreen(pos.screen)"
      >
        <span class="dc-screen-item-name">{{ pos.screen }}</span>
        <span v-if="screenLoadErrors[pos.screen]" class="dc-screen-item-err">!</span>
        <span class="dc-screen-item-meta">{{ getVp(pos.screen).width }}×{{ getVp(pos.screen).height }}</span>
      </button>
    </div>

    <div
      ref="canvasRef"
      class="dc-canvas"
      :class="{ 'dc-canvas--panning': isPanning, 'dc-canvas--pan-ready': spaceDown && !isPanning && !isPicking, 'dc-canvas--picking': isPicking }"
      @wheel.passive="false"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="fitToCanvas"
    >
      <Transition name="dc-fade">
        <div v-if="effectiveDesign" class="dc-grid-wrap" :style="gridContainerStyle">
          <!-- Connection lines SVG -->
          <svg
            v-if="connectionLines.length > 0"
            class="dc-connections"
            :width="gridSize.w"
            :height="gridSize.h"
            :viewBox="`0 0 ${gridSize.w} ${gridSize.h}`"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <marker id="dc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
              </marker>
            </defs>
            <g v-for="line in connectionLines" :key="line.key">
              <line :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2" stroke="var(--color-accent)" stroke-width="2" stroke-dasharray="8 6" marker-end="url(#dc-arrow)" opacity="0.9" />
              <circle :cx="line.x1" :cy="line.y1" r="4" fill="var(--color-accent)" stroke="white" stroke-width="1.5" />
              <circle :cx="line.x2" :cy="line.y2" r="4" fill="var(--color-accent)" stroke="white" stroke-width="1.5" />
            </g>
          </svg>

          <!-- Screen frames (lazy-mounted via IntersectionObserver) -->
          <div
            v-for="pos in gridPositions"
            :key="pos.screen"
            :ref="el => setScreenWrapRef(pos.screen, el)"
            :data-screen="pos.screen"
            class="dc-screen-wrap"
            :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.w}px` }"
            @dblclick.stop="zoomToScreen(pos.screen)"
          >
            <div
              class="dc-frame dc-frame--screen"
              :class="{ 'dc-frame--highlight': highlightScreenName === pos.screen }"
              :style="{ width: `${pos.w}px`, height: `${pos.h}px`, borderRadius: pos.w >= 768 ? '12px' : '16px' }"
            >
              <iframe
                v-if="mountedScreens.has(pos.screen)"
                :key="`${iframeKey}-${effectiveDesign.path}-${pos.screen}`"
                :ref="el => setIframeRef(pos.screen, el)"
                class="dc-iframe"
                :class="{ 'dc-iframe--picking': isPicking }"
                :srcdoc="srcdocs[pos.screen] ?? ''"
                sandbox="allow-scripts allow-forms allow-same-origin"
                :title="`Preview ${pos.screen}`"
                @load="onIframeLoad(pos.screen)"
              />
              <div v-else class="dc-frame-skeleton">
                <Loader2 :size="18" class="animate-[spin_0.9s_linear_infinite]" />
              </div>
            </div>
            <!-- per-connection labels -->
            <div v-for="c in connections.filter(x => x.from === pos.screen)" :key="c.to" class="dc-connection-badge">
              → {{ c.to }}<span v-if="c.label"> · {{ c.label }}</span>
            </div>
          </div>

          <div v-if="!hasMultiScreen && !isLegacySingle" class="dc-empty-grid">
            <div class="dc-empty-art">
              <component :is="illustrationComponent" v-if="theme.showLandingArt" />
            </div>
            <p class="dc-empty-grid-title">
              No screens yet
            </p>
            <p class="dc-empty-grid-sub">
              Agent will create screens with <code>create_screen</code> — they appear here in a grid with connections.
            </p>
            <div class="dc-empty-grid-actions">
              <button
                v-for="p in emptyPrompts"
                :key="p"
                class="dc-empty-chip"
                :disabled="!tabId"
                @click="sendEmptyPrompt(p)"
              >
                {{ p }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Export modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom [&_.dc-export-modal]:origin-bottom"
        enter-from-class="opacity-0 [&_.dc-export-modal]:[transform:translateY(8px)_scale(0.96)]"
        enter-to-class="opacity-100 [&_.dc-export-modal]:[transform:translateY(0)_scale(1)]"
        leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom [&_.dc-export-modal]:origin-bottom"
        leave-from-class="opacity-100 [&_.dc-export-modal]:[transform:translateY(0)_scale(1)]"
        leave-to-class="opacity-0 [&_.dc-export-modal]:[transform:translateY(8px)_scale(0.96)]"
      >
        <div v-if="exportOpen" class="fixed inset-0 z-[99999] bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] flex items-center justify-center p-6" @click.self="closeExportModal">
          <div role="dialog" aria-modal="true" aria-label="Export design" class="dc-export-modal bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-xl) w-full max-w-[420px] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.3)] overflow-hidden [transition:transform_150ms_cubic-bezier(0.16,1,0.3,1)]">
            <div class="flex items-center gap-2.5 py-3.5 px-5 border-b border-(--color-border-subtle)">
              <div class="flex items-center justify-center w-6.5 h-6.5 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shrink-0">
                <Download :size="13" class="text-[var(--color-accent)]" />
              </div>
              <span class="flex-1 text-[14px] font-semibold text-[var(--color-text-primary)] truncate">Export design</span>
              <button class="inline-flex items-center justify-center w-6 h-6 rounded-(--radius-sm) border-none bg-transparent text-[var(--color-text-tertiary)] cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.94] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) shrink-0" :disabled="exporting" @click="closeExportModal">
                <X :size="13" />
              </button>
            </div>
            <div class="flex flex-col gap-3 px-5 py-4">
              <div class="flex flex-col gap-1.5">
                <label for="dc-export-name" class="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--color-text-dim)] select-none">ZIP name</label>
                <div class="flex items-center gap-0 rounded-(--radius-lg) border border-(--color-border-mid) bg-(--color-bg-card) focus-within:border-(--color-accent) focus-within:shadow-[0_0_0_3px_var(--color-accent-muted)] [transition:border-color_150ms,box-shadow_150ms] overflow-hidden">
                  <input
                    id="dc-export-name"
                    ref="exportInputRef"
                    v-model="exportName"
                    name="off"
                    class="flex-1 min-w-0 bg-transparent border-none outline-none py-2.5 px-3.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)]"
                    type="text"
                    placeholder="my-design"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore
                    :disabled="exporting"
                    @keydown="onExportKeydown"
                    @contextmenu.prevent
                  >
                  <span class="shrink-0 pr-3.5 text-[13px] text-[var(--color-text-dim)] select-none">.zip</span>
                </div>
                <p class="text-[11px] text-[var(--color-text-tertiary)] leading-[1.5]">
                  Exports all screens (each screen's index.html, styles.css, script.js) as a ZIP archive.
                </p>
              </div>
              <div v-if="exportError" class="py-2 px-3 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] border border-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] text-[12px] text-[var(--color-danger)] leading-[1.5]">
                {{ exportError }}
              </div>
            </div>
            <div class="flex items-center justify-end gap-2.5 py-3 px-5 bg-(--color-bg-surface) border-t border-(--color-border-mid)">
              <button class="inline-flex items-center justify-center h-8 px-4 rounded-(--radius-md) text-[12.5px] font-semibold cursor-pointer border border-(--color-border-mid) bg-transparent text-[var(--color-text-secondary)] [transition:background_120ms,border-color_120ms,color_120ms] active:scale-[0.97] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) disabled:opacity-50 disabled:cursor-not-allowed" :disabled="exporting" @click="closeExportModal">
                Cancel
              </button>
              <button class="inline-flex items-center justify-center gap-2 h-8 px-5 rounded-(--radius-md) text-[12.5px] font-bold cursor-pointer border border-transparent bg-[var(--color-accent)] text-[var(--color-bg-base)] [transition:opacity_120ms,box-shadow_120ms] active:scale-[0.97] hover:not(:disabled):opacity-90 hover:not(:disabled):shadow-[0_4px_12px_var(--color-accent-muted)] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="exporting || !exportName.trim()" @click="confirmExport">
                <Loader2 v-if="exporting" :size="14" class="animate-[spin_0.9s_linear_infinite]" />
                <Download v-else :size="14" />
                {{ exporting ? 'Exporting…' : 'Export' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Console panel -->
    <Transition name="dc-console-slide">
      <div v-if="panelOpen" class="dc-console-panel" :style="{ '--dc-console-h': `${consoleHeight}px` }">
        <div
          class="dc-console-resize"
          :class="{ 'dc-console-resize--active': consoleDragging }"
          title="Drag to resize"
          @pointerdown="onConsoleHandleDown"
          @pointermove="onConsoleHandleMove"
          @pointerup="onConsoleHandleUp"
          @pointercancel="onConsoleHandleUp"
        />
        <div class="dc-console-header">
          <span class="dc-console-title">Console</span>

          <div class="dc-console-search">
            <Search :size="11" :stroke-width="2" />
            <input
              v-model="consoleSearch"
              type="text"
              placeholder="Filter logs"
              spellcheck="false"
              autocomplete="off"
            >
          </div>

          <div class="dc-console-filters">
            <button class="dc-filter-chip" :class="{ 'dc-filter-chip--active': filter === 'all' }" @click="filter = 'all'">
              All <span class="dc-filter-count">{{ entries.length }}</span>
            </button>
            <button class="dc-filter-chip" :class="{ 'dc-filter-chip--active': filter === 'log' }" @click="filter = 'log'">
              Logs <span class="dc-filter-count">{{ logCount }}</span>
            </button>
            <button class="dc-filter-chip dc-filter-chip--warn" :class="{ 'dc-filter-chip--active': filter === 'warn' }" @click="filter = 'warn'">
              Warnings <span class="dc-filter-count">{{ warnCount }}</span>
            </button>
            <button class="dc-filter-chip dc-filter-chip--error" :class="{ 'dc-filter-chip--active': filter === 'error' }" @click="filter = 'error'">
              Errors <span class="dc-filter-count">{{ errorCount }}</span>
            </button>
          </div>

          <div class="dc-console-actions">
            <button class="dc-icon-btn" title="Clear console" @click="clearLogs">
              <Trash2 :size="13" :stroke-width="2" />
            </button>
            <button class="dc-icon-btn" title="Close console" @click="togglePanel">
              <X :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>

        <div ref="consoleListRef" class="dc-console-list">
          <div v-if="filteredEntries.length === 0" class="dc-console-empty">
            {{ consoleSearch ? 'No matching entries' : 'No console output yet' }}
          </div>
          <div
            v-for="(entry, i) in filteredEntries"
            :key="i"
            class="dc-log-row"
            :class="LEVEL_CLASS[entry.level]"
          >
            <span class="dc-log-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="dc-log-level">{{ entry.level }}</span>
            <span class="dc-log-text">{{ entry.args.join(' ') }}</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Slim console bar -->
    <button class="dc-console-bar" :class="{ 'dc-console-bar--open': panelOpen }" @click="togglePanel">
      <ChevronUp :size="12" :stroke-width="2.4" class="dc-console-chevron" />
      <span class="dc-console-bar-label">Console</span>

      <span v-if="errorCount > 0" class="dc-badge dc-badge--error">
        <span class="dc-badge-dot" />{{ errorCount }}
      </span>
      <span v-if="warnCount > 0" class="dc-badge dc-badge--warn">
        <span class="dc-badge-dot" />{{ warnCount }}
      </span>
      <span v-if="logCount > 0" class="dc-badge dc-badge--log">
        <span class="dc-badge-dot" />{{ logCount }}
      </span>
      <span v-if="unread > 0 && !panelOpen" class="dc-unread">{{ unread }} new</span>

      <span class="dc-console-bar-spacer" />
    </button>
  </div>
</template>

<style scoped>
.design-canvas-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
  position: relative;
}

.design-canvas-root.dc-resizing {
  cursor: row-resize;
  user-select: none;
  -webkit-user-select: none;
}
.design-canvas-root.dc-resizing .dc-canvas {
  pointer-events: none;
}

/* ── Toolbar ───────────────────────────────────────────────────────────────── */
.dc-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  min-height: 38px;
  padding: 0 10px;
  background: var(--color-bg-base);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.dc-toolbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
}

.dc-toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--color-border-subtle);
  margin: 0 6px;
  flex-shrink: 0;
}

.dc-toolbar-spacer {
  flex: 1;
}

.dc-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
  flex-shrink: 0;
}
.dc-icon-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.dc-icon-btn--active {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent-text);
}
.dc-icon-btn--active:hover {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  color: var(--color-accent-text);
}
.dc-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.dc-icon-btn:disabled:hover {
  background: transparent;
  color: var(--color-text-tertiary);
}

.dc-zoom-label {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
  min-width: 34px;
  text-align: center;
  letter-spacing: 0.01em;
}

.dc-active-name {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}
.dc-screen-count {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  background: var(--color-bg-hover);
  border-radius: 999px;
  padding: 2px 7px;
}

/* ── Screen list dropdown ──────────────────────────────────────────────────── */
.dc-screen-list {
  position: absolute;
  top: 42px;
  left: 8px;
  z-index: 60;
  min-width: 230px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.35),
    0 2px 8px rgba(0, 0, 0, 0.2);
}
.dc-screen-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 100ms ease,
    color 100ms ease;
}
.dc-screen-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.dc-screen-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.dc-screen-item-meta {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
}
.dc-screen-item-err {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  color: var(--color-danger-text);
  font-size: 9px;
  font-weight: 700;
}

/* ── Canvas ────────────────────────────────────────────────────────────────── */
.dc-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: radial-gradient(circle, var(--color-border-subtle) 1px, transparent 1px);
  background-size: 24px 24px;
  background-position: center center;
  cursor: default;
  touch-action: none;
}
.dc-canvas--pan-ready {
  cursor: grab;
  user-select: none;
}
.dc-canvas--panning {
  cursor: grabbing;
  user-select: none;
}
.dc-canvas--picking {
  cursor: crosshair;
}
.dc-canvas--picking .dc-frame,
.dc-canvas--picking .dc-iframe {
  cursor: crosshair;
}
.dc-iframe--picking {
  cursor: crosshair;
}

.dc-grid-wrap {
  position: absolute;
  will-change: transform;
}
.dc-connections {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.dc-screen-wrap {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 2;
}
.dc-connection-badge {
  font-size: 10px;
  color: var(--color-accent-text);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 18%, transparent);
  border-radius: 999px;
  padding: 2px 8px;
  align-self: flex-start;
}
.dc-frame {
  position: relative;
  overflow: hidden;
  background: #000;
  -webkit-mask-image: -webkit-radial-gradient(white, black);
  box-shadow:
    0 0 0 1px color-mix(in srgb, #000 60%, transparent),
    0 8px 48px rgba(0, 0, 0, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.4);
  transition: box-shadow 250ms ease;
}
.dc-frame--highlight {
  box-shadow:
    0 0 0 2px var(--color-accent),
    0 0 0 7px color-mix(in srgb, var(--color-accent) 22%, transparent),
    0 8px 48px rgba(0, 0, 0, 0.55);
}
.dc-frame-skeleton {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(110deg, #101012 8%, #1b1b1f 18%, #101012 33%);
  background-size: 200% 100%;
  animation: dc-shimmer 1.4s linear infinite;
  color: #4a4a52;
}
@keyframes dc-shimmer {
  to {
    background-position-x: -200%;
  }
}
.dc-frame--screen {
  border-radius: 16px;
  width: 390px;
  height: 844px;
}
.dc-empty-grid {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  color: var(--color-text-tertiary);
}
.dc-empty-grid-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.dc-empty-grid-sub {
  font-size: 12px;
  margin-top: 8px;
  line-height: 1.5;
  max-width: 420px;
}
.dc-empty-grid-sub code {
  font-family: ui-monospace, monospace;
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.dc-empty-art {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
  margin-bottom: 10px;
}
.dc-empty-art :deep(svg),
.dc-empty-art :deep(img),
.dc-empty-art :deep(canvas) {
  max-height: 100%;
  max-width: 280px;
  width: auto;
  height: auto;
}
.dc-empty-grid-actions {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.dc-empty-chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}
.dc-empty-chip:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
}
.dc-empty-chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.dc-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: #fff;
  overflow: hidden;
  scrollbar-width: none;
  image-rendering: -webkit-optimize-contrast;
}
.dc-iframe::-webkit-scrollbar {
  display: none;
}

/* ── Console panel ─────────────────────────────────────────────────────────── */
.dc-console-panel {
  height: var(--dc-console-h, 240px);
  min-height: 120px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-subtle);
  position: relative;
}
.dc-console-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 6;
  transition: background 120ms ease;
}
.dc-console-resize:hover,
.dc-console-resize--active {
  background: color-mix(in srgb, var(--color-accent) 35%, transparent);
}
.dc-console-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  min-height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.dc-console-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.dc-console-search {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: box-shadow 120ms ease;
}
.dc-console-search:focus-within {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
}
.dc-console-search input {
  width: 110px;
  border: none;
  background: transparent;
  outline: none;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-family: inherit;
}
.dc-console-search input::placeholder {
  color: var(--color-text-dim);
}
.dc-console-filters {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.dc-console-filters::-webkit-scrollbar {
  display: none;
}
.dc-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
  white-space: nowrap;
}
.dc-filter-chip:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.dc-filter-chip--active {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent-text);
}
.dc-filter-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
}
.dc-console-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.dc-console-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 6px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}
.dc-console-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-dim);
  font-family: system-ui, sans-serif;
  font-size: 12px;
}
.dc-log-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 12px;
  border-left: 2px solid transparent;
  color: var(--color-text-primary);
}
.dc-log-time {
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  opacity: 0.7;
}
.dc-log-level {
  flex-shrink: 0;
  width: 42px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.75;
}
.dc-log-text {
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.dc-log--log .dc-log-level,
.dc-log--debug .dc-log-level {
  color: var(--color-text-tertiary);
}
.dc-log--debug .dc-log-text {
  opacity: 0.6;
}
.dc-log--info {
  border-left-color: color-mix(in srgb, var(--color-info) 60%, transparent);
}
.dc-log--info .dc-log-level,
.dc-log--info .dc-log-text {
  color: var(--color-info-text);
}
.dc-log--warn {
  border-left-color: color-mix(in srgb, var(--color-warning) 70%, transparent);
  background: color-mix(in srgb, var(--color-warning) 6%, transparent);
}
.dc-log--warn .dc-log-level,
.dc-log--warn .dc-log-text {
  color: var(--color-warning-text);
}
.dc-log--error {
  border-left-color: color-mix(in srgb, var(--color-danger) 70%, transparent);
  background: color-mix(in srgb, var(--color-danger) 7%, transparent);
}
.dc-log--error .dc-log-level,
.dc-log--error .dc-log-text {
  color: var(--color-danger-text);
}

/* ── Slim console bar ──────────────────────────────────────────────────────── */
.dc-console-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  min-height: 26px;
  padding: 0 10px;
  border: none;
  border-top: 1px solid var(--color-border-subtle);
  background: var(--color-bg-surface);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
  flex-shrink: 0;
}
.dc-console-bar:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.dc-console-bar--open {
  color: var(--color-text-secondary);
}
.dc-console-chevron {
  transition: transform 160ms ease;
}
.dc-console-bar--open .dc-console-chevron {
  transform: rotate(180deg);
}
.dc-console-bar-label {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.dc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dc-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.dc-badge--error {
  background: color-mix(in srgb, #f56c6c 16%, transparent);
  color: #f56c6c;
}
.dc-badge--warn {
  background: color-mix(in srgb, #e6a23c 16%, transparent);
  color: #e6a23c;
}
.dc-badge--log {
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
}
.dc-unread {
  font-weight: 600;
  color: var(--color-accent-text);
}
.dc-console-bar-spacer {
  flex: 1;
}

/* ── Transitions ───────────────────────────────────────────────────────────── */
.dc-fade-enter-active,
.dc-fade-leave-active {
  transition: opacity 200ms ease;
}
.dc-fade-enter-from,
.dc-fade-leave-to {
  opacity: 0;
}
.dc-console-slide-enter-active,
.dc-console-slide-leave-active {
  transition:
    height 180ms ease,
    opacity 160ms ease;
}
.dc-console-slide-enter-from,
.dc-console-slide-leave-to {
  height: 0;
  min-height: 0;
  opacity: 0;
}
</style>
