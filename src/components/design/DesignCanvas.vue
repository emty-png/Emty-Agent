<script setup lang="ts">
import type { DesignProjectType } from '@/stores/chat/core/types'
import { join } from '@tauri-apps/api/path'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  Download,
  Maximize2,
  Minus,
  Monitor,
  Plus,
  RefreshCw,
  Smartphone,
} from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  projectVersion: number
  activeProject?: { path: string; name: string; type: DesignProjectType } | null
  previewUrl?: string | undefined
}>()

// ── Device toggle ─────────────────────────────────────────────────────────────

type DeviceType = 'phone' | 'desktop'
const device = ref<DeviceType>('desktop')

const DEVICES: Record<DeviceType, { w: number; h: number; label: string }> = {
  phone: { w: 390, h: 844, label: 'Phone (390×844)' },
  desktop: { w: 1280, h: 800, label: 'Desktop (1280×800)' },
}

const deviceSize = computed(() => DEVICES[device.value])

// ── Zoom & pan ────────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)

const MIN_SCALE = 0.1
const MAX_SCALE = 3
const ZOOM_STEP = 0.15

const zoomPercent = computed(() => Math.round(scale.value * 100))

function clampScale(v: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

function setZoom(next: number, originX?: number, originY?: number) {
  const el = canvasRef.value
  if (!el) {
    scale.value = clampScale(next)
    return
  }
  const rect = el.getBoundingClientRect()
  const cx = originX ?? rect.width / 2
  const cy = originY ?? rect.height / 2

  // Zoom toward cursor
  const prevScale = scale.value
  const nextScale = clampScale(next)
  const ratio = nextScale / prevScale

  panX.value = cx + (panX.value - cx) * ratio
  panY.value = cy + (panY.value - cy) * ratio
  scale.value = nextScale
}

function zoomIn() { setZoom(scale.value + ZOOM_STEP) }
function zoomOut() { setZoom(scale.value - ZOOM_STEP) }

function fitToCanvas() {
  const el = canvasRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const { w, h } = deviceSize.value

  // Leave some padding
  const PADDING = 48
  const scaleX = (rect.width - PADDING * 2) / w
  const scaleY = (rect.height - PADDING * 2) / h
  const fit = clampScale(Math.min(scaleX, scaleY))

  scale.value = fit
  panX.value = rect.width / 2
  panY.value = rect.height / 2
}

// Fit on mount and when device/project changes
onMounted(() => {
  fitToCanvas()
})

watch([device, () => props.activeProject?.path], () => {
  fitToCanvas()
})

// ── Wheel zoom ────────────────────────────────────────────────────────────────

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const el = canvasRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top

  const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
  setZoom(scale.value + delta, cursorX, cursorY)
}

// ── Pan (middle-click + drag, or Space + drag) ────────────────────────────────

const isPanning = ref(false)
const spaceDown = ref(false)
let lastPanX = 0
let lastPanY = 0

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !e.repeat) {
    const target = e.target as HTMLElement
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    spaceDown.value = true
    e.preventDefault()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceDown.value = false
    isPanning.value = false
  }
}

function onPointerDown(e: PointerEvent) {
  if (e.button === 1 || spaceDown.value) {
    e.preventDefault()
    isPanning.value = true
    lastPanX = e.clientX
    lastPanY = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isPanning.value)
    return
  panX.value += e.clientX - lastPanX
  panY.value += e.clientY - lastPanY
  lastPanX = e.clientX
  lastPanY = e.clientY
}

function onPointerUp() {
  isPanning.value = false
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

// ── iframe srcdoc composition ─────────────────────────────────────────────────

const iframeKey = ref(0)
const srcdoc = ref('')
const isLoading = ref(false)

function refresh() {
  console.warn(`[DesignCanvas] Refreshing iframe, key: ${iframeKey.value}`)
  iframeKey.value++
}

/** Read project files from disk and compose a srcdoc for the iframe. */
async function readProjectFiles() {
  const project = props.activeProject
  if (!project) {
    srcdoc.value = ''
    return
  }

  isLoading.value = true
  try {
    const type = project.type
    console.warn(`[DesignCanvas] Reading project files: ${project.path} (type: ${type})`)

    if (type === 'single-file') {
      const html = await readTextFile(await join(project.path, 'index.html'))
      console.warn(`[DesignCanvas] Loaded single-file HTML: ${html.length} bytes`)
      srcdoc.value = html
    }
    else if (type === 'multiple-files') {
      const htmlPath = await join(project.path, 'index.html')
      const cssPath = await join(project.path, 'styles.css')
      const jsPath = await join(project.path, 'script.js')

      let html = await readTextFile(htmlPath)

      // Read CSS and inline it
      try {
        const css = await readTextFile(cssPath)
        html = html.replace(
          /<link\s[^>]*href=["']styles\.css["'][^>]*>/i,
          `<style>${css}</style>`,
        )
      }
      catch { /* styles.css may not exist */ }

      // Read JS and inline it
      try {
        const js = await readTextFile(jsPath)
        html = html.replace(
          /<script\s[^>]*src=["']script\.js["'][^>]*>\s*<\/script>/i,
          `<script>${js}<\/script>`,
        )
      }
      catch { /* script.js may not exist */ }

      console.warn(`[DesignCanvas] Composed multiple-files srcdoc: ${html.length} bytes`)
      srcdoc.value = html
    }
    else if (type.startsWith('vite-')) {
      // Vite projects use a dev server — previewUrl is set externally
      console.warn('[DesignCanvas] Vite project, using previewUrl instead of srcdoc')
      srcdoc.value = ''
    }
  }
  catch (e) {
    console.error('[DesignCanvas] Failed to read project files:', e)
    srcdoc.value = `<html><body style="font-family:system-ui;padding:40px;color:#666;">
      <h2>Preview unavailable</h2>
      <p>Could not read project files: ${e instanceof Error ? e.message : String(e)}</p>
    </body></html>`
  }
  finally {
    isLoading.value = false
  }
}

// Re-read files whenever projectVersion changes or project changes
watch(
  [() => props.projectVersion, () => props.activeProject?.path, () => props.activeProject?.type],
  () => {
    if (props.activeProject)
      readProjectFiles()
    else srcdoc.value = ''
  },
  { immediate: true },
)

watch(() => props.previewUrl, (newUrl, oldUrl) => {
  console.warn(`[DesignCanvas] previewUrl changed: ${oldUrl ?? 'null'} -> ${newUrl ?? 'null'}`)
})

// ── Export ────────────────────────────────────────────────────────────────────

async function exportDesign() {
  if (!srcdoc.value)
    return
  const filePath = await saveDialog({
    title: 'Export Design',
    defaultPath: `${props.activeProject?.name ?? 'design'}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  if (!filePath)
    return
  await writeTextFile(filePath, srcdoc.value)
}

// ── Frame transform ───────────────────────────────────────────────────────────

const frameStyle = computed(() => {
  const w = deviceSize.value.w
  const h = deviceSize.value.h
  const s = scale.value
  return {
    width: `${w}px`,
    height: `${h}px`,
    // Use zoom instead of transform: scale() — zoom re-rasterizes at the target
    // resolution so text and edges stay sharp (transform downscales a bitmap).
    zoom: s,
    // Center the (now layout-scaled) element on the pan point
    left: `${panX.value - (w * s) / 2}px`,
    top: `${panY.value - (h * s) / 2}px`,
  }
})
</script>

<template>
  <div class="design-canvas-root">
    <!-- ── Toolbar ── -->
    <div class="dc-toolbar">
      <!-- Device toggle -->
      <div class="dc-toolbar-group">
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

      <!-- Zoom controls -->
      <div class="dc-toolbar-group">
        <button class="dc-icon-btn" title="Zoom out" @click="zoomOut">
          <Minus :size="13" :stroke-width="2" />
        </button>
        <span class="dc-zoom-label">{{ zoomPercent }}%</span>
        <button class="dc-icon-btn" title="Zoom in" @click="zoomIn">
          <Plus :size="13" :stroke-width="2" />
        </button>
        <button class="dc-icon-btn" title="Fit to canvas" @click="fitToCanvas">
          <Maximize2 :size="13" :stroke-width="2" />
        </button>
      </div>

      <div class="dc-toolbar-sep" />

      <!-- Refresh -->
      <button class="dc-icon-btn" title="Refresh preview" @click="refresh">
        <RefreshCw :size="13" :stroke-width="2" />
      </button>

      <!-- Export -->
      <button
        class="dc-icon-btn"
        title="Export as HTML"
        :disabled="!srcdoc"
        @click="exportDesign"
      >
        <Download :size="13" :stroke-width="2" />
      </button>

      <div class="dc-toolbar-spacer" />

      <!-- Project name -->
      <span v-if="activeProject" class="dc-active-name">
        {{ activeProject.name }}
      </span>
    </div>

    <!-- ── Canvas area ── -->
    <div
      ref="canvasRef"
      class="dc-canvas"
      :class="{ 'dc-canvas--panning': isPanning, 'dc-canvas--pan-ready': spaceDown && !isPanning }"
      @wheel.passive="false"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- Empty state -->
      <Transition name="dc-fade">
        <div v-if="!activeProject" class="dc-empty">
          <div class="dc-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
            </svg>
          </div>
          <p class="dc-empty-title">
            Your design will appear here
          </p>
          <p class="dc-empty-sub">
            Describe what you want to build and the agent will render it live
          </p>
        </div>
      </Transition>

      <!-- Device frame + iframe -->
      <Transition name="dc-fade">
        <div v-if="activeProject" class="dc-frame-wrap" :style="frameStyle">
          <div class="dc-frame" :class="`dc-frame--${device}`">
            <!-- Vite projects: use dev server URL -->
            <iframe
              v-if="previewUrl"
              :key="`${iframeKey}-dev-${previewUrl}`"
              class="dc-iframe"
              :src="previewUrl"
              sandbox="allow-scripts allow-forms allow-same-origin"
              title="Design preview"
            />
            <!-- Static projects: use srcdoc -->
            <iframe
              v-else
              :key="`${iframeKey}-${activeProject.path}`"
              class="dc-iframe"
              :srcdoc="srcdoc"
              sandbox="allow-scripts allow-forms allow-same-origin"
              title="Design preview"
            />

            <!-- Phone home indicator -->
            <div v-if="device === 'phone'" class="dc-phone-home-bar" />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ──────────────────────────────────────────────────────────────────── */
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
  background: var(--color-bg-surface);
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
}

.dc-canvas--panning {
  cursor: grabbing;
}

/* ── Empty state ───────────────────────────────────────────────────────────── */
.dc-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: none;
  padding: 32px;
}

.dc-empty-icon {
  color: var(--color-border-bright);
  margin-bottom: 4px;
}

.dc-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.dc-empty-sub {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-dim);
  text-align: center;
  max-width: 280px;
  line-height: 1.6;
}

/* ── Device frame wrap (positioned for pan/zoom) ───────────────────────────── */
.dc-frame-wrap {
  position: absolute;
  will-change: left, top, zoom;
  /* left/top/zoom set inline via :style */
}

/* ── Device frame ─────────────────────────────────────────────────────────── */
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

/* Phone home indicator */
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

/* iframe fills the frame */
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

/* ── Transitions ───────────────────────────────────────────────────────────── */
.dc-fade-enter-active,
.dc-fade-leave-active {
  transition: opacity 200ms ease;
}

.dc-fade-enter-from,
.dc-fade-leave-to {
  opacity: 0;
}
</style>
