/**
 * Design tools: create_design + edit_design
 *
 * Used exclusively in 'design' mode. Tools produce DesignArtifact objects that
 * are stored on the ChatTab and rendered live in DesignCanvas.
 */

import type { DesignArtifact } from '@/stores/chat/types'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'

// ── create_design ─────────────────────────────────────────────────────────────

export function createDesignTool(
  onDesignCreate?: (artifact: DesignArtifact) => void,
) {
  return tool({
    description: `Create a new UI design artifact. The design is rendered live in the user\'s canvas as a fully interactive HTML/CSS/JS preview.

Rules:
- ALWAYS call this tool on every response — never just reply with code blocks.
- Produce complete, standalone HTML. Do NOT reference external files or CDN URLs that may be blocked.
- Inline all CSS in the <css> field and all JavaScript in the <js> field.
- Use the <html> field only for the <body> content (no <html>/<head>/<body> wrapper tags).
- Give each design a short, descriptive name (e.g. "Login Screen", "Dashboard v2").
- Choose a unique id (snake_case, e.g. "login_screen") — reuse it with edit_design later.`,
    inputSchema: zodSchema(z.object({
      id: z.string().describe('Unique snake_case identifier for this design (e.g. "login_screen"). Used by edit_design to reference it later.'),
      name: z.string().describe('Short human-readable name (e.g. "Login Screen")'),
      description: z.string().describe('One-sentence description of what this design shows'),
      html: z.string().describe('Body HTML content only — no <html>/<head>/<body> wrappers'),
      css: z.string().describe('All CSS styles for this design'),
      js: z.string().describe('All JavaScript for this design (runs after DOM is ready)'),
    })),
    execute: async ({ id, name, description, html, css, js }, _options) => {
      console.warn('[create_design] ── START ──')
      console.warn(`[create_design] params: id=${JSON.stringify(id)} name=${JSON.stringify(name)}`)
      console.warn(`[create_design] params: description=${JSON.stringify(description)} (length=${description?.length ?? 0})`)
      console.warn(`[create_design] params: html=${html?.length ?? 0}b css=${css?.length ?? 0}b js=${js?.length ?? 0}b`)
      console.warn(`[create_design] onDesignCreate callback=${typeof onDesignCreate}`)
      try {
        if (!id || id.trim().length === 0) {
          const msg = `create_design validation failed: id is required and must be non-empty. Received id=${JSON.stringify(id)}`
          console.warn(`[create_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        if (!name || name.trim().length === 0) {
          const msg = `create_design validation failed: name is required and must be non-empty. Received name=${JSON.stringify(name)}`
          console.warn(`[create_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        if (typeof html !== 'string') {
          const msg = `create_design validation failed: html must be a string. Received type=${typeof html}`
          console.warn(`[create_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        if (typeof css !== 'string') {
          const msg = `create_design validation failed: css must be a string. Received type=${typeof css}`
          console.warn(`[create_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        if (typeof js !== 'string') {
          const msg = `create_design validation failed: js must be a string. Received type=${typeof js}`
          console.warn(`[create_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        const now = Date.now()
        const artifact: DesignArtifact = {
          id,
          name,
          description,
          html,
          css,
          js,
          createdAt: now,
          updatedAt: now,
        }
        console.warn(`[create_design] artifact constructed, calling onDesignCreate(id=${id})...`)
        try {
          onDesignCreate?.(artifact)
          console.warn('[create_design] onDesignCreate returned OK')
        }
        catch (cbErr) {
          const cbDetail = cbErr instanceof Error ? `${cbErr.message}` : String(cbErr)
          const cbStack = cbErr instanceof Error ? cbErr.stack : undefined
          console.warn(`[create_design] ✗ onDesignCreate THREW: ${cbDetail}`)
          if (cbStack)
            console.warn(`[create_design] callback stack: ${cbStack}`)
          return { ok: false, id, message: `create_design callback failed for "${name}": ${cbDetail}` }
        }
        console.warn(`[create_design] ✓ SUCCESS id=${id} name="${name}"`)
        return { ok: true, id, message: `Design "${name}" created and rendered on the canvas.` }
      }
      catch (e) {
        const detail = e instanceof Error ? `${e.message}` : String(e)
        const stack = e instanceof Error ? e.stack : undefined
        console.warn(`[create_design] ✗ EXCEPTION id=${JSON.stringify(id)} name=${JSON.stringify(name)}`)
        console.warn(`[create_design] error: ${detail}`)
        if (stack)
          console.warn(`[create_design] stack: ${stack}`)
        return { ok: false, id, message: `create_design failed for "${name}": ${detail}` }
      }
    },
  })
}

// ── edit_design ───────────────────────────────────────────────────────────────

export function createEditDesignTool(
  onDesignEdit?: (id: string, patch: Partial<Omit<DesignArtifact, 'id' | 'createdAt'>>) => void,
) {
  return tool({
    description: `Edit an existing design artifact by its id. Only provide the fields you want to change — unchanged fields are preserved.

Rules:
- Use the same id that was passed to create_design.
- You can update html, css, js, name, or description independently.
- ALWAYS call this tool when iterating — never reply with code only.`,
    inputSchema: zodSchema(z.object({
      id: z.string().describe('The design id to edit (must match an existing create_design id)'),
      name: z.string().optional().describe('New name (omit to keep existing)'),
      description: z.string().optional().describe('New description (omit to keep existing)'),
      html: z.string().optional().describe('Replacement body HTML (omit to keep existing)'),
      css: z.string().optional().describe('Replacement CSS (omit to keep existing)'),
      js: z.string().optional().describe('Replacement JS (omit to keep existing)'),
    })),
    execute: async ({ id, ...patch }, _options) => {
      console.warn('[edit_design] ── START ──')
      console.warn(`[edit_design] params: id=${JSON.stringify(id)}`)
      console.warn(`[edit_design] params: patch keys=[${Object.keys(patch).join(', ')}]`)
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
          console.warn(`[edit_design] patch.${k}=${typeof v === 'string' ? `${v.length}b` : JSON.stringify(v)}`)
        }
        else {
          console.warn(`[edit_design] patch.${k}=undefined (omitted)`)
        }
      }
      console.warn(`[edit_design] onDesignEdit callback=${typeof onDesignEdit}`)
      try {
        const changedFields = Object.keys(patch).filter(k => patch[k as keyof typeof patch] !== undefined)
        if (!id || id.trim().length === 0) {
          const msg = `edit_design validation failed: id is required and must be non-empty. Received id=${JSON.stringify(id)}`
          console.warn(`[edit_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        if (changedFields.length === 0) {
          const msg = `edit_design validation failed: no fields provided to update for id="${id}". All patch keys: [${Object.keys(patch).join(', ')}]`
          console.warn(`[edit_design] ✗ ${msg}`)
          return { ok: false, id, message: msg }
        }
        console.warn(`[edit_design] changing fields=[${changedFields.join(', ')}] for id=${id}`)
        const update = {
          ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
          updatedAt: Date.now(),
        } as Partial<Omit<DesignArtifact, 'id' | 'createdAt'>>
        console.warn(`[edit_design] calling onDesignEdit(id=${id})...`)
        try {
          onDesignEdit?.(id, update)
          console.warn('[edit_design] onDesignEdit returned OK')
        }
        catch (cbErr) {
          const cbDetail = cbErr instanceof Error ? `${cbErr.message}` : String(cbErr)
          const cbStack = cbErr instanceof Error ? cbErr.stack : undefined
          console.warn(`[edit_design] ✗ onDesignEdit THREW: ${cbDetail}`)
          if (cbStack)
            console.warn(`[edit_design] callback stack: ${cbStack}`)
          return { ok: false, id, message: `edit_design callback failed for "${id}": ${cbDetail}` }
        }
        console.warn(`[edit_design] ✓ SUCCESS id=${id}`)
        return { ok: true, id, message: `Design "${id}" updated on the canvas.` }
      }
      catch (e) {
        const detail = e instanceof Error ? `${e.message}` : String(e)
        const stack = e instanceof Error ? e.stack : undefined
        console.warn(`[edit_design] ✗ EXCEPTION id=${JSON.stringify(id)}`)
        console.warn(`[edit_design] error: ${detail}`)
        if (stack)
          console.warn(`[edit_design] stack: ${stack}`)
        return { ok: false, id, message: `edit_design failed for "${id}": ${detail}` }
      }
    },
  })
}

// ── Display labels ─────────────────────────────────────────────────────────────

export function designToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'create_design') {
    const designName = typeof args.name === 'string' ? args.name : ''
    return designName ? `Creating "${designName}"` : 'Creating design'
  }
  if (name === 'edit_design') {
    const id = typeof args.id === 'string' ? args.id : ''
    return id ? `Editing "${id}"` : 'Editing design'
  }
  return `Called ${name}`
}
