import { tool } from 'ai'
import { z } from 'zod'
import { getGlobalSkillsRoot, joinSkillPath, loadSkillDefinition, loadSkillResource, toSlug } from '@/utils/skills'

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

        const result: Record<string, unknown> = {
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

        if (skill.whenToUse)
          (result.skill as Record<string, unknown>).whenToUse = skill.whenToUse
        if (skill.model)
          (result.skill as Record<string, unknown>).model = skill.model
        if (skill.allowedTools)
          (result.skill as Record<string, unknown>).allowedTools = skill.allowedTools

        return result
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

    create_skill: tool({
      description: `\
Create a new skill package with a SKILL.md file and optional resource directories.

Use this when the user asks you to create, build, or scaffold a new skill.
The skill becomes available immediately after creation — no restart needed.

Scope:
- "project" (default) creates the skill in the current project's .emty/skills/ directory.
- "global" creates the skill in ~/.emty/skills/ so it is available across all projects.`,
      inputSchema: z.object({
        name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Name must be lowercase alphanumeric with hyphens, e.g. "api-review".').describe('Skill slug, e.g. "api-review".'),
        description: z.string().min(1).max(1024).describe('What the skill does — used for matching and display.'),
        tags: z.array(z.string().min(1)).min(1).describe('Keywords for skill matching, e.g. ["api", "review", "rest"].'),
        content: z.string().min(1).describe('The SKILL.md body — instructions for the agent to follow when this skill is loaded. Do NOT include YAML frontmatter; it is generated automatically.'),
        commands: z.array(z.object({
          name: z.string().min(1).max(32).describe('Command slug, e.g. "commit".'),
          description: z.string().min(1).max(256).describe('What this command does.'),
        })).optional().describe('Optional list of slash commands this skill exposes. If omitted, the skill is invoked as /skill-<name>.'),
        scope: z.enum(['project', 'global']).optional().describe('Where to create the skill. Defaults to "project".'),
      }),
      execute: async ({ name, description, tags, content, commands, scope }) => {
        const slug = toSlug(name)
        if (!slug)
          throw new Error('Invalid skill name.')

        const targetScope = scope ?? 'project'
        let rootPath: string

        if (targetScope === 'global') {
          const globalRoot = await getGlobalSkillsRoot()
          if (!globalRoot)
            throw new Error('Could not determine global skills directory (~/.emty/skills/).')
          rootPath = joinSkillPath(globalRoot, slug)
        }
        else {
          if (!projectPath)
            throw new Error('No project path available — cannot create a project-level skill. Use scope "global" instead.')
          rootPath = joinSkillPath(projectPath, '.emty', 'skills', slug)
        }

        // Build SKILL.md content with frontmatter
        const frontmatterLines = [
          '---',
          `name: ${slug}`,
          `description: ${description}`,
          `tags: ${tags.join(', ')}`,
        ]
        if (commands && commands.length > 0) {
          frontmatterLines.push('commands:')
          for (const cmd of commands) {
            frontmatterLines.push(`  - name: ${cmd.name}`)
            frontmatterLines.push(`    description: ${cmd.description}`)
          }
        }
        frontmatterLines.push('---')
        const skillContent = `${frontmatterLines.join('\n')}\n\n${content}`

        // Create directories and write SKILL.md
        const { mkdir, writeTextFile } = await import('@/utils/tauriFs')
        await mkdir(rootPath, { recursive: true })

        for (const folder of ['scripts', 'references', 'assets']) {
          await mkdir(joinSkillPath(rootPath, folder), { recursive: true }).catch(() => {})
        }

        await writeTextFile(joinSkillPath(rootPath, 'SKILL.md'), skillContent)

        const skillId = `${targetScope}:${slug}`
        const location = targetScope === 'global'
          ? `~/.emty/skills/${slug}/SKILL.md`
          : `.emty/skills/${slug}/SKILL.md`

        return {
          skill: {
            id: skillId,
            name: slug,
            description,
            tags,
            source: targetScope,
            location,
            commands: commands ?? [],
          },
          message: `Skill "${slug}" created at ${location}`,
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

  if (toolName === 'create_skill') {
    const name = typeof args.name === 'string' ? args.name : 'skill'
    return `Created skill: ${truncate(name)}`
  }

  return `Called ${toolName}`
}
