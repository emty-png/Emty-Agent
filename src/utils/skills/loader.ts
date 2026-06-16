import type { LoadedSkillResource, SkillDefinition, SkillMetadata, SkillResource, SkillResourceKind } from './types'
import type { DirEntry } from '@/utils/tauriFs'
import { TEXT_RESOURCE_EXTENSIONS } from './constants'
import { parseSkillMarkdown } from './parser'
import { getGlobalSkillsRoot, joinSkillPath, normalizeRelativePath, toTitleCase, trimInlineResource } from './utils'

const BUILTIN_SKILL_FILES = import.meta.glob<string>(
  '/src/skills/builtin/*/SKILL.md',
  { eager: true, query: '?raw', import: 'default' },
)

const BUILTIN_SKILL_RESOURCE_FILES = import.meta.glob<string>(
  '/src/skills/builtin/**/*',
  { eager: true, query: '?raw', import: 'default' },
)

export const BUILTIN_SKILLS = buildBuiltinSkillCatalog()
export const BUILTIN_SKILL_METADATA = BUILTIN_SKILLS.map(toMetadata)

export function isSkillEnabled(id: string, disabledSkillIds: string[]): boolean {
  return !disabledSkillIds.includes(id)
}

export async function discoverProjectSkills(projectPath: string | null): Promise<SkillMetadata[]> {
  if (!projectPath)
    return []

  const { readDir, readTextFile } = await import('@/utils/tauriFs')
  const skillsRoot = joinSkillPath(projectPath, '.emty', 'skills')

  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(skillsRoot)
  }
  catch {
    return []
  }

  const skills: SkillMetadata[] = []

  for (const entry of entries) {
    if (!entry.isDirectory || !entry.name)
      continue

    const rootPath = joinSkillPath(skillsRoot, entry.name)
    const skillPath = joinSkillPath(rootPath, 'SKILL.md')

    let content: string
    try {
      content = await readTextFile(skillPath)
    }
    catch {
      continue
    }

    const resources = await listProjectSkillResources(rootPath)
    skills.push(toMetadata(parseSkillMarkdown({
      id: `project:${entry.name}`,
      content,
      source: 'project',
      location: `.emty/skills/${entry.name}/SKILL.md`,
      fallbackTitle: toTitleCase(entry.name),
      rootPath,
      resources,
    })))
  }

  return skills.sort((a, b) => a.title.localeCompare(b.title))
}

export async function discoverGlobalSkills(): Promise<SkillMetadata[]> {
  const skillsRoot = await getGlobalSkillsRoot()
  if (!skillsRoot)
    return []

  const { readDir, readTextFile } = await import('@/utils/tauriFs')

  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(skillsRoot)
  }
  catch {
    return []
  }

  const skills: SkillMetadata[] = []

  for (const entry of entries) {
    if (!entry.isDirectory || !entry.name)
      continue

    const rootPath = joinSkillPath(skillsRoot, entry.name)
    const skillPath = joinSkillPath(rootPath, 'SKILL.md')

    let content: string
    try {
      content = await readTextFile(skillPath)
    }
    catch {
      continue
    }

    const resources = await listProjectSkillResources(rootPath)
    skills.push(toMetadata(parseSkillMarkdown({
      id: `global:${entry.name}`,
      content,
      source: 'global',
      location: `~/.emty/skills/${entry.name}/SKILL.md`,
      fallbackTitle: toTitleCase(entry.name),
      rootPath,
      resources,
    })))
  }

  return skills.sort((a, b) => a.title.localeCompare(b.title))
}

export async function getEnabledSkills(
  projectPath: string | null,
  disabledSkillIds: string[],
): Promise<SkillMetadata[]> {
  const [globalSkills, projectSkills] = await Promise.all([
    discoverGlobalSkills(),
    discoverProjectSkills(projectPath),
  ])
  // Project skills override global skills on name conflict
  const globalByName = new Map(globalSkills.map(s => [s.name, s]))
  for (const skill of projectSkills)
    globalByName.delete(skill.name)

  return [...BUILTIN_SKILL_METADATA, ...globalByName.values(), ...projectSkills]
    .filter(skill => isSkillEnabled(skill.id, disabledSkillIds))
}

export async function loadSkillDefinition(
  skillId: string,
  projectPath: string | null,
): Promise<SkillDefinition | null> {
  const builtinSkill = BUILTIN_SKILLS.find(skill => skill.id === skillId)
  if (builtinSkill)
    return builtinSkill

  // Global skill
  if (skillId.startsWith('global:')) {
    const slug = skillId.slice('global:'.length)
    if (!slug)
      return null

    const skillsRoot = await getGlobalSkillsRoot()
    if (!skillsRoot)
      return null

    const { readTextFile } = await import('@/utils/tauriFs')
    const rootPath = joinSkillPath(skillsRoot, slug)
    const skillPath = joinSkillPath(rootPath, 'SKILL.md')

    let content: string
    try {
      content = await readTextFile(skillPath)
    }
    catch {
      return null
    }

    const resources = await listProjectSkillResources(rootPath)
    return parseSkillMarkdown({
      id: skillId,
      content,
      source: 'global',
      location: `~/.emty/skills/${slug}/SKILL.md`,
      fallbackTitle: toTitleCase(slug),
      rootPath,
      resources,
    })
  }

  // Project skill
  if (!skillId.startsWith('project:') || !projectPath)
    return null

  const slug = skillId.slice('project:'.length)
  if (!slug)
    return null

  const { readTextFile } = await import('@/utils/tauriFs')
  const rootPath = joinSkillPath(projectPath, '.emty', 'skills', slug)
  const skillPath = joinSkillPath(rootPath, 'SKILL.md')

  let content: string
  try {
    content = await readTextFile(skillPath)
  }
  catch {
    return null
  }

  const resources = await listProjectSkillResources(rootPath)
  return parseSkillMarkdown({
    id: skillId,
    content,
    source: 'project',
    location: `.emty/skills/${slug}/SKILL.md`,
    fallbackTitle: toTitleCase(slug),
    rootPath,
    resources,
  })
}

export async function loadSkillResource(
  skillId: string,
  resourcePath: string,
  projectPath: string | null,
): Promise<LoadedSkillResource | null> {
  const skill = await loadSkillDefinition(skillId, projectPath)
  if (!skill)
    return null

  const normalizedResourcePath = normalizeRelativePath(resourcePath)
  const resource = skill.resources.find(item => item.path === normalizedResourcePath)
  if (!resource)
    return null

  if (skill.source === 'builtin') {
    const key = `/src/skills/builtin/${skill.name}/${normalizedResourcePath}`
    const content = BUILTIN_SKILL_RESOURCE_FILES[key]
    return {
      ...resource,
      ...(resource.textLoadable && typeof content === 'string'
        ? { content: trimInlineResource(content) }
        : {}),
    }
  }

  if (!skill.rootPath)
    return null

  const absolutePath = joinSkillPath(skill.rootPath, normalizedResourcePath)
  if (!resource.textLoadable) {
    return {
      ...resource,
      absolutePath,
    }
  }

  const { readTextFile } = await import('@/utils/tauriFs')
  try {
    const content = await readTextFile(absolutePath)
    return {
      ...resource,
      absolutePath,
      content: trimInlineResource(content),
    }
  }
  catch {
    return null
  }
}

function buildBuiltinSkillCatalog(): SkillDefinition[] {
  const skills: SkillDefinition[] = []

  for (const [path, content] of Object.entries(BUILTIN_SKILL_FILES)) {
    const match = path.match(/^\/src\/skills\/builtin\/([^/]+)\/SKILL\.md$/)
    if (!match)
      continue

    const slug = match[1]!
    const resources = listBuiltinSkillResources(slug)
    skills.push(parseSkillMarkdown({
      id: `builtin:${slug}`,
      content,
      source: 'builtin',
      location: `src/skills/builtin/${slug}/SKILL.md`,
      fallbackTitle: toTitleCase(slug),
      resources,
    }))
  }

  return skills.sort((a, b) => a.title.localeCompare(b.title))
}

function listBuiltinSkillResources(slug: string): SkillResource[] {
  const prefix = `/src/skills/builtin/${slug}/`

  return Object.keys(BUILTIN_SKILL_RESOURCE_FILES)
    .filter(path => path.startsWith(prefix) && !path.endsWith('/SKILL.md'))
    .map(path => {
      const relativePath = normalizeRelativePath(path.slice(prefix.length))
      return {
        path: relativePath,
        kind: classifyResource(relativePath),
        location: `src/skills/builtin/${slug}/${relativePath}`,
        textLoadable: isTextResource(relativePath),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function listProjectSkillResources(rootPath: string): Promise<SkillResource[]> {
  const { readDir } = await import('@/utils/tauriFs')
  const resources: SkillResource[] = []

  for (const folder of ['scripts', 'references', 'assets']) {
    const folderPath = joinSkillPath(rootPath, folder)

    let entries: Awaited<ReturnType<typeof readDir>>
    try {
      entries = await readDir(folderPath)
    }
    catch {
      continue
    }

    await collectProjectResources(entries, folderPath, folder, resources)
  }

  return resources.sort((a, b) => a.path.localeCompare(b.path))
}

async function collectProjectResources(
  entries: DirEntry[],
  currentPath: string,
  relativePrefix: string,
  resources: SkillResource[],
): Promise<void> {
  const { readDir } = await import('@/utils/tauriFs')

  for (const entry of entries) {
    if (!entry.name)
      continue

    const absolutePath = joinSkillPath(currentPath, entry.name)
    const resourcePath = normalizeRelativePath(`${relativePrefix}/${entry.name}`)

    if (entry.isDirectory) {
      let childEntries: Awaited<ReturnType<typeof readDir>>
      try {
        childEntries = await readDir(absolutePath)
      }
      catch {
        continue
      }
      await collectProjectResources(childEntries, absolutePath, resourcePath, resources)
      continue
    }

    resources.push({
      path: resourcePath,
      kind: classifyResource(resourcePath),
      location: resourcePath,
      textLoadable: isTextResource(resourcePath),
    })
  }
}

function toMetadata(skill: SkillDefinition): SkillMetadata {
  const { content: _content, resources: _resources, ...metadata } = skill
  return metadata
}

function classifyResource(path: string): SkillResourceKind {
  if (path.startsWith('scripts/'))
    return 'script'
  if (path.startsWith('references/'))
    return 'reference'
  if (path.startsWith('assets/'))
    return 'asset'
  return 'other'
}

function isTextResource(path: string): boolean {
  const lower = path.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex === -1)
    return false
  return TEXT_RESOURCE_EXTENSIONS.has(lower.slice(dotIndex))
}
