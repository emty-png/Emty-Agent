import { homeDir, join } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'

export function createPlanTools(onPlanCreated?: (filepath: string) => void) {
  return {
    write_plan: tool({
      description: 'Write an implementation plan for the user to review. This will save the plan to ~/.emty/plans/ and switch the UI to Plan Mode.',
      inputSchema: z.object({
        planContent: z.string().describe('The markdown content of the plan.'),
        planName: z.string().optional().describe('The name of the plan file. If not provided, a random name will be generated.'),
      }),
      execute: async ({ planContent, planName }) => {
        try {
          const home = await homeDir()
          const plansDir = await join(home, '.emty', 'plans')

          try {
            await mkdir(plansDir, { recursive: true })
          }
          catch {
            // Ignore if directory already exists
          }

          const filename = planName ? (planName.endsWith('.md') ? planName : `${planName}.md`) : `plan-${Date.now()}.md`
          const filepath = await join(plansDir, filename)

          await writeTextFile(filepath, planContent)

          if (onPlanCreated) {
            onPlanCreated(filepath)
          }

          return {
            type: 'text',
            value: `Plan written successfully to ${filepath}. Waiting for user approval.`,
          }
        }
        catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          return {
            type: 'text',
            value: `Failed to write plan: ${msg}`,
          }
        }
      },
    }),
  }
}
