import type { ActiveDesignGetter } from './types'
import { exists, remove } from '@tauri-apps/plugin-fs'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { clearConsoleBuffer } from './console'
import { NAME_PATTERN } from './constants'
import { getDesignPath, getScreenPath, readDesignManifest, writeDesignManifest } from './manifest'

export function createDeleteScreensTool(
  _getActiveDesign?: ActiveDesignGetter,
  onManifestChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.delete_screens,
    inputSchema: zodSchema(z.object({
      design: z.string().regex(NAME_PATTERN).describe('Design name'),
      screens: z.array(z.string().regex(NAME_PATTERN)).min(1).max(20).describe('Screen names to delete'),
    })),
    execute: async ({ design, screens }) => {
      const uniqueScreens = [...new Set(screens)]
      console.warn(`[delete_screens] ── START ── design=${design} screens=${uniqueScreens.join(',')}`)
      try {
        const designPath = await getDesignPath(design)
        if (!(await exists(designPath))) {
          const msg = `Design "${design}" does not exist.`
          console.warn(`[delete_screens] ✗ ${msg}`)
          return { ok: false, message: msg }
        }
        let manifest = await readDesignManifest(design)
        if (!manifest) {
          manifest = { design, screens: [], connections: [], updatedAt: Date.now() }
        }

        const deleted: string[] = []
        const notFound: string[] = []
        const failed: Array<{ screen: string; reason: string }> = []

        for (const screen of uniqueScreens) {
          const screenPath = await getScreenPath(design, screen)
          if (!(await exists(screenPath))) {
            notFound.push(screen)
            continue
          }
          try {
            await remove(screenPath, { recursive: true }).catch(() => {})
            clearConsoleBuffer(screenPath)
            // Also clear buffer for design/screen combined path variant used elsewhere
            try {
              const { join } = await import('@tauri-apps/api/path')
              clearConsoleBuffer(await join(designPath, screen))
            }
            catch {}
            // Prune manifest
            manifest.screens = manifest.screens.filter(s => s !== screen)
            if (manifest.viewports) {
              delete manifest.viewports[screen]
              if (Object.keys(manifest.viewports).length === 0)
                delete manifest.viewports
            }
            manifest.connections = manifest.connections.filter(c => c.from !== screen && c.to !== screen)
            deleted.push(screen)
          }
          catch (e) {
            const reason = e instanceof Error ? e.message : String(e)
            failed.push({ screen, reason })
          }
        }

        if (deleted.length > 0) {
          manifest.updatedAt = Date.now()
          await writeDesignManifest(design, manifest)
          onManifestChanged?.()
        }

        if (deleted.length === 0 && notFound.length > 0 && failed.length === 0) {
          return { ok: false, deleted, notFound, failed, message: `None of the screens were found in design "${design}": ${notFound.join(', ')}` }
        }

        if (failed.length > 0 || notFound.length > 0) {
          const parts: string[] = []
          if (deleted.length > 0)
            parts.push(`Deleted: ${deleted.join(', ')}`)
          if (notFound.length > 0)
            parts.push(`Not found: ${notFound.join(', ')}`)
          if (failed.length > 0)
            parts.push(`Failed: ${failed.map(f => `${f.screen} (${f.reason})`).join(', ')}`)
          return {
            ok: deleted.length > 0,
            deleted,
            notFound,
            failed,
            message: `${parts.join('. ')}.`,
          }
        }

        return {
          ok: true,
          deleted,
          notFound,
          failed,
          message: `Screen${deleted.length > 1 ? 's' : ''} "${deleted.join('", "')}" deleted from design "${design}".`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[delete_screens] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `delete_screens failed: ${detail}` }
      }
    },
  })
}
