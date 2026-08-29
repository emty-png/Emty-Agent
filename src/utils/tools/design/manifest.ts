import type { ScreenViewport } from './constants'
import { homeDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getViewportPreset, NAME_PATTERN, VIEWPORT_PRESETS } from './constants'

async function getDesignsRoot(): Promise<string> {
  const home = await homeDir()
  return join(home, '.emty', 'designs')
}

async function ensureDir(dirPath: string): Promise<void> {
  if (!(await exists(dirPath)))
    await mkdir(dirPath, { recursive: true })
}

async function writeFile(filePath: string, content: string): Promise<void> {
  // Handle both forward and back slashes for Windows compatibility
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : ''
  if (dir)
    await ensureDir(dir)
  await writeTextFile(filePath, content)
}

async function getDesignPath(design: string): Promise<string> {
  const root = await getDesignsRoot()
  return join(root, design)
}

async function getScreenPath(design: string, screen: string): Promise<string> {
  const d = await getDesignPath(design)
  return join(d, screen)
}

async function getManifestPath(design: string): Promise<string> {
  const d = await getDesignPath(design)
  return join(d, 'design.json')
}

export interface DesignManifestFile {
  design: string
  screens: string[]
  connections: Array<{ from: string; to: string; label?: string }>
  updatedAt: number
  /** Per-screen viewport overrides. Absent = mobile 390×844 for backward compat. */
  viewports?: Record<string, ScreenViewport>
}

export async function readDesignManifest(design: string): Promise<DesignManifestFile | null> {
  try {
    const p = await getManifestPath(design)
    if (!(await exists(p)))
      return null
    const raw = await readTextFile(p)
    const obj = JSON.parse(raw) as DesignManifestFile
    if (!obj || typeof obj.design !== 'string' || !Array.isArray(obj.screens))
      return null
    const screens = obj.screens.filter((s): s is string => typeof s === 'string' && NAME_PATTERN.test(s))
    // Parse viewports — validate and drop invalid entries
    let viewports: Record<string, ScreenViewport> | undefined
    if (obj.viewports && typeof obj.viewports === 'object') {
      const parsed: Record<string, ScreenViewport> = {}
      for (const [k, v] of Object.entries(obj.viewports)) {
        if (!screens.includes(k))
          continue
        if (!v || typeof v !== 'object')
          continue
        const rec = v as unknown as Record<string, unknown>
        const w = typeof rec.width === 'number' ? rec.width : undefined
        const h = typeof rec.height === 'number' ? rec.height : undefined
        const preset = typeof rec.preset === 'string' && rec.preset in VIEWPORT_PRESETS ? rec.preset as keyof typeof VIEWPORT_PRESETS : 'mobile'
        const base = getViewportPreset(preset)
        const width = w !== undefined && Number.isFinite(w) && w >= 320 && w <= 5120 ? Math.round(w) : base.width
        const height = h !== undefined && Number.isFinite(h) && h >= 480 && h <= 3200 ? Math.round(h) : base.height
        parsed[k] = { width, height, preset }
      }
      if (Object.keys(parsed).length > 0)
        viewports = parsed
    }
    return {
      design: obj.design,
      screens,
      connections: Array.isArray(obj.connections) ? obj.connections.filter(c => c && typeof c.from === 'string' && typeof c.to === 'string') : [],
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
      ...(viewports ? { viewports } : {}),
    }
  }
  catch {
    return null
  }
}

export async function writeDesignManifest(design: string, manifest: DesignManifestFile): Promise<void> {
  const p = await getManifestPath(design)
  await writeFile(p, JSON.stringify(manifest, null, 2))
}

export async function ensureManifestForDesign(design: string): Promise<DesignManifestFile> {
  let m = await readDesignManifest(design)
  if (!m) {
    m = { design, screens: [], connections: [], updatedAt: Date.now() }
    await writeDesignManifest(design, m)
  }
  return m
}

export function getViewportForScreen(manifest: DesignManifestFile | null, screen: string): ScreenViewport {
  const vp = manifest?.viewports?.[screen]
  if (vp && typeof vp.width === 'number' && typeof vp.height === 'number' && vp.preset in VIEWPORT_PRESETS)
    return vp
  return getViewportPreset('mobile')
}

export { ensureDir, getDesignPath, getDesignsRoot, getManifestPath, getScreenPath, writeFile }
