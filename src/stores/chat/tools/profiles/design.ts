import type { ToolRegistryContext } from '@/stores/chat/tools/registry'
import type { ToolSet } from '@/utils/ai'
import { createEditDesignTool, createGetConsoleTool, createReadDesignTool, createRefreshPreviewTool, createStartProjectTool } from '@/utils/tools/designProject'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSkillTools } from '@/utils/tools/skills'
import { applyDescriptionOverrides } from '@/utils/tools/toolDescriptions'

export async function designProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  const tools: ToolSet = {
    start_project: createStartProjectTool(ctx.onProjectScaffold, ctx.onDesignVersionAccumulate),
    edit_design: createEditDesignTool(ctx.getActiveDesignProject, ctx.onFilesChanged, ctx.onDesignVersionAccumulate),
    read_design: createReadDesignTool(ctx.getActiveDesignProject),
    refresh_preview: createRefreshPreviewTool(ctx.getActiveDesignProject, ctx.onFilesChanged),
    get_console: createGetConsoleTool(ctx.getActiveDesignProject),
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    ...createSkillTools(ctx.workspacePath),
  }

  return applyDescriptionOverrides(tools, ctx.toolDescriptionOverrides)
}
