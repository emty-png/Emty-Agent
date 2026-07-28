import { browserToolDisplayLabel } from '@/utils/tools/browser'
import { designProjectToolDisplayLabel } from '@/utils/tools/designProject'
import { toolDisplayLabel as fsToolDisplayLabel } from '@/utils/tools/filesystem'
import { imageGenToolDisplayLabel } from '@/utils/tools/imageGen'
import { mcpToolDisplayLabel } from '@/utils/tools/mcp'
import { memoryToolDisplayLabel } from '@/utils/tools/memory'
import { planToolDisplayLabel } from '@/utils/tools/plan'
import { questionsToolDisplayLabel } from '@/utils/tools/questions'
import { shellToolDisplayLabel } from '@/utils/tools/shell'
import { skillToolDisplayLabel } from '@/utils/tools/skills'
import { sleepToolDisplayLabel } from '@/utils/tools/sleep'
import { subAgentDisplayLabel } from '@/utils/tools/subagent'
import { taskToolDisplayLabel } from '@/utils/tools/todos'
import { webToolDisplayLabel } from '@/utils/tools/web'

type LabelResolver = (name: string, args: Record<string, unknown>) => string | null

// Each resolver returns null when it doesn't own the tool name.
// Wrap resolvers that use the 'Called {name}' sentinel into null-returning adapters.
function adapt(resolver: (name: string, args: Record<string, unknown>) => string): LabelResolver {
  return (name, args) => {
    const label = resolver(name, args)
    return label !== `Called ${name}` ? label : null
  }
}

const RESOLVERS: LabelResolver[] = [
  adapt(fsToolDisplayLabel),
  adapt(shellToolDisplayLabel),
  adapt(questionsToolDisplayLabel),
  adapt(planToolDisplayLabel),
  adapt(skillToolDisplayLabel),
  adapt(webToolDisplayLabel),
  adapt(browserToolDisplayLabel),
  name => { const l = mcpToolDisplayLabel(name); return l !== `Called ${name}` ? l : null },
  adapt(taskToolDisplayLabel),
  adapt(sleepToolDisplayLabel),
  adapt(memoryToolDisplayLabel),
  adapt(imageGenToolDisplayLabel),
  adapt(subAgentDisplayLabel),
  adapt(designProjectToolDisplayLabel),
]

export function getCoreToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  for (const resolve of RESOLVERS) {
    const label = resolve(name, args)
    if (label !== null)
      return label
  }
  return `Called ${name}`
}
