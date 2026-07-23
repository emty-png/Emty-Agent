import type { ToolRegistryContext } from '../toolRegistry'
import type { ToolSet } from '@/utils/ai'
import { createBuildProjectTool, createDesignFilesTool, createEditDesignFilesTool, createScaffoldProjectTool, createStartPreviewTool, createStopPreviewTool } from '@/utils/tools/designProject'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSkillTools } from '@/utils/tools/skills'

export async function designProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  return {
    scaffold_project: createScaffoldProjectTool(ctx.onProjectScaffold),
    create_design_files: createDesignFilesTool(ctx.getActiveDesignProject, ctx.onFilesChanged),
    edit_design_files: createEditDesignFilesTool(ctx.getActiveDesignProject, ctx.onFilesChanged),
    build_project: createBuildProjectTool(ctx.getActiveDesignProject, ctx.onFilesChanged),
    start_preview: createStartPreviewTool(ctx.getActiveDesignProject, ctx.onPreviewUrl, ctx.onDevServerTaskId),
    stop_preview: createStopPreviewTool(ctx.getActiveDesignProject, ctx.onPreviewUrl, ctx.onDevServerTaskId),
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    ...createSkillTools(ctx.workspacePath),
  }
}
