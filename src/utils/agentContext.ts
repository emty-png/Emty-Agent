import type { SelectedSkill, SkillDefinition, SkillMetadata } from '@/utils/skills'
import { getEnabledSkills, loadSkillDefinition, selectRelevantSkills, trimSkillContent } from '@/utils/skills'

export interface AutoContextSettings {
  enabled: boolean
}

export interface AgentPromptBuilderOptions {
  basePrompt: string
  projectPath: string | null
  requestText: string
  autoContext: AutoContextSettings
  disabledSkillIds: string[]
  supportsToolCalls: boolean
}

export interface LoadedContextFile {
  filename: 'AGENTS.md' | 'DESIGN.md'
  content: string
  path: string
}

export interface AgentPromptBuildResult {
  prompt: string
  promptFingerprint: string
  contextFiles: LoadedContextFile[]
  availableSkills: SkillMetadata[]
  preloadedSkills: Array<SelectedSkill & { definition: SkillDefinition }>
}

const MAX_CONTEXT_CHARS = 18_000

export async function buildAgentSystemPrompt(
  options: AgentPromptBuilderOptions,
): Promise<AgentPromptBuildResult> {
  const { basePrompt, projectPath, requestText, autoContext, disabledSkillIds, supportsToolCalls } = options

  const [contextFiles, enabledSkills] = await Promise.all([
    autoContext.enabled ? loadProjectContextFiles(projectPath) : Promise.resolve([]),
    getEnabledSkills(projectPath, disabledSkillIds),
  ])

  const preloadedSkills = supportsToolCalls
    ? []
    : await loadPreloadedSkills(selectRelevantSkills(enabledSkills, requestText), projectPath)

  const prompt = composeAgentPrompt({
    basePrompt,
    contextFiles,
    availableSkills: enabledSkills,
    preloadedSkills,
    supportsToolCalls,
  })

  return {
    prompt,
    promptFingerprint: hashPrompt(prompt),
    contextFiles,
    availableSkills: enabledSkills,
    preloadedSkills,
  }
}

export function composeAgentPrompt(options: {
  basePrompt: string
  contextFiles: LoadedContextFile[]
  availableSkills: SkillMetadata[]
  preloadedSkills: Array<SelectedSkill & { definition: SkillDefinition }>
  supportsToolCalls: boolean
}): string {
  const { basePrompt, contextFiles, availableSkills, preloadedSkills, supportsToolCalls } = options
  const sections = [basePrompt]

  if (contextFiles.length > 0) {
    sections.push(`## Auto-Loaded Project Context
The following repository files were loaded automatically because project context loading is enabled.
Follow AGENTS.md instructions for repository-specific coding behavior.
Use DESIGN.md to preserve the intended UI system when the task touches the interface.`)

    for (const file of contextFiles) {
      sections.push(`### ${file.filename}
Path: \`${file.path}\`

${trimContextContent(file.content)}`)
    }
  }

  if (availableSkills.length > 0) {
    sections.push(buildSkillCatalogSection(availableSkills, supportsToolCalls))
  }

  if (preloadedSkills.length > 0) {
    sections.push(`## Preloaded Skills
The current model cannot use tools, so the most likely matching skills were preloaded automatically.
Apply them only when they are relevant to the request.`)

    for (const { skill, matches, definition } of preloadedSkills) {
      sections.push(`### ${skill.title}
Source: ${skill.location}
Matched request terms: ${matches.join(', ')}

${trimSkillContent(definition.content)}`)
    }
  }

  return sections.join('\n\n')
}

function buildSkillCatalogSection(skills: SkillMetadata[], supportsToolCalls: boolean): string {
  const lines = [
    '## Skill System',
    'Skills are modular instruction packages. Only skill metadata is loaded by default.',
  ]

  if (supportsToolCalls) {
    lines.push('When a task matches a skill below, call `load_skill` before following any skill-specific workflow.')
    lines.push('If that SKILL.md references files in `scripts/`, `references/`, or `assets/`, call `load_skill_resource` only for the specific file you need.')
  }
  else {
    lines.push('This model cannot load skills on demand, so matching skills may be preloaded automatically when needed.')
  }

  lines.push('<available_skills>')

  for (const skill of skills) {
    lines.push('  <skill>')
    lines.push(`    <id>${escapeXml(skill.id)}</id>`)
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <title>${escapeXml(skill.title)}</title>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.location)}</location>`)
    lines.push(`    <source>${escapeXml(skill.source)}</source>`)
    lines.push(`    <resource_count>${skill.resourceCount}</resource_count>`)
    lines.push('  </skill>')
  }

  lines.push('</available_skills>')
  return lines.join('\n')
}

async function loadProjectContextFiles(projectPath: string | null): Promise<LoadedContextFile[]> {
  if (!projectPath)
    return []

  const { readTextFile } = await import('@/utils/tauriFs')

  const targets: Array<LoadedContextFile['filename']> = ['AGENTS.md', 'DESIGN.md']
  const files: LoadedContextFile[] = []

  for (const filename of targets) {
    const path = joinProjectPath(projectPath, filename)

    let content: string
    try {
      content = await readTextFile(path)
    }
    catch {
      continue
    }

    if (!content.trim())
      continue

    files.push({
      filename,
      path,
      content,
    })
  }

  return files
}

function joinProjectPath(basePath: string, ...parts: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  const normalizedBase = basePath.replace(/[\\/]+$/, '')
  const normalizedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''))
  return [normalizedBase, ...normalizedParts].filter(Boolean).join(separator)
}

function trimContextContent(content: string, maxChars = MAX_CONTEXT_CHARS): string {
  if (content.length <= maxChars)
    return content

  const head = Math.floor(maxChars * 0.7)
  const tail = maxChars - head
  return `${content.slice(0, head).trimEnd()}\n\n[... context trimmed ...]\n\n${content.slice(-tail).trimStart()}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function hashPrompt(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++)
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  return hash.toString(16)
}

async function loadPreloadedSkills(
  matches: SelectedSkill[],
  projectPath: string | null,
): Promise<Array<SelectedSkill & { definition: SkillDefinition }>> {
  const loaded = await Promise.all(matches.map(async match => {
    const definition = await loadSkillDefinition(match.skill.id, projectPath)
    return definition ? { ...match, definition } : null
  }))

  return loaded.filter((match): match is SelectedSkill & { definition: SkillDefinition } => match != null)
}
