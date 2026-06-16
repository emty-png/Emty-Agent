import { browserToolDisplayLabel } from '@/utils/tools/browser'
import { toolDisplayLabel as fsToolDisplayLabel } from '@/utils/tools/filesystem'
import { imageGenToolDisplayLabel } from '@/utils/tools/imageGen'
import { mcpToolDisplayLabel } from '@/utils/tools/mcp'
import { memoryToolDisplayLabel } from '@/utils/tools/memory'
import { questionsToolDisplayLabel } from '@/utils/tools/questions'
import { shellToolDisplayLabel } from '@/utils/tools/shell'
import { skillToolDisplayLabel } from '@/utils/tools/skills'
import { sleepToolDisplayLabel } from '@/utils/tools/sleep'
import { subAgentDisplayLabel } from '@/utils/tools/subagent'
import { taskToolDisplayLabel } from '@/utils/tools/todos'
import { webToolDisplayLabel } from '@/utils/tools/web'

/**
 * Returns a human-readable display label for any core or plugin tool.
 * Falls back to `Called {name}` if no specific formatter is defined.
 */
export function getCoreToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  const fsLabel = fsToolDisplayLabel(name, args)
  if (fsLabel !== `Called ${name}`)
    return fsLabel

  const shellLabel = shellToolDisplayLabel(name, args)
  if (shellLabel !== `Called ${name}`)
    return shellLabel

  const qLabel = questionsToolDisplayLabel(name, args)
  if (qLabel !== `Called ${name}`)
    return qLabel

  const skillLabel = skillToolDisplayLabel(name, args)
  if (skillLabel !== `Called ${name}`)
    return skillLabel

  const webLabel = webToolDisplayLabel(name, args)
  if (webLabel !== `Called ${name}`)
    return webLabel

  const browserLabel = browserToolDisplayLabel(name, args)
  if (browserLabel !== `Called ${name}`)
    return browserLabel

  const mcpLabel = mcpToolDisplayLabel(name)
  if (mcpLabel !== `Called ${name}`)
    return mcpLabel

  const todoLabel = taskToolDisplayLabel(name, args)
  if (todoLabel !== `Called ${name}`)
    return todoLabel

  const slpLabel = sleepToolDisplayLabel(name, args)
  if (slpLabel !== `Called ${name}`)
    return slpLabel

  const memoryLabel = memoryToolDisplayLabel(name, args)
  if (memoryLabel !== `Called ${name}`)
    return memoryLabel

  const imgLabel = imageGenToolDisplayLabel(name, args)
  if (imgLabel !== `Called ${name}`)
    return imgLabel

  return subAgentDisplayLabel(name, args)
}
