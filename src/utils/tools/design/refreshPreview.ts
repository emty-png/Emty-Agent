import type { ActiveDesignGetter } from './types'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'

export function createRefreshPreviewTool(
  getActiveDesign?: ActiveDesignGetter,
  onFilesChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.refresh_preview,
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      console.warn('[refresh_preview] ── START ──')
      try {
        const design = getActiveDesign?.()
        if (!design) {
          const msg = 'No active design. Call create_screen first.'
          console.warn(`[refresh_preview] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        onFilesChanged?.()
        console.warn(`[refresh_preview] ✓ Preview refreshed for ${design.name}`)
        return { ok: true, message: `Preview refreshed for "${design.name}".` }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[refresh_preview] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `refresh_preview failed: ${detail}` }
      }
    },
  })
}
