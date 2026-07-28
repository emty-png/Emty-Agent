import type { ToolRegistryContext } from '@/stores/chat/tools/registry'
import type { ToolSet } from '@/utils/ai'
import { createMemoryTools } from '@/utils/tools/memory'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSleepTool } from '@/utils/tools/sleep'
import { createWebTools } from '@/utils/tools/web'

export async function chatProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  return {
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    sleep: createSleepTool(),
    ...createMemoryTools(ctx.memoryEnabled, ctx.workspaceMeta),
    ...createWebTools(),
  }
}
