import type { ToolRegistryContext } from '../toolRegistry'
import type { ToolSet } from '@/utils/ai'
import { buildProfile } from './build'

export async function planProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  const tools = await buildProfile(ctx)

  // Stub out mutating tools
  const modifyingTools = ['write_file', 'edit_files', 'run_command', 'git_command']

  for (const toolName of modifyingTools) {
    if (tools[toolName]) {
      const original = tools[toolName] as import('ai').Tool<Record<string, unknown>, unknown>
      tools[toolName] = {
        ...original,
        execute: async () => {
          return 'Error: Please write a plan first, then wait for user approval before modifying files or running commands.'
        },
      }
    }
  }

  return tools
}
