import type { ActiveDesignGetter } from './types'
import { join } from '@tauri-apps/api/path'
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { NAME_PATTERN } from './constants'
import { getDesignPath, getScreenPath, readDesignManifest } from './manifest'

declare global {
  interface Window {
    __EMTY_DESIGN_SCREENSHOT_CAPTURE__?: (design: string, screen: string) => Promise<{ dataUrl: string; width: number; height: number; viewport: string }>
  }
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUri)
  if (!match?.[1])
    throw new Error('Invalid PNG data URL')
  const b64 = match[1]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function screenshotFileName(screen: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const safe = screen.replace(/[^a-z0-9_-]/g, '_')
  return `emty-design-${safe}-${ts}.png`
}

export function createScreenshotScreenTool(
  _getActiveDesign?: ActiveDesignGetter,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.screenshot_screen,
    inputSchema: zodSchema(z.object({
      design: z.string().regex(NAME_PATTERN).describe('Design name'),
      screen: z.string().regex(NAME_PATTERN).describe('Screen name to capture'),
    })),
    execute: async ({ design, screen }) => {
      console.warn(`[screenshot_screen] ── START ── design=${design} screen=${screen}`)
      try {
        const designPath = await getDesignPath(design)
        if (!(await exists(designPath))) {
          const msg = `Design "${design}" does not exist.`
          console.warn(`[screenshot_screen] ✗ ${msg}`)
          return { ok: false, message: msg }
        }
        const manifest = await readDesignManifest(design)
        if (!manifest || !manifest.screens.includes(screen)) {
          // Also check filesystem fallback: screen folder exists?
          const screenPath = await getScreenPath(design, screen)
          if (!(await exists(screenPath))) {
            const msg = `Screen "${screen}" does not exist in design "${design}".`
            console.warn(`[screenshot_screen] ✗ ${msg}`)
            return { ok: false, message: msg }
          }
        }

        // Vision capability check — if model lacks vision, inject fallback per spec
        try {
          const { useSettingsStore } = await import('@/stores/settings')
          const s = useSettingsStore()
          const m = (s as unknown as { activeModel?: { supportsAttachments?: boolean } }).activeModel
          if (m && m.supportsAttachments === false) {
            const msg = 'System notification: You can\'t view images, dont try this again.'
            console.warn(`[screenshot_screen] ✗ no vision for model ${m}`)
            return { ok: true, design, screen, message: msg, savedPath: null, note: 'Model does not support vision — no screenshot captured.' }
          }
        }
        catch {}

        // Try global capture bridge (registered by DesignCanvas)
        const w = typeof window !== 'undefined' ? window as unknown as { __EMTY_DESIGN_SCREENSHOT_CAPTURE__?: (d: string, s: string) => Promise<{ dataUrl: string; width: number; height: number; viewport: string }> } : null
        const captureFn = w?.__EMTY_DESIGN_SCREENSHOT_CAPTURE__
        if (!captureFn) {
          const msg = `Design preview not ready — open the design view for "${design}" and ensure the screen is visible before capturing.`
          console.warn(`[screenshot_screen] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        let result: { dataUrl: string; width: number; height: number; viewport: string }
        try {
          // Timeout 15s
          result = await Promise.race([
            captureFn(design, screen),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Screenshot capture timed out after 15s')), 15_000)),
          ])
        }
        catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.warn(`[screenshot_screen] ✗ capture failed: ${detail}`)
          return { ok: false, message: `Screenshot capture failed: ${detail}` }
        }

        const { dataUrl, width, height, viewport } = result
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
          return { ok: false, message: 'Screenshot did not return valid PNG data.' }
        }

        // Save to per-screen .screenshots folder
        let savedPath: string | null = null
        try {
          const screenshotsDir = await join(designPath, screen, '.screenshots')
          await mkdir(screenshotsDir, { recursive: true }).catch(() => {})
          const fileName = screenshotFileName(screen)
          const filePath = await join(screenshotsDir, fileName)
          const bytes = dataUriToBytes(dataUrl)
          await writeFile(filePath, bytes)
          savedPath = filePath
        }
        catch (e) {
          console.warn('[screenshot_screen] save failed:', e)
          // Non-fatal: still return screenshot even if save failed
        }

        console.warn(`[screenshot_screen] ✓ captured ${screen} ${width}x${height} ${viewport} saved=${savedPath ?? 'none'}`)

        // For token safety, the tool result includes full screenshot but messageSerializer will
        // inject it as a separate image part and truncate the JSON representation.
        // We still return full dataUrl here so synthetic injection can use it.
        return {
          ok: true,
          design,
          screen,
          width,
          height,
          viewport,
          savedPath,
          screenshot: dataUrl,
          message: savedPath
            ? `Screenshot of "${screen}" in "${design}" captured at ${width}×${height} (${viewport}), 1× PNG, saved to ${savedPath}.`
            : `Screenshot of "${screen}" in "${design}" captured at ${width}×${height} (${viewport}), 1× PNG.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[screenshot_screen] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `screenshot_screen failed: ${detail}` }
      }
    },
  })
}
