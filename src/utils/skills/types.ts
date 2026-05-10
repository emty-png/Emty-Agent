export type SkillSource = 'builtin' | 'project'
export type SkillResourceKind = 'script' | 'reference' | 'asset' | 'other'

export interface SkillMetadata {
  id: string
  name: string
  title: string
  description: string
  tags: string[]
  source: SkillSource
  location: string
  triggers: string[]
  resourceCount: number
  rootPath?: string
}

export interface SkillResource {
  path: string
  kind: SkillResourceKind
  location: string
  textLoadable: boolean
}

export interface SkillDefinition extends SkillMetadata {
  content: string
  resources: SkillResource[]
}

export interface LoadedSkillResource extends SkillResource {
  content?: string
  absolutePath?: string
}

export interface SelectedSkill {
  skill: SkillMetadata
  matches: string[]
  score: number
}

export interface ParsedSkillContent {
  name: string
  title: string
  description: string
  tags: string[]
}
