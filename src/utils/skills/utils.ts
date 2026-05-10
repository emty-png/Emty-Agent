import { MAX_INLINE_RESOURCE_CHARS, MAX_PROMPT_CHARS } from './constants'

export function trimSkillContent(content: string, maxChars = MAX_PROMPT_CHARS): string {
  if (content.length <= maxChars)
    return content

  const head = Math.floor(maxChars * 0.65)
  const tail = maxChars - head
  return `${content.slice(0, head).trimEnd()}\n\n[... skill content trimmed ...]\n\n${content.slice(-tail).trimStart()}`
}

export function trimInlineResource(content: string): string {
  if (content.length <= MAX_INLINE_RESOURCE_CHARS)
    return content

  const head = Math.floor(MAX_INLINE_RESOURCE_CHARS * 0.65)
  const tail = MAX_INLINE_RESOURCE_CHARS - head
  return `${content.slice(0, head).trimEnd()}\n\n[... resource trimmed ...]\n\n${content.slice(-tail).trimStart()}`
}

export function toTitleCase(value: string): string {
  return value
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(' ')
}

export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function joinSkillPath(basePath: string, ...parts: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  const normalizedBase = basePath.replace(/[\\/]+$/, '')
  const normalizedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''))
  return [normalizedBase, ...normalizedParts].filter(Boolean).join(separator)
}

export function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}
