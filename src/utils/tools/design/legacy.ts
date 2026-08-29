import { tool, zodSchema } from 'ai'
import { z } from 'zod'

export function createStartProjectTool(): ReturnType<typeof tool> {
  return tool({
    description: 'Deprecated: use create_screen instead. This tool always returns an error.',
    inputSchema: zodSchema(z.object({ name: z.string().optional(), overwrite: z.boolean().optional() })),
    execute: async () => ({ ok: false, message: 'start_project is removed. Use create_screen with design + screen instead.' }),
  }) as unknown as ReturnType<typeof tool>
}
