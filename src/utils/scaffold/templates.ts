import { astroTemplate } from './templates/astro'
import { bunTemplate } from './templates/bun'
import { docusaurusTemplate } from './templates/docusaurus'
import { electronTemplate } from './templates/electron'
import { elysiaTemplate } from './templates/elysia'
import { fastifyTemplate } from './templates/fastify'
import { honoTemplate } from './templates/hono'
import { nextjsTemplate } from './templates/nextjs'
import { nuxtTemplate } from './templates/nuxt'
import { remixTemplate } from './templates/remix'
import { sveltekitTemplate } from './templates/sveltekit'
import { tanstackStartTemplate } from './templates/tanstack-start'
import { tauriTemplate } from './templates/tauri'
import { tsdownTemplate } from './templates/tsdown'
import { viteTemplate } from './templates/vite'

export type Category = 'fullstack' | 'desktop' | 'backend' | 'library' | 'docs'

export type ScaffoldOptions = Record<string, string | boolean | number | string[] | undefined>

export interface ScaffoldOptionChoice {
  label: string
  value: string
  icon?: string
}

export interface ScaffoldOption {
  id: string
  label: string
  type: 'toggle' | 'select' | 'text' | 'multiselect'
  default: boolean | string | string[]
  choices?: ScaffoldOptionChoice[]
}

export interface ScaffoldTemplate {
  id: string
  name: string
  description: string
  category: Category
  iconColor: string
  command: string
  options: ScaffoldOption[]
  args: (projectName: string, opts: ScaffoldOptions) => string[]
  websiteUrl?: string
  installsAutomatically?: boolean
}

export const scaffoldTemplates: ScaffoldTemplate[] = [
  viteTemplate,
  nextjsTemplate,
  nuxtTemplate,
  remixTemplate,
  tanstackStartTemplate,
  astroTemplate,
  tauriTemplate,
  honoTemplate,
  fastifyTemplate,
  elysiaTemplate,
  sveltekitTemplate,
  docusaurusTemplate,
  tsdownTemplate,
  bunTemplate,
  electronTemplate,
]

export const scaffoldCategories: { id: Category; label: string }[] = [
  { id: 'fullstack', label: 'Full-Stack' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'backend', label: 'Backend' },
  { id: 'library', label: 'Library / Tooling' },
  { id: 'docs', label: 'Docs / Static' },
]

export function getTemplatesForCategory(category: Category | 'all') {
  return category === 'all'
    ? scaffoldTemplates
    : scaffoldTemplates.filter(template => template.category === category)
}

export function getTemplateById(id: string) {
  return scaffoldTemplates.find(template => template.id === id)
}

export function getDefaultOptions(template: ScaffoldTemplate): ScaffoldOptions {
  const result: ScaffoldOptions = {}
  for (const option of template.options)
    result[option.id] = option.default
  return result
}
