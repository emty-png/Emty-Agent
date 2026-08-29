/** The only files a design project may contain. */
export const DESIGN_FILES = ['index.html', 'styles.css', 'script.js'] as const

/** Valid project names: lowercase letters/digits, then letters/digits/-/_ (max 64). */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const MAX_SCREENS_PER_DESIGN = 20

/** Supported viewport presets — each maps to a concrete frame size in the preview grid. */
export const VIEWPORT_PRESETS = {
  mobile: { width: 390, height: 844, label: 'Mobile' },
  tablet: { width: 768, height: 1024, label: 'Tablet' },
  desktop: { width: 1440, height: 900, label: 'Desktop' },
} as const

export type ViewportPreset = keyof typeof VIEWPORT_PRESETS

export interface ScreenViewport {
  width: number
  height: number
  preset: ViewportPreset
}

export function getViewportPreset(preset?: string): ScreenViewport {
  const key = (preset && preset in VIEWPORT_PRESETS ? preset : 'mobile') as ViewportPreset
  const p = VIEWPORT_PRESETS[key]
  return { width: p.width, height: p.height, preset: key }
}

export function normalizeViewport(input?: string | null, width?: number, height?: number): ScreenViewport {
  const preset = (input && input in VIEWPORT_PRESETS ? input : 'mobile') as ViewportPreset
  const base = VIEWPORT_PRESETS[preset]
  const w = typeof width === 'number' && Number.isFinite(width) && width >= 320 && width <= 5120 ? Math.round(width) : base.width
  const h = typeof height === 'number' && Number.isFinite(height) && height >= 480 && height <= 3200 ? Math.round(height) : base.height
  return { width: w, height: h, preset }
}
