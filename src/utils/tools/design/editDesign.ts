import type { ActiveDesignGetter } from './types'
import { join } from '@tauri-apps/api/path'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { DESIGN_FILES, NAME_PATTERN } from './constants'
import { writeFile } from './manifest'

export function createEditDesignTool(
  getActiveDesign?: ActiveDesignGetter,
  onFilesChanged?: () => void,
  onVersionAccumulate?: (screen: string, files: Array<{ path: string; content: string }>) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.edit_design,
    inputSchema: zodSchema(z.object({
      // Batch mode: edit many screens in one call
      edits: z.array(z.object({
        screen: z.string().regex(NAME_PATTERN).describe('Screen name to edit'),
        files: z.array(z.object({
          path: z.enum(['index.html', 'styles.css', 'script.js']).describe('File to edit relative to the screen root'),
          content: z.string().describe('Full new file content'),
        })).min(1).max(3),
      })).min(1).max(20).optional().describe('Batch edits across screens (preferred for multiple screens)'),
      // Legacy single-screen shorthand
      screen: z.string().regex(NAME_PATTERN).optional().describe('Screen name (required if using files shorthand)'),
      files: z.array(z.object({
        path: z.enum(['index.html', 'styles.css', 'script.js']).describe('File to edit relative to the screen root'),
        content: z.string().describe('Full new file content'),
      })).min(1).max(3).optional().describe('Files to write for the single screen specified by screen (shorthand)'),
    }).refine(v => (v.edits && v.edits.length > 0) || (v.screen && v.files && v.files.length > 0), { message: 'Provide either edits:[{screen, files}] for batch, or screen+files for single screen' })),
    execute: async ({ edits, screen, files }) => {
      // DEBUG: log raw input for troubleshooting "editing 0 files"
      try {
        const dbgInput = JSON.stringify({ edits, screen, files: files?.map(f => ({ path: f.path, len: f.content?.length })) }, null, 2)
        console.warn(`[edit_design] DEBUG raw input=${dbgInput.slice(0, 4000)}`)
      }
      catch {}
      const normalized: Array<{ screen: string; files: Array<{ path: (typeof DESIGN_FILES)[number]; content: string }> }> = []
      if (edits && edits.length > 0) {
        for (const e of edits)
          normalized.push({ screen: e.screen, files: e.files as typeof normalized[number]['files'] })
      }
      else if (screen && files) {
        normalized.push({ screen, files: files as typeof normalized[number]['files'] })
      }

      console.warn(`[edit_design] ── START ── batches=${normalized.length} normalized=${JSON.stringify(normalized.map(n => ({ screen: n.screen, files: n.files.map(f => f.path) })))}`)
      try {
        const design = getActiveDesign?.()
        console.warn(`[edit_design] DEBUG activeDesign=${design ? JSON.stringify(design) : 'null'}`)
        if (!design) {
          const msg = 'No active design. Call create_screen first to create a design and screen.'
          console.warn(`[edit_design] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        let totalWritten = 0
        let totalSkipped = 0
        const allErrors: string[] = []
        const perScreenWritten = new Map<string, Array<{ path: string; content: string }>>()

        for (const batch of normalized) {
          const screenPath = await join(design.path, batch.screen)
          console.warn(`[edit_design] DEBUG batch screen="${batch.screen}" screenPath="${screenPath}" files=${batch.files.map(f => f.path).join(',')}`)
          const screenExists = await exists(screenPath)
          console.warn(`[edit_design] DEBUG exists(${screenPath})=${screenExists}`)
          if (!screenExists) {
            const err = `${batch.screen}: screen does not exist in design "${design.name}" (expected at ${screenPath})`
            allErrors.push(err)
            console.warn(`[edit_design] ✗ ${err}`)
            // DEBUG: list design dir contents
            try {
              const { readTextFile: _rt } = await import('@tauri-apps/plugin-fs')
              void _rt
            }
            catch {}
            continue
          }

          for (const file of batch.files) {
            try {
              const fullPath = await join(screenPath, file.path)
              console.warn(`[edit_design] DEBUG writing ${batch.screen}/${file.path} fullPath="${fullPath}" len=${file.content.length}`)
              let unchanged = false
              let prevLen = -1
              try {
                if (await exists(fullPath)) {
                  const prev = await readTextFile(fullPath)
                  prevLen = prev.length
                  unchanged = prev === file.content
                }
              }
              catch { /* treat as changed */ }
              console.warn(`[edit_design] DEBUG prevLen=${prevLen} unchanged=${unchanged}`)

              if (unchanged) {
                totalSkipped++
                console.warn(`[edit_design] ⊘ ${batch.screen}/${file.path} unchanged`)
                continue
              }

              await writeFile(fullPath, file.content)
              totalWritten++
              console.warn(`[edit_design] ✓ wrote ${batch.screen}/${file.path} (${file.content.length} bytes)`)
              const arr = perScreenWritten.get(batch.screen) ?? []
              arr.push({ path: file.path, content: file.content })
              perScreenWritten.set(batch.screen, arr)
            }
            catch (e) {
              const error = e instanceof Error ? e.message : String(e)
              allErrors.push(`${batch.screen}/${file.path}: ${error}`)
              console.warn(`[edit_design] ✗ failed ${batch.screen}/${file.path}: ${error}`)
            }
          }
        }

        console.warn(`[edit_design] DEBUG result totalWritten=${totalWritten} totalSkipped=${totalSkipped} perScreen=${JSON.stringify([...perScreenWritten.entries()].map(([k, v]) => [k, v.length]))} errors=${JSON.stringify(allErrors)} normalizedLen=${normalized.length}`)
        if (totalWritten > 0 && allErrors.length === 0) {
          onFilesChanged?.()
          for (const [scr, fList] of perScreenWritten)
            onVersionAccumulate?.(scr, fList)
        }

        if (allErrors.length > 0 && totalWritten === 0) {
          return { ok: false, written: totalWritten, skipped: totalSkipped, errors: allErrors, message: `Failed: ${allErrors.join('; ')}` }
        }

        return {
          ok: allErrors.length === 0,
          written: totalWritten,
          skipped: totalSkipped,
          errors: allErrors.length > 0 ? allErrors : undefined,
          message: allErrors.length === 0
            ? `${totalWritten} file(s) written across ${perScreenWritten.size} screen(s)${totalWritten > 0 ? ' — preview reloaded' : ', nothing changed'}`
            : `Partial: ${totalWritten} written, errors: ${allErrors.join('; ')}`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[edit_design] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `edit_design failed: ${detail}` }
      }
    },
  })
}
