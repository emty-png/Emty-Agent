import { tool } from 'ai'
import { z } from 'zod'

const artifactTypeSchema = z.enum([
  'mind_map',
  'flow_graph',
  'ui_showcase',
  'theme_showcase',
  'svg',
])

const nodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().optional(),
  note: z.string().optional(),
})

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
})

const sectionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional(),
})

const swatchSchema = z.object({
  role: z.string().min(1),
  token: z.string().min(1),
  note: z.string().optional(),
})

const artifactPayloadSchema = z.object({
  artifactType: artifactTypeSchema,
  title: z.string().min(1).max(120),
  subtitle: z.string().max(280).optional(),
  description: z.string().max(1500).optional(),
  nodes: z.array(nodeSchema).max(80).optional(),
  edges: z.array(edgeSchema).max(140).optional(),
  sections: z.array(sectionSchema).max(24).optional(),
  swatches: z.array(swatchSchema).max(40).optional(),
  svg: z.string().max(80_000).optional(),
})

export type ArtifactPayload = z.infer<typeof artifactPayloadSchema>

function sanitizeSvg(svgRaw: string): string {
  let svg = svgRaw.trim()
  if (!svg)
    throw new Error('SVG content is empty')
  if (!svg.startsWith('<svg'))
    throw new Error('SVG content must start with <svg>')

  // Remove entire dangerous tags first.
  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')

  // Remove inline event handlers such as onload=, onclick=...
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
  svg = svg.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')

  // Remove dangerous href/src values.
  svg = svg.replace(/\s+(href|xlink:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
  svg = svg.replace(/\s+(href|xlink:href|src)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gi, '')

  return svg
}

function truncate(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max)}...` : s
}

export function createCreateArtifactTool() {
  return tool({
    description: `\
Create a rich artifact that the chat UI can render inline.

Use this for:
- mind maps
- flow graphs
- UI showcases
- theme showcases
- SVG visuals

The renderer is theme-aware and should align with app tokens. Use concise titles and structured data.
For SVG output, include safe static SVG markup only (no scripts or event handlers).`,
    inputSchema: z.object({
      artifact: artifactPayloadSchema,
    }),
    execute: async ({ artifact }) => {
      const result: ArtifactPayload = { ...artifact }
      let sanitized = false

      if (result.svg) {
        const cleaned = sanitizeSvg(result.svg)
        sanitized = cleaned !== result.svg
        result.svg = cleaned
      }

      return {
        artifact: result,
        kind: result.artifactType,
        message: `Created ${result.artifactType.replace('_', ' ')} artifact`,
        sanitizedSvg: sanitized,
      }
    },
  })
}

export function artifactToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'create_artifact')
    return `Called ${toolName}`

  const artifact = args.artifact as ArtifactPayload | undefined
  if (!artifact)
    return 'Created artifact'
  const kind = artifact.artifactType.replace('_', ' ')
  return `Created ${kind}: ${truncate(artifact.title)}`
}
