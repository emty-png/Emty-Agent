import { tool } from 'ai'
import { z } from 'zod'
import { loadSkillDefinition, loadSkillResource } from '@/utils/skills'

function truncate(value: string, max = 56): string {
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed
}

export function createSkillTools(projectPath: string | null) {
  return {
    load_skill: tool({
      description: `\
Load a skill package on demand when the current task matches one of the available skills listed in the system prompt.

Use this BEFORE following skill-specific instructions. The result includes:
- the skill metadata
- the full SKILL.md body
- any packaged resources under scripts/, references/, or assets/

Do not call this speculatively for every task. Only load the skill that clearly matches the user's request.`,
      inputSchema: z.object({
        skill_id: z.string().min(1).describe('Exact skill id from the available skills list, for example "builtin:frontend-design".'),
      }),
      execute: async ({ skill_id }) => {
        const skill = await loadSkillDefinition(skill_id, projectPath)
        if (!skill)
          throw new Error(`Skill "${skill_id}" was not found.`)

        return {
          skill: {
            id: skill.id,
            name: skill.name,
            title: skill.title,
            description: skill.description,
            source: skill.source,
            location: skill.location,
            tags: skill.tags,
          },
          skillMarkdown: skill.content,
          resources: skill.resources,
        }
      },
    }),

    load_skill_resource: tool({
      description: `\
Load a specific resource from a previously loaded skill package.

Use this only when SKILL.md points you to a file in scripts/, references/, or assets/.
Text resources are returned inline. Non-text assets return their path metadata only.`,
      inputSchema: z.object({
        skill_id: z.string().min(1).describe('Exact skill id from the available skills list.'),
        resource_path: z.string().min(1).describe('Resource path relative to the skill root, such as "references/aws.md".'),
      }),
      execute: async ({ skill_id, resource_path }) => {
        const resource = await loadSkillResource(skill_id, resource_path, projectPath)
        if (!resource)
          throw new Error(`Resource "${resource_path}" was not found in skill "${skill_id}".`)

        return {
          resource: {
            path: resource.path,
            kind: resource.kind,
            location: resource.location,
            textLoadable: resource.textLoadable,
            ...(resource.absolutePath ? { absolutePath: resource.absolutePath } : {}),
          },
          ...(resource.content ? { content: resource.content } : {}),
        }
      },
    }),
  }
}

export function skillToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === 'load_skill') {
    const skillId = typeof args.skill_id === 'string' ? args.skill_id : 'skill'
    return `Loaded skill: ${truncate(skillId)}`
  }

  if (toolName === 'load_skill_resource') {
    const resourcePath = typeof args.resource_path === 'string' ? args.resource_path : 'resource'
    return `Loaded skill resource: ${truncate(resourcePath)}`
  }

  return `Called ${toolName}`
}
