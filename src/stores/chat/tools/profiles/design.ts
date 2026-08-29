import type { ToolRegistryContext } from '@/stores/chat/tools/registry'
import type { ToolSet } from '@/utils/ai'
import { createCreateScreenTool, createDeleteScreensTool, createEditDesignTool, createGetConsoleTool, createReadDesignTool, createRefreshPreviewTool, createScreenshotScreenTool } from '@/utils/tools/designProject'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createSkillTools } from '@/utils/tools/skills'
import { applyDescriptionOverrides } from '@/utils/tools/toolDescriptions'

export async function designProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  // Prefer new multi-screen getters, fallback to legacy project getter for old chats
  const getDesign = ctx.getActiveDesign ?? (() => {
    const legacy = ctx.getActiveDesignProject?.()
    if (legacy)
      return { path: legacy.path, name: legacy.name }
    return null
  })

  const versionAccumulate = ctx.onScreenVersionAccumulate ?? ((screen: string, files: Array<{ path: string; content: string }>) => {
    // Adapt legacy single-screen accumulate (without screen)
    ctx.onDesignVersionAccumulate?.(files)
    void screen
  })

  const tools: ToolSet = {
    create_screen: createCreateScreenTool(getDesign, ctx.onScreenScaffold, versionAccumulate, ctx.onManifestChanged),
    delete_screens: createDeleteScreensTool(getDesign, ctx.onManifestChanged),
    screenshot_screen: createScreenshotScreenTool(getDesign),
    edit_design: createEditDesignTool(getDesign, ctx.onFilesChanged, versionAccumulate),
    read_design: createReadDesignTool(getDesign),
    refresh_preview: createRefreshPreviewTool(getDesign, ctx.onFilesChanged),
    get_console: createGetConsoleTool(getDesign),
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    ...createSkillTools(ctx.workspacePath),
  }

  return applyDescriptionOverrides(tools, ctx.toolDescriptionOverrides)
}
