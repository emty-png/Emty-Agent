import type { ParsedSkillContent, SkillCommand, SkillDefinition, SkillResource, SkillSource } from './types'
import { toSlug, toTitleCase } from './utils'

export function parseSkillMarkdown(options: {
  id: string
  content: string
  source: SkillSource
  location: string
  fallbackTitle: string
  rootPath?: string
  resources?: SkillResource[]
}): SkillDefinition {
  const { id, content, source, location, fallbackTitle, rootPath, resources = [] } = options
  const parsed = parseSkillContent(content, fallbackTitle)

  const result: SkillDefinition = {
    id,
    name: parsed.name,
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    source,
    location,
    triggers: parsed.tags,
    resourceCount: resources.length,
    commands: parsed.commands,
    ...(rootPath ? { rootPath } : {}),
    content,
    resources,
  }

  if (parsed.whenToUse)
    result.whenToUse = parsed.whenToUse
  if (parsed.model)
    result.model = parsed.model
  if (parsed.allowedTools)
    result.allowedTools = parsed.allowedTools
  if (parsed.paths)
    result.paths = parsed.paths

  return result
}

export function parseSkillContent(content: string, fallbackTitle: string): ParsedSkillContent {
  const frontmatter = extractFrontmatter(content)
  const slug = frontmatter.name ?? toSlug(fallbackTitle)
  const title = extractTitle(content) ?? toTitleCase(frontmatter.name ?? fallbackTitle)
  const description = frontmatter.description ?? extractDescription(content) ?? extractFirstParagraph(content) ?? `Reusable guidance for ${title}.`
  const tags = frontmatter.tags.length > 0 ? frontmatter.tags : extractTags(content)
  const commands = frontmatter.commands.length > 0 ? frontmatter.commands : []

  const result: ParsedSkillContent = {
    name: slug,
    title,
    description,
    tags,
    commands,
  }

  if (frontmatter.whenToUse)
    result.whenToUse = frontmatter.whenToUse
  if (frontmatter.model)
    result.model = frontmatter.model
  if (frontmatter.allowedTools)
    result.allowedTools = frontmatter.allowedTools
  if (frontmatter.paths)
    result.paths = frontmatter.paths

  return result
}

export function extractTitle(content: string): string | null {
  for (const line of stripFrontmatter(content).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# '))
      return trimmed.slice(2).trim() || null
  }
  return null
}

export function extractDescription(content: string): string | null {
  return extractLabeledValue(stripFrontmatter(content), 'Description')
}

export function extractTags(content: string): string[] {
  const tagLine = extractLabeledValue(stripFrontmatter(content), 'Tags')
  if (!tagLine)
    return []

  return [...new Set(
    tagLine
      .split(',')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean),
  )]
}

export function extractLabeledValue(content: string, label: string): string | null {
  const prefix = `${label.toLowerCase()}:`
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim()
      return value || null
    }
  }
  return null
}

export function extractFrontmatter(content: string): { name: string | null; description: string | null; tags: string[]; commands: SkillCommand[]; whenToUse: string | null; model: string | null; allowedTools: string[] | null; paths: string[] | null } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---')
    return { name: null, description: null, tags: [], commands: [], whenToUse: null, model: null, allowedTools: null, paths: null }

  const values = new Map<string, string>()
  const commands: SkillCommand[] = []
  let inCommands = false
  let currentCommand: Partial<SkillCommand> = {}

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed === '---')
      break

    // Handle commands array
    if (inCommands) {
      const arrayItemMatch = trimmed.match(/^-\s+name:\s*(\S.*)$/)
      if (arrayItemMatch) {
        // Save previous command if any
        if (currentCommand.name)
          commands.push({ name: currentCommand.name, description: currentCommand.description ?? '' })
        currentCommand = { name: arrayItemMatch[1]!.trim() }
        continue
      }

      const descMatch = trimmed.match(/^description:\s*(\S.*)$/)
      if (descMatch && currentCommand.name) {
        currentCommand.description = descMatch[1]!.trim()
        continue
      }

      // If we hit a non-array line, save last command and exit commands mode
      if (currentCommand.name)
        commands.push({ name: currentCommand.name, description: currentCommand.description ?? '' })
      currentCommand = {}
      inCommands = false
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1)
      continue

    const key = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()

    if (key === 'commands' && !value) {
      inCommands = true
      continue
    }

    if (key && value)
      values.set(key, value)
  }

  // Save last command if we ended while still in commands
  if (inCommands && currentCommand.name)
    commands.push({ name: currentCommand.name, description: currentCommand.description ?? '' })

  const rawAllowedTools = values.get('allowed-tools')
  const rawPaths = values.get('paths')

  return {
    name: values.get('name') ?? null,
    description: values.get('description') ?? null,
    tags: values.get('tags')
      ?.split(',')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean) ?? [],
    commands,
    whenToUse: values.get('when_to_use') ?? null,
    model: values.get('model') ?? null,
    allowedTools: rawAllowedTools
      ? rawAllowedTools.split(',').map(t => t.trim()).filter(Boolean)
      : null,
    paths: rawPaths
      ? rawPaths.split(',').map(p => p.trim()).filter(Boolean)
      : null,
  }
}

export function stripFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---')
    return content

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---')
      return lines.slice(i + 1).join('\n')
  }

  return content
}

export function extractFirstParagraph(content: string): string | null {
  const lines = stripFrontmatter(content)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !/^Description:/i.test(line) && !/^Tags:/i.test(line))

  return lines[0] ?? null
}
