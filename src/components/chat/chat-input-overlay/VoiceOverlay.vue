<script setup lang="ts">
import { Square, Upload, X } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  frequencyData: Uint8Array
  duration: number
  transcribing: boolean
  error: string | null
  uploadingFileName: string
  streamingTranscript: string
}>()

const emit = defineEmits<{
  stop: []
  cancel: []
  upload: [file: File]
  pause: []
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function onUploadClick() {
  emit('pause')
  uploading.value = true
  startIdleLoop()
  fileInputRef.value?.click()
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit('upload', file)
  }
  else {
    uploading.value = false
    emit('cancel')
  }
  input.value = ''
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId: number | null = null
let pulseStart = 0

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Canvas 2D ctx does not support CSS color-mix() or var(). Resolve to rgba().
function parseRgb(cssColor: string): [number, number, number] {
  const el = document.createElement('div')
  el.style.color = cssColor
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (match)
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  return [0, 229, 255]
}

let cachedAccent: [number, number, number] | null = null

function getAccentRgb(): [number, number, number] {
  if (!cachedAccent) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()
    cachedAccent = parseRgb(raw || '#00e5ff')
  }
  return cachedAccent
}

function setupCanvas(): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const canvas = canvasRef.value
  if (!canvas)
    return null

  const ctx = canvas.getContext('2d')
  if (!ctx)
    return null

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()

  if (rect.width === 0 || rect.height === 0)
    return null

  const w = rect.width * dpr
  const h = rect.height * dpr
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  return { ctx, width: rect.width, height: rect.height }
}

function drawWaveform() {
  const setup = setupCanvas()
  if (!setup) {
    rafId = requestAnimationFrame(drawWaveform)
    return
  }

  const { ctx, width, height } = setup
  ctx.clearRect(0, 0, width, height)

  const [r, g, b] = getAccentRgb()
  const data = props.frequencyData
  if (!data || data.length === 0) {
    rafId = requestAnimationFrame(drawWaveform)
    return
  }

  const barCount = Math.min(data.length, 48)
  const gap = 3
  const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount)

  for (let i = 0; i < barCount; i++) {
    const value = data[i]! / 255
    const barHeight = Math.max(2, value * (height * 0.85))
    const x = i * (barWidth + gap)
    const y = (height - barHeight) / 2

    const alpha = 0.35 + value * 0.65
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth, barHeight, 1.5)
    ctx.fill()
  }

  rafId = requestAnimationFrame(drawWaveform)
}

function drawIdleWaveform() {
  const setup = setupCanvas()
  if (!setup) {
    rafId = requestAnimationFrame(drawIdleWaveform)
    return
  }

  const { ctx, width, height } = setup
  ctx.clearRect(0, 0, width, height)

  const [r, g, b] = getAccentRgb()
  const elapsed = (Date.now() - pulseStart) / 1000
  const barCount = 48
  const gap = 3
  const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount)

  for (let i = 0; i < barCount; i++) {
    const phase = elapsed * 2.5 - i * 0.12
    const wave = Math.sin(phase) * 0.5 + 0.5
    const barHeight = Math.max(2, wave * height * 0.6)
    const x = i * (barWidth + gap)
    const y = (height - barHeight) / 2
    const alpha = 0.15 + wave * 0.4

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth, barHeight, 1.5)
    ctx.fill()
  }

  rafId = requestAnimationFrame(drawIdleWaveform)
}

function stopLoop() {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function startIdleLoop() {
  stopLoop()
  pulseStart = Date.now()
  drawIdleWaveform()
}

function startLiveLoop() {
  stopLoop()
  drawWaveform()
}

watch(() => [props.transcribing, props.uploadingFileName, uploading.value] as const, ([t, , u]) => {
  if (t || u)
    startIdleLoop()
  else
    startLiveLoop()
})

onMounted(() => {
  cachedAccent = null
  pulseStart = Date.now()
  document.addEventListener('keydown', onKeydown)
  if (props.transcribing || uploading.value)
    drawIdleWaveform()
  else
    drawWaveform()
})

onUnmounted(() => {
  stopLoop()
  document.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  }
  else if (e.key === 'Enter' && !props.transcribing && !props.error) {
    e.preventDefault()
    e.stopPropagation()
    emit('stop')
  }
}

const rootClasses = 'w-full bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) mb-2 flex flex-col overflow-hidden'

const bodyClasses = 'flex flex-col items-center gap-3 px-4 pt-4 pb-4'

const canvasWrapClasses = 'w-full rounded-(--radius-md) overflow-hidden bg-(--color-state-hover) border border-(--color-border-subtle)'

const statusRowClasses = 'flex items-center gap-2.5 max-w-full'

const dotClasses = 'w-2 h-2 rounded-full shrink-0 animate-[pulse_1.5s_ease-in-out_infinite]'

const dotRecordingClasses = `${dotClasses} bg-(--color-danger)`

const spinnerSvgClasses = 'gs-wrap shrink-0'

const statusLabelClasses = 'text-[13px] font-medium text-(--color-text-secondary)'

const uploadFileNameClasses = 'text-[13px] font-medium text-(--color-text-secondary) truncate max-w-[260px]'

const durationClasses = 'text-[11.5px] font-medium font-mono text-(--color-text-tertiary) [font-variant-numeric:tabular-nums]'

const errorClasses = 'text-[13px] font-medium text-(--color-danger-text)'

const actionsClasses = 'flex items-center gap-2'

const btnBase = 'inline-flex items-center justify-center gap-[7px] min-h-[34px] px-3 border rounded-(--radius-md) text-[12px] font-semibold cursor-pointer transition-[background,color,border-color] duration-[120ms] ease'

const btnGhostClasses = `${btnBase} bg-transparent border-(--color-border-mid) text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:text-(--color-text-primary) active:scale-[0.97] active:duration-[80ms]`

const btnDangerClasses = `${btnBase} bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-(--color-danger-text) hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:border-[color-mix(in_srgb,var(--color-danger)_50%,transparent)] active:scale-[0.97] active:duration-[80ms]`
</script>

<template>
  <div
    :class="rootClasses"
    role="status"
    aria-label="Voice recording"
  >
    <div :class="bodyClasses">
      <div :class="canvasWrapClasses">
        <canvas ref="canvasRef" class="voice-canvas" />
      </div>

      <div :class="statusRowClasses">
        <template v-if="error">
          <span :class="errorClasses">{{ error }}</span>
        </template>
        <template v-else-if="transcribing && uploadingFileName">
          <span :class="spinnerSvgClasses">
            <svg viewBox="0 0 28 28" width="14" height="14">
              <defs>
                <linearGradient id="gs-voice" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.1" />
                  <stop offset="50%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.5" />
                  <stop offset="100%" style="stop-color: var(--color-accent-bright); stop-opacity: 1" />
                </linearGradient>
              </defs>
              <circle cx="14" cy="14" r="11" fill="none" stroke="var(--color-border-subtle)" stroke-width="2.5" />
              <circle cx="14" cy="14" r="11" fill="none" stroke="url(#gs-voice)" stroke-width="2.5" stroke-linecap="round" class="gs-spin" />
            </svg>
          </span>
          <span :class="uploadFileNameClasses">Transcribing {{ uploadingFileName }}</span>
        </template>
        <template v-else-if="transcribing">
          <span :class="spinnerSvgClasses">
            <svg viewBox="0 0 28 28" width="14" height="14">
              <defs>
                <linearGradient id="gs-voice-2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.1" />
                  <stop offset="50%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.5" />
                  <stop offset="100%" style="stop-color: var(--color-accent-bright); stop-opacity: 1" />
                </linearGradient>
              </defs>
              <circle cx="14" cy="14" r="11" fill="none" stroke="var(--color-border-subtle)" stroke-width="2.5" />
              <circle cx="14" cy="14" r="11" fill="none" stroke="url(#gs-voice-2)" stroke-width="2.5" stroke-linecap="round" class="gs-spin" />
            </svg>
          </span>
          <span :class="statusLabelClasses">Transcribing...</span>
        </template>
        <template v-else>
          <span :class="dotRecordingClasses" />
          <span :class="statusLabelClasses">Listening</span>
          <span :class="durationClasses">{{ formatDuration(duration) }}</span>
        </template>
      </div>

      <!-- Live transcript preview -->
      <div v-if="props.streamingTranscript" class="dc-transcript">
        <span class="dc-transcript-text">{{ props.streamingTranscript }}</span>
      </div>

      <!-- Controls -->
      <div :class="actionsClasses">
        <!-- Hidden file input for audio upload -->
        <input
          ref="fileInputRef"
          type="file"
          accept="audio/*"
          class="sr-only"
          @change="onFilePicked"
        >
        <button
          v-if="!transcribing && !error"
          :class="btnGhostClasses"
          type="button"
          @click="onUploadClick"
        >
          <Upload :size="14" />
          <span>Upload Audio</span>
        </button>
        <button
          v-if="!transcribing && !error"
          :class="btnGhostClasses"
          type="button"
          @click="emit('cancel')"
        >
          <X :size="14" />
          <span>Cancel</span>
        </button>
        <button
          v-if="!transcribing && !error"
          :class="btnDangerClasses"
          type="button"
          @click="emit('stop')"
        >
          <Square :size="11" :stroke-width="0" style="fill: currentColor" />
          <span>Stop</span>
        </button>
        <button
          v-if="error"
          :class="btnGhostClasses"
          type="button"
          @click="emit('cancel')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.voice-canvas {
  width: 100%;
  height: 48px;
  display: block;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes gsSpin {
  to {
    transform: rotate(360deg);
  }
}

.gs-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gs-spin {
  animation: gsSpin 1.8s linear infinite;
  transform-origin: center;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 30%, transparent));
}

.dc-transcript {
  width: 100%;
  max-height: 80px;
  overflow-y: auto;
  padding: 0 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}

.dc-transcript::-webkit-scrollbar {
  width: 4px;
}

.dc-transcript::-webkit-scrollbar-thumb {
  background: var(--color-border-mid);
  border-radius: 2px;
}

.dc-transcript-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  font-style: italic;
}
</style>
