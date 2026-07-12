import type { ToolRegistryContext } from '../toolRegistry'
import type { ToolSet } from '@/utils/ai'
import { createBrowserTools } from '@/utils/tools/browser'
import { createImageGenTools } from '@/utils/tools/imageGen'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSleepTool } from '@/utils/tools/sleep'
import { createWebTools } from '@/utils/tools/web'

export async function designProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  return {
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    sleep: createSleepTool(),
    ...createWebTools(),
    ...createBrowserTools(ctx.tabId),
    ...createImageGenTools(),
  }
}
