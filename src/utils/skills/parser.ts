import type { ParsedSkillContent, SkillDefinition, SkillResource, SkillSource } from './types'
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

  return {
    id,
    name: parsed.name,
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    source,
    location,
    triggers: parsed.tags,
    resourceCount: resources.length,
    ...(rootPath ? { rootPath } : {}),
    content,
    resources,
  }
}

export function parseSkillContent(content: string, fallbackTitle: string): ParsedSkillContent {
  const frontmatter = extractFrontmatter(content)
  const slug = frontmatter.name ?? toSlug(fallbackTitle)
  const title = extractTitle(content) ?? toTitleCase(frontmatter.name ?? fallbackTitle)
  const description = frontmatter.description ?? extractDescription(content) ?? extractFirstParagraph(content) ?? `Reusable guidance for ${title}.`
  const tags = frontmatter.tags.length > 0 ? frontmatter.tags : extractTags(content)

  return {
    name: slug,
    title,
    description,
    tags,
  }
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

export function extractFrontmatter(content: string): { name: string | null; description: string | null; tags: string[] } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---')
    return { name: null, description: null, tags: [] }

  const values = new Map<string, string>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '---')
      break

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1)
      continue

    const key = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    if (key && value)
      values.set(key, value)
  }

  return {
    name: values.get('name') ?? null,
    description: values.get('description') ?? null,
    tags: values.get('tags')
      ?.split(',')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean) ?? [],
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
