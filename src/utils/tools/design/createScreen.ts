import type { ActiveDesignGetter } from './types'
import { join } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { clearConsoleBuffer } from './console'
import { DESIGN_FILES, MAX_SCREENS_PER_DESIGN, NAME_PATTERN, normalizeViewport, VIEWPORT_PRESETS } from './constants'
import { ensureDir, ensureManifestForDesign, getDesignPath, getScreenPath, readDesignManifest, writeDesignManifest, writeFile } from './manifest'
import { getTemplateFiles } from './template'

export function createCreateScreenTool(
  _getActiveDesign?: ActiveDesignGetter,
  onScreenScaffold?: (info: { design: string; screen: string; path: string }) => void,
  onVersionAccumulate?: (screen: string, files: Array<{ path: string; content: string }>) => void,
  onManifestChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.create_screen,
    inputSchema: zodSchema(z.object({
      design: z.string().regex(NAME_PATTERN, 'Design name must be lowercase (letters, digits, "-" or "_"), start with letter/digit, max 64 chars — e.g. "my_app"').describe('Design name (folder under ~/.emty/designs/)'),
      screen: z.string().regex(NAME_PATTERN, 'Screen name must be lowercase (letters, digits, "-" or "_"), start with letter/digit, max 64 chars — e.g. "login"').describe('Screen name (subfolder under the design)'),
      viewport: z.enum(['mobile', 'tablet', 'desktop']).optional().describe('Viewport preset for the preview frame: mobile=390×844 (default), tablet=768×1024, desktop=1440×900. Use desktop for dashboards/landing pages, mobile for phone UI.'),
      width: z.number().int().min(320).max(5120).optional().describe('Custom frame width in px (overrides viewport preset width). 320–5120.'),
      height: z.number().int().min(480).max(3200).optional().describe('Custom frame height in px (overrides viewport preset height). 480–3200.'),
      overwrite: z.boolean().optional().describe('Set true to replace an existing screen with the same name'),
    })),
    execute: async ({ design, screen, viewport, width, height, overwrite }) => {
      const vp = normalizeViewport(viewport, width, height)
      console.warn(`[create_screen] ── START ── design=${JSON.stringify(design)} screen=${JSON.stringify(screen)} viewport=${vp.preset} ${vp.width}x${vp.height} overwrite=${!!overwrite}`)
      try {
        const designPath = await getDesignPath(design)
        const screenPath = await getScreenPath(design, screen)

        // Check cap before creating a brand new screen
        const existingManifest = await readDesignManifest(design)
        const alreadyExists = await exists(screenPath)
        if (alreadyExists && !overwrite) {
          const msg = `A screen named "${screen}" already exists in design "${design}". Use a different screen name, or pass overwrite:true.`
          console.warn(`[create_screen] ✗ ${msg}`)
          return { ok: false, message: msg }
        }
        if (!alreadyExists) {
          const currentScreens = existingManifest?.screens ?? []
          if (currentScreens.length >= MAX_SCREENS_PER_DESIGN) {
            const msg = `Design "${design}" already has ${MAX_SCREENS_PER_DESIGN} screens (cap). Delete a screen with delete_screens before creating another.`
            console.warn(`[create_screen] ✗ ${msg}`)
            return { ok: false, message: msg }
          }
        }

        await ensureDir(designPath)
        await ensureDir(screenPath)
        clearConsoleBuffer(screenPath)
        clearConsoleBuffer(await join(designPath, screen))

        for (const file of getTemplateFiles(screen, vp)) {
          await writeFile(await join(screenPath, file.path), file.content)
          console.warn(`[create_screen] ✓ Created ${screen}/${file.path}`)
        }

        // Update manifest
        const manifest = await ensureManifestForDesign(design)
        if (!manifest.screens.includes(screen))
          manifest.screens.push(screen)
        if (!manifest.viewports)
          manifest.viewports = {}
        // Only store non-default or if custom size was requested — but always store preset for explicitness
        manifest.viewports[screen] = { width: vp.width, height: vp.height, preset: vp.preset }
        // Clean up viewports for screens that no longer exist (defensive)
        for (const k of Object.keys(manifest.viewports)) {
          if (!manifest.screens.includes(k))
            delete manifest.viewports[k]
        }
        if (Object.keys(manifest.viewports).length === 0)
          delete manifest.viewports
        manifest.updatedAt = Date.now()
        await writeDesignManifest(design, manifest)
        onManifestChanged?.()

        // Notify store — single design per tab
        onScreenScaffold?.({ design, screen, path: screenPath })
        const templateFiles = getTemplateFiles(screen, vp)
        onVersionAccumulate?.(screen, templateFiles.map(f => ({ path: f.path, content: f.content })))

        console.warn(`[create_screen] ✓ Screen ready at ${screenPath} (${vp.preset} ${vp.width}x${vp.height})`)
        const presetLabel = VIEWPORT_PRESETS[vp.preset].label
        return {
          ok: true,
          design,
          screen,
          path: screenPath,
          files: [...DESIGN_FILES],
          viewport: vp,
          message: `Screen "${screen}" created in design "${design}" at ${screenPath} [${presetLabel} ${vp.width}×${vp.height}] with index.html, styles.css and script.js. Use edit_design to build it. The canvas now shows all screens in a grid.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[create_screen] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `create_screen failed: ${detail}` }
      }
    },
  })
}
