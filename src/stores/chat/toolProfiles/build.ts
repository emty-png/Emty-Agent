import type { ToolRegistryContext } from '../toolRegistry'
import type { ToolSet } from '@/utils/ai'
import { createBrowserTools } from '@/utils/tools/browser'
import { createFilesystemTools } from '@/utils/tools/filesystem'
import { createImageGenTools } from '@/utils/tools/imageGen'
import { createMcpTools } from '@/utils/tools/mcp'
import { createMemoryTools } from '@/utils/tools/memory'
import { createPlanTools } from '@/utils/tools/plan'
import { createQuestionsTool } from '@/utils/tools/questions'
import { createShellTools } from '@/utils/tools/shell'
import { createSkillTools } from '@/utils/tools/skills'
import { createSleepTool } from '@/utils/tools/sleep'
import { createSpawnSubAgentTool } from '@/utils/tools/subagent'
import { createTaskTools } from '@/utils/tools/todos'
import { createWebTools } from '@/utils/tools/web'

export async function buildProfile(ctx: ToolRegistryContext): Promise<ToolSet> {
  const mcpTools = await createMcpTools(ctx.mcpServers)

  const planTools = createPlanTools({
    conversationId: ctx.conversationId,
    onPlanCreated: event => {
      window.dispatchEvent(new CustomEvent('emty:plan-created', { detail: { ...event, tabId: ctx.tabId } }))
    },
  })

  // task tools callback destructuring wrapper
  const rawTaskTools = createTaskTools(ctx.todoCallback ?? (() => {}), ctx.initialTasks)
  const { reset: _resetTasks, ...taskTools } = rawTaskTools

  return {
    ...planTools,
    ask_questions: createQuestionsTool(ctx.questionCallback ?? (() => {})),
    ...taskTools,
    sleep: createSleepTool(),
    ...createMemoryTools(ctx.memoryEnabled, ctx.workspaceMeta),
    ...createSkillTools(ctx.workspacePath),
    spawn_subagent: createSpawnSubAgentTool(
      ctx.subAgentSpawnCallback ?? (async () => ({ tabId: '', completionPromise: Promise.resolve({ text: '', status: 'error' as const }) })),
      ctx.subAgentAbortCallback ?? (() => {}),
    ),
    ...mcpTools,
    ...createWebTools(),
    ...createBrowserTools(ctx.tabId),
    ...createImageGenTools(),
    ...(ctx.workspacePath
      ? {
          ...createFilesystemTools(ctx.workspacePath, ctx.snapshotCallback, ctx.readRegistry),
          ...createShellTools(ctx.workspacePath, ctx.osInfo?.shell, ctx.coAuthor, ctx.runtimeEvents, ctx.tabId),
        }
      : {}),
  }
}
