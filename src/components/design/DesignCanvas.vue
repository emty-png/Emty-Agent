<script setup lang="ts">
import type { DesignProjectType } from '@/stores/chat/core/types'
import type { DesignConsoleEntry, DesignConsoleLevel } from '@/utils/tools/designProject'
import { join } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import {
  ChevronUp,
  Code2,
  Download,
  Expand,
  Loader2,
  MessageSquarePlus,
  Minus,
  Monitor,
  Plus,
  RefreshCw,
  Shrink,
  Smartphone,
  Trash2,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppView } from '@/composables/ui/useAppView'
import { useChatStore } from '@/stores/chat'
import { createBrowserElementAttachment, isBrowserElementAttachment, parseBrowserElementAttachment } from '@/stores/chat/core/attachmentTypes'
import { useProjectStore } from '@/stores/project'
import {
  clearConsoleBuffer,
  DESIGN_FILES,
  DESIGN_PICKER_HOST_SOURCE,
  DESIGN_PICKER_SOURCE,
  injectConsoleBootstrap,
  injectPickerBootstrap,
  pushConsoleEntries,
} from '@/utils/tools/designProject'
import { createZip, sanitizeFilename } from '@/utils/zip'

const props = defineProps<{
  projectVersion: number
  activeProject?: { path: string; name: string; type: DesignProjectType } | null
  tabId?: string | null
  isFullscreen?: boolean
  previewVersionId?: string | null
}>()

const emit = defineEmits<{
  toggleFullscreen: []
}>()

// ── Device presets ───────────────────────────────────────────────────────────

type DeviceType = 'phone' | 'desktop'
const device = ref<DeviceType>('desktop')

const DEVICES: Record<DeviceType, { w: number; h: number; label: string }> = {
  phone: { w: 390, h: 844, label: 'Phone (390×844)' },
  desktop: { w: 1280, h: 800, label: 'Desktop (1280×800)' },
}

const deviceSize = computed(() => DEVICES[device.value])

// ── Annotation picker (state early, helpers after iframeRef) ─────────────────

const isPicking = ref(false)
const chatStore = useChatStore()

// ── Export ───────────────────────────────────────────────────────────────────

const exportOpen = ref(false)
const exportName = ref('')
const exporting = ref(false)
const exportError = ref<string | null>(null)
const exportSuccess = ref<string | null>(null)
let exportSuccessTimer: ReturnType<typeof setTimeout> | null = null
const exportInputRef = ref<HTMLInputElement | null>(null)

// ── Zoom & pan ───────────────────────────────────────────────────────────────

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

function fitToCanvas() {
  const el = canvasRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const { w, h } = deviceSize.value

  const scaleX = (rect.width - FIT_PADDING * 2) / w
  const scaleY = (rect.height - FIT_PADDING * 2) / h
  const fit = clampScale(Math.min(scaleX, scaleY, 1))

  scale.value = fit
  panX.value = rect.width / 2
  panY.value = rect.height / 2
}

// Keep at least a sliver of the frame reachable inside the viewport
function clampPan() {
  const el = canvasRef.value
  if (!el)
    return
  const { width, height } = el.getBoundingClientRect()
  const { w, h } = deviceSize.value
  const halfW = (w * scale.value) / 2
  const halfH = (h * scale.value) / 2

  panX.value = Math.min(Math.max(panX.value, PAN_EDGE_MARGIN - halfW), width - PAN_EDGE_MARGIN + halfW)
  panY.value = Math.min(Math.max(panY.value, PAN_EDGE_MARGIN - halfH), height - PAN_EDGE_MARGIN + halfH)
}

function panBy(dx: number, dy: number) {
  panX.value += dx
  panY.value += dy
  clampPan()
}

onMounted(() => {
  fitToCanvas()
})

watch([device, () => props.activeProject?.path], () => {
  fitToCanvas()
})

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

  // Normalize deltas: deltaMode 1 = lines, 2 = pages
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

  // Ctrl/cmd + scroll (incl. trackpad pinch) zooms at the cursor
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)
    setZoom(scale.value * factor, e.clientX - rect.left, e.clientY - rect.top)
    return
  }

  // Shift swaps vertical scroll into horizontal pan
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

// Multi-pointer (pinch) tracking
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

  // Two fingers take over from panning and start a pinch
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

  // Pinch: zoom around the midpoint, pan with midpoint movement
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
    // Pinch ended — continue panning smoothly with the remaining finger
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
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(() => clampPan())
    resizeObserver.observe(canvasRef.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('message', onWindowMessage)
  resizeObserver?.disconnect()
  resizeObserver = null
  if (exportSuccessTimer) {
    clearTimeout(exportSuccessTimer)
    exportSuccessTimer = null
  }
})

// ── Preview loading ──────────────────────────────────────────────────────────

const iframeKey = ref(0)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const srcdoc = ref('')

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
  // Deep-clone via JSON to strip Vue reactive proxies — postMessage requires structured-cloneable plain objects
  try {
    return JSON.parse(JSON.stringify(raw)) as typeof raw
  }
  catch {
    return raw
  }
}

function sendPickerCommand(action: 'startPicker' | 'stopPicker' | 'setAnnotations', payload?: Record<string, unknown>) {
  const win = iframeRef.value?.contentWindow
  if (!win)
    return
  try {
    const msg = JSON.parse(JSON.stringify({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }))
    win.postMessage(msg, '*')
  }
  catch (err) {
    // Fallback: try raw postMessage if JSON round-trip fails (should still be cloneable)
    try {
      win.postMessage({ source: DESIGN_PICKER_HOST_SOURCE, action, ...(payload ?? {}) }, '*')
    }
    catch (e) {
      console.warn('[DesignCanvas Picker] postMessage failed:', e ?? err)
    }
  }
}

function syncAnnotationsToIframe() {
  // Guard until iframe has a contentWindow (before @load it may be null)
  if (!iframeRef.value?.contentWindow)
    return
  const annotations = draftAnnotations()
  sendPickerCommand('setAnnotations', { annotations })
}

function startPicker() {
  if (!props.activeProject)
    return
  isPicking.value = true
  sendPickerCommand('startPicker')
  syncAnnotationsToIframe()
}

function stopPicker() {
  if (!isPicking.value)
    return
  isPicking.value = false
  sendPickerCommand('stopPicker')
}

function toggleAnnotating() {
  if (isPicking.value)
    stopPicker()
  else
    startPicker()
}

function openExportModal() {
  if (!props.activeProject)
    return
  exportName.value = props.activeProject.name
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
  const project = props.activeProject
  if (!project || exporting.value)
    return
  const rawName = exportName.value.trim() || project.name
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

    // Read design files (text) and encode as UTF-8 for the ZIP
    const entries: Array<{ name: string; data: Uint8Array }> = []
    const enc = new TextEncoder()
    for (const fileName of DESIGN_FILES) {
      try {
        const fullPath = await join(project.path, fileName)
        const content = await readTextFile(fullPath)
        entries.push({ name: fileName, data: enc.encode(content) })
      }
      catch (e) {
        // Skip unreadable files but warn — still create a zip with whatever we have
        console.warn(`[DesignCanvas Export] Skip ${fileName}:`, e)
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
}

// ── Open code in project view ────────────────────────────────────────────────

const projectStore = useProjectStore()
const { setView } = useAppView()

function openInProjectView() {
  const path = props.activeProject?.path
  if (!path)
    return
  projectStore.addProject(path, true)
  setView('projects')
}

async function readProjectFiles() {
  const project = props.activeProject
  if (!project) {
    srcdoc.value = ''
    return
  }

  // If previewing a historical version, read from snapshot dir
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
      srcdoc.value = html
      return
    }
    catch (e) {
      console.warn('[DesignCanvas] preview snapshot read failed, falling back to live', e)
    }
  }

  try {
    let html = await readTextFile(await join(project.path, 'index.html'))

    // Console + picker bootstraps must run before any user code
    html = injectConsoleBootstrap(html)
    html = injectPickerBootstrap(html)

    // Inline styles.css over its <link> tag
    try {
      const css = await readTextFile(await join(project.path, 'styles.css'))
      html = html.replace(
        /<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i,
        `<style>${css.replaceAll('$', '$$$$')}</style>`,
      )
    }
    catch {}

    // Inline script.js over its <script src> tag
    try {
      const js = await readTextFile(await join(project.path, 'script.js'))
      html = html.replace(
        /<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i,
        `<script>${js.replaceAll('$', '$$$$')}<\/script>`,
      )
    }
    catch {}

    srcdoc.value = html
  }
  catch (e) {
    console.error('[DesignCanvas] Failed to read project files:', e)
    srcdoc.value = `<html><body style="font-family:system-ui;padding:40px;color:#666;">
      <h2>Preview unavailable</h2>
      <p>Could not read project files: ${e instanceof Error ? e.message : String(e)}</p>
    </body></html>`
  }
}

watch(
  [() => props.projectVersion, () => props.activeProject?.path, () => props.previewVersionId],
  () => {
    if (props.activeProject) {
      readProjectFiles()
      iframeKey.value++
    }
    else {
      srcdoc.value = ''
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
  if (filter.value === 'all')
    return entries.value
  if (filter.value === 'log')
    return entries.value.filter(e => e.level === 'log' || e.level === 'info' || e.level === 'debug')
  return entries.value.filter(e => e.level === filter.value)
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
  if (!iframeRef.value || e.source !== iframeRef.value.contentWindow)
    return

  // Picker annotation from inside iframe → add as chat attachment
  if (data.source === DESIGN_PICKER_SOURCE) {
    if (data.kind === 'annotation' && data.annotation) {
      const tabId = props.tabId
      if (!tabId)
        return
      const tab = chatStore.tabs.find(t => t.id === tabId)
      if (!tab)
        return
      try {
        // Enrich annotation with project path so it persists per-project and is useful for the AI
        const ann = data.annotation as Record<string, unknown>
        if (props.activeProject?.path && typeof ann.url === 'string')
          ann.url = props.activeProject.path
        if (props.activeProject?.name && typeof ann.title === 'string' && !ann.title)
          ann.title = props.activeProject.name
        const attachment = createBrowserElementAttachment(ann as never)
        chatStore.updateTabDraft(tabId, {
          attachments: [...tab.draft.attachments, attachment],
        })
        // Re-sync markers so the new note appears immediately
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

  const validLevels: DesignConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  const level = validLevels.includes(data.level as DesignConsoleLevel)
    ? data.level as DesignConsoleLevel
    : 'log'

  const entry: DesignConsoleEntry = {
    level,
    args: Array.isArray(data.args) ? data.args.map(a => String(a)) : [],
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
  }

  entries.value.push(entry)
  if (entries.value.length > MAX_ENTRIES)
    entries.value.splice(0, entries.value.length - MAX_ENTRIES)

  const path = props.activeProject?.path
  if (path)
    pushConsoleEntries(path, [entry])

  if (!panelOpen.value && (level === 'error' || level === 'warn'))
    unread.value++
}

function onIframeLoad() {
  // Iframe re-created after projectVersion bump — re-sync picker state
  nextTick(() => {
    syncAnnotationsToIframe()
    if (isPicking.value)
      sendPickerCommand('startPicker')
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
  const path = props.activeProject?.path
  if (path)
    clearConsoleBuffer(path)
}

// Auto-scroll console to bottom when new entries arrive (if already near bottom)
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

// Reset local view when switching projects (shared buffer is per-project)
watch(() => props.activeProject?.path, () => {
  entries.value = []
  unread.value = 0
  // Stop picker when switching projects (modal)
  if (isPicking.value)
    stopPicker()
  // Re-sync markers after project switch (srcdoc will be rebuilt)
  nextTick(() => syncAnnotationsToIframe())
})

// Keep iframe markers in sync with chat draft (e.g. attachment deleted in ChatInput)
watch(
  () => {
    const tabId = props.tabId
    if (!tabId)
      return ''
    const tab = chatStore.tabs.find(t => t.id === tabId)
    return tab?.draft.attachments.map(a => a.id).join('|') ?? ''
  },
  () => {
    nextTick(() => syncAnnotationsToIframe())
  },
)

// If activeProject disappears (landing), exit picker
watch(() => !!props.activeProject, hasProject => {
  if (!hasProject && isPicking.value)
    stopPicker()
})

// ── Frame style ──────────────────────────────────────────────────────────────

const frameStyle = computed(() => {
  const w = deviceSize.value.w
  const h = deviceSize.value.h
  return {
    width: `${w}px`,
    height: `${h}px`,
    left: `${panX.value}px`,
    top: `${panY.value}px`,
    transform: `translate(-50%, -50%) scale(${scale.value})`,
  }
})
</script>

<template>
  <div class="design-canvas-root">
    <div class="dc-toolbar">
      <div class="dc-toolbar-group">
        <button
          class="dc-icon-btn"
          :disabled="!activeProject"
          title="Show code"
          @click="openInProjectView"
        >
          <Code2 :size="14" :stroke-width="1.8" />
        </button>
        <button
          class="dc-icon-btn"
          :class="{ 'dc-icon-btn--active': device === 'phone' }"
          :title="DEVICES.phone.label"
          @click="device = 'phone'"
        >
          <Smartphone :size="14" :stroke-width="1.8" />
        </button>
        <button
          class="dc-icon-btn"
          :class="{ 'dc-icon-btn--active': device === 'desktop' }"
          :title="DEVICES.desktop.label"
          @click="device = 'desktop'"
        >
          <Monitor :size="14" :stroke-width="1.8" />
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
          :disabled="!activeProject"
          title="Annotate element"
          :aria-pressed="isPicking"
          @click="toggleAnnotating"
        >
          <MessageSquarePlus :size="14" :stroke-width="1.8" />
        </button>
        <button class="dc-icon-btn" :disabled="!activeProject" title="Export design as ZIP" @click="openExportModal">
          <Download :size="14" :stroke-width="1.8" />
        </button>
      </div>
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
        <div v-if="activeProject" class="dc-frame-wrap" :style="frameStyle">
          <div class="dc-frame" :class="`dc-frame--${device}`">
            <iframe
              :key="`${iframeKey}-${activeProject.path}`"
              ref="iframeRef"
              class="dc-iframe"
              :class="{ 'dc-iframe--picking': isPicking }"
              :srcdoc="srcdoc"
              sandbox="allow-scripts allow-forms allow-same-origin"
              title="Design preview"
              @load="onIframeLoad"
            />

            <div v-if="device === 'phone'" class="dc-phone-home-bar" />
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
                  Exports index.html, styles.css and script.js as a ZIP archive.
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
      <div v-if="panelOpen" class="dc-console-panel">
        <div class="dc-console-header">
          <span class="dc-console-title">Console</span>

          <div class="dc-console-filters">
            <button
              class="dc-filter-chip"
              :class="{ 'dc-filter-chip--active': filter === 'all' }"
              @click="filter = 'all'"
            >
              All <span class="dc-filter-count">{{ entries.length }}</span>
            </button>
            <button
              class="dc-filter-chip"
              :class="{ 'dc-filter-chip--active': filter === 'log' }"
              @click="filter = 'log'"
            >
              Logs <span class="dc-filter-count">{{ logCount }}</span>
            </button>
            <button
              class="dc-filter-chip dc-filter-chip--warn"
              :class="{ 'dc-filter-chip--active': filter === 'warn' }"
              @click="filter = 'warn'"
            >
              Warnings <span class="dc-filter-count">{{ warnCount }}</span>
            </button>
            <button
              class="dc-filter-chip dc-filter-chip--error"
              :class="{ 'dc-filter-chip--active': filter === 'error' }"
              @click="filter = 'error'"
            >
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
            No console output yet
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
  padding-right: 4px;
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

.dc-frame-wrap {
  position: absolute;
  will-change: transform;
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
}

.dc-frame--phone {
  border-radius: 44px;
  width: 390px;
  height: 844px;
}

.dc-frame--desktop {
  border-radius: 10px;
  width: 1280px;
  height: 800px;
}

.dc-phone-home-bar {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 134px;
  height: 5px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
  z-index: 2;
  pointer-events: none;
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
  height: 240px;
  min-height: 140px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-subtle);
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
