import type { ToolRegistryContext } from '../toolRegistry'
import type { ToolSet } from '@/utils/ai'
import { createDesignTool, createEditDesignTool } from '@/utils/tools/createDesign'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSkillTools } from '@/utils/tools/skills'

export async function designProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  return {
    create_design: createDesignTool(ctx.onDesignCreate),
    edit_design: createEditDesignTool(ctx.onDesignEdit),
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    ...createSkillTools(ctx.workspacePath),
  }
}
