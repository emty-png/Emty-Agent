import { onMounted, onUnmounted, ref } from 'vue'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1
const STORAGE_KEY = 'app-zoom'

function getSavedZoom(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(v) ? v : 1
  }
  catch { return 1 }
}

function persist(level: number) {
  document.documentElement.style.zoom = String(level)
  localStorage.setItem(STORAGE_KEY, String(level))
}

// Shared reactive state
const zoomLevel = ref(getSavedZoom())
let restore: (() => void) | null = null

export function useZoom() {
  if (restore)
    return { zoomLevel, setZoom }

  persist(zoomLevel.value)

  function handler(e: KeyboardEvent) {
    if (!e.ctrlKey)
      return
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      setZoom(Math.max(ZOOM_MIN, +(zoomLevel.value - ZOOM_STEP).toFixed(2)))
    }
    else if (e.key === '=' || e.key === '+') {
      e.preventDefault()
      setZoom(Math.min(ZOOM_MAX, +(zoomLevel.value + ZOOM_STEP).toFixed(2)))
    }
    else if (e.key === '0') {
      e.preventDefault()
      setZoom(1)
    }
  }

  onMounted(() => window.addEventListener('keydown', handler))
  onUnmounted(() => window.removeEventListener('keydown', handler))

  restore = () => {
    window.removeEventListener('keydown', handler)
    restore = null
  }

  return { zoomLevel, setZoom }
}

function setZoom(level: number) {
  zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
  persist(zoomLevel.value)
}
