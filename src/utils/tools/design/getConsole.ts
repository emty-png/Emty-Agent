import type { DesignConsoleEntry } from './console'
import type { ActiveDesignGetter } from './types'
import { join } from '@tauri-apps/api/path'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { consoleBuffers } from './console'
import { NAME_PATTERN } from './constants'

export function createGetConsoleTool(getActiveDesign?: ActiveDesignGetter) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.get_console,
    inputSchema: zodSchema(z.object({
      level: z.enum(['all', 'log', 'info', 'warn', 'error']).optional().describe('Filter by log level (default "all")'),
      limit: z.number().int().min(1).max(200).optional().describe('Max entries to return, newest last (default 50)'),
      screen: z.string().regex(NAME_PATTERN).optional().describe('Screen name to filter console to (optional). If omitted, aggregates all screens in the active design.'),
    })),
    execute: async ({ level, limit, screen }) => {
      console.warn(`[get_console] ── START ── level=${level ?? 'all'} limit=${limit ?? 50} screen=${screen ?? 'all'}`)
      try {
        const design = getActiveDesign?.()
        if (!design) {
          const msg = 'No active design. Call create_screen first.'
          console.warn(`[get_console] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        // If screen specified, filter to that screen's buffer only
        let buffer: DesignConsoleEntry[]
        if (screen) {
          const screenPath = await join(design.path, screen)
          buffer = consoleBuffers.get(screenPath) ?? consoleBuffers.get(await join(design.path, screen)) ?? []
        }
        else {
          // Aggregate all screen buffers that belong to this design path
          const prefix = design.path.endsWith('/') || design.path.endsWith('\\') ? design.path : `${design.path}/`
          const altPrefix = `${design.path.replace(/\\/g, '/')}/`
          buffer = []
          for (const [p, entries] of consoleBuffers) {
            const pn = p.replace(/\\/g, '/')
            if (pn === design.path.replace(/\\/g, '/') || pn.startsWith(altPrefix) || p.startsWith(prefix) || p === prefix.slice(0, -1))
              buffer.push(...entries)
          }
          // If no prefixed match (e.g., legacy single screen at design root), fallback to design root buffer
          if (buffer.length === 0)
            buffer = consoleBuffers.get(design.path) ?? []
          // Sort by timestamp
          buffer = [...buffer].sort((a, b) => a.timestamp - b.timestamp)
        }

        const filtered = (!level || level === 'all')
          ? buffer
          : buffer.filter(entry => entry.level === level)
        const max = Math.min(limit ?? 50, 200)
        const entries = filtered.slice(-max)

        const counts = {
          total: buffer.length,
          errors: buffer.filter(e => e.level === 'error').length,
          warnings: buffer.filter(e => e.level === 'warn').length,
        }

        console.warn(`[get_console] ✓ Returning ${entries.length}/${filtered.length} entries`)
        return {
          ok: true,
          counts,
          entries,
          message: entries.length === 0
            ? 'No console output captured yet.'
            : `${entries.length} of ${filtered.length} matching entr${filtered.length === 1 ? 'y' : 'ies'} (${counts.total} total, ${counts.errors} errors, ${counts.warnings} warnings), oldest first.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[get_console] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `get_console failed: ${detail}` }
      }
    },
  })
}
