import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type BuiltInThemeId = 'abyss' | 'terracotta' | 'chocolate' | 'frost' | 'moss'
export type ThemeId = BuiltInThemeId | (string & {})

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
  accent: string
  bg: string
}

export interface ThemeOverrides {
  colors: Record<string, string>
  radius: Record<string, number>
}

export interface CustomTheme {
  id: string
  name: string
  tagline: string
  accent: string
  bg: string
  variables: Record<string, string>
}

export const THEMES: ThemeMeta[] = [
  { id: 'abyss', name: 'Abyss', tagline: 'Pure black · Vibrant cyan', accent: '#00e5ff', bg: '#000000' },
  { id: 'terracotta', name: 'Terracotta', tagline: 'Cream base · Clay accents', accent: '#c05a3c', bg: '#fdf8f3' },
  { id: 'chocolate', name: 'Chocolate', tagline: 'Rich dark · Golden amber', accent: '#e8a849', bg: '#0e0907' },
  { id: 'frost', name: 'Frost', tagline: 'Midnight navy · Lavender', accent: '#a78bfa', bg: '#0a0e14' },
  { id: 'moss', name: 'Moss', tagline: 'Deep forest · Sage green', accent: '#8cc08c', bg: '#0a0f0a' },
]

/** Key color variables shown in the basic editor */
export const KEY_COLOR_VARS = [
  { key: '--color-bg-base', label: 'Background' },
  { key: '--color-accent', label: 'Accent' },
  { key: '--color-text-primary', label: 'Text' },
  { key: '--color-border-mid', label: 'Border' },
] as const

/** All color variables grouped for the advanced editor */
export const ALL_COLOR_VARS = [
  {
    group: 'Backgrounds',
    vars: [
      { key: '--color-bg-base', label: 'Base' },
      { key: '--color-bg-surface', label: 'Surface' },
      { key: '--color-bg-card', label: 'Card' },
      { key: '--color-bg-hover', label: 'Hover' },
      { key: '--color-bg-elevated', label: 'Elevated' },
    ],
  },
  {
    group: 'Accent',
    vars: [
      { key: '--color-accent-dim', label: 'Dim' },
      { key: '--color-accent', label: 'Accent' },
      { key: '--color-accent-bright', label: 'Bright' },
      { key: '--color-accent-text', label: 'Text' },
    ],
  },
  {
    group: 'Text',
    vars: [
      { key: '--color-text-primary', label: 'Primary' },
      { key: '--color-text-secondary', label: 'Secondary' },
      { key: '--color-text-tertiary', label: 'Tertiary' },
      { key: '--color-text-dim', label: 'Dim' },
      { key: '--color-code', label: 'Code' },
    ],
  },
  {
    group: 'Borders',
    vars: [
      { key: '--color-border-subtle', label: 'Subtle' },
      { key: '--color-border-mid', label: 'Mid' },
      { key: '--color-border-bright', label: 'Bright' },
    ],
  },
  {
    group: 'Semantic',
    vars: [
      { key: '--color-info', label: 'Info' },
      { key: '--color-success', label: 'Success' },
      { key: '--color-warning', label: 'Warning' },
      { key: '--color-danger', label: 'Danger' },
    ],
  },
] as const

export const DEFAULT_RADIUS: Record<string, number> = {
  '--radius-sm': 4,
  '--radius-md': 6,
  '--radius-lg': 8,
}

const RADIUS_VARS = Object.keys(DEFAULT_RADIUS)

function getThemeDefaults(id: ThemeId): Record<string, string> {
  const el = document.documentElement
  el.setAttribute('data-theme', id)
  const computed = getComputedStyle(el)
  const vars: Record<string, string> = {}
  for (const group of ALL_COLOR_VARS) {
    for (const v of group.vars) {
      vars[v.key] = computed.getPropertyValue(v.key).trim()
    }
  }
  for (const key of RADIUS_VARS) {
    vars[key] = computed.getPropertyValue(key).trim()
  }
  return vars
}

function applyOverrides(overrides: ThemeOverrides) {
  const el = document.documentElement
  for (const [key, value] of Object.entries(overrides.colors)) {
    el.style.setProperty(key, value)
  }
  for (const [key, value] of Object.entries(overrides.radius)) {
    el.style.setProperty(key, `${value}px`)
  }
}

function clearOverrides() {
  const el = document.documentElement
  const toRemove: string[] = []
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i]
    if (prop?.startsWith('--'))
      toRemove.push(prop)
  }
  for (const prop of toRemove) {
    el.style.removeProperty(prop)
  }
}

export const useThemeStore = defineStore(
  'theme',
  () => {
    const activeTheme = ref<ThemeId>('abyss')
    const showLandingArt = ref(true)
    const activeIllustration = ref('illustration_1')
    const customThemes = ref<CustomTheme[]>([])
    const themeOverrides = ref<Record<string, ThemeOverrides>>({})
    const editingTheme = ref<ThemeId | null>(null)

    function applyTheme(id: ThemeId) {
      document.documentElement.setAttribute('data-theme', id)
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (meta) {
        const custom = customThemes.value.find(t => t.id === id)
        const builtIn = THEMES.find(t => t.id === id)
        meta.content = custom?.bg || builtIn?.bg || '#000000'
      }
      clearOverrides()
      const custom = customThemes.value.find(t => t.id === id)
      if (custom?.variables) {
        for (const [key, value] of Object.entries(custom.variables)) {
          document.documentElement.style.setProperty(key, value)
        }
      }
      const overrides = themeOverrides.value[id]
      if (overrides) {
        applyOverrides(overrides)
      }
    }

    function setTheme(id: ThemeId) {
      activeTheme.value = id
      applyTheme(id)
    }

    function setColorOverride(varKey: string, hex: string) {
      const id = activeTheme.value
      if (!themeOverrides.value[id]) {
        themeOverrides.value[id] = { colors: {}, radius: {} }
      }
      themeOverrides.value[id].colors[varKey] = hex
      document.documentElement.style.setProperty(varKey, hex)
    }

    function setRadiusOverride(varKey: string, px: number) {
      const id = activeTheme.value
      if (!themeOverrides.value[id]) {
        themeOverrides.value[id] = { colors: {}, radius: {} }
      }
      themeOverrides.value[id].radius[varKey] = px
      document.documentElement.style.setProperty(varKey, `${px}px`)
    }

    function resetOverrides() {
      const id = activeTheme.value
      delete themeOverrides.value[id]
      applyTheme(id)
    }

    function getThemeDefaultsForEditor(): Record<string, string> {
      return getThemeDefaults(activeTheme.value)
    }

    function addCustomTheme(theme: CustomTheme) {
      const existing = customThemes.value.findIndex(t => t.id === theme.id)
      if (existing >= 0) {
        customThemes.value[existing] = theme
      }
      else {
        customThemes.value.push(theme)
      }
    }

    function removeCustomTheme(id: string) {
      customThemes.value = customThemes.value.filter(t => t.id !== id)
      delete themeOverrides.value[id]
      if (activeTheme.value === id) {
        setTheme('abyss')
      }
    }

    function exportTheme(id: ThemeId): string {
      const custom = customThemes.value.find(t => t.id === id)
      if (custom) {
        return JSON.stringify(custom, null, 2)
      }
      const meta = THEMES.find(t => t.id === id)
      if (!meta)
        return '{}'
      const overrides = themeOverrides.value[id]
      return JSON.stringify({
        id: meta.id,
        name: meta.name,
        tagline: meta.tagline,
        accent: meta.accent,
        bg: meta.bg,
        variables: overrides?.colors || {},
        radius: overrides?.radius || {},
      }, null, 2)
    }

    function importTheme(jsonOrCss: string): { success: boolean; error?: string } {
      const trimmed = jsonOrCss.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return importJsonTheme(trimmed)
      }
      if (trimmed.includes('[data-theme=') || trimmed.includes('[data-theme =')) {
        return importCssTheme(trimmed)
      }
      return { success: false, error: 'Unrecognized format. Provide JSON or CSS with [data-theme=\'...\'] selector.' }
    }

    function importJsonTheme(json: string): { success: boolean; error?: string } {
      try {
        const data = JSON.parse(json)
        if (!data.id || !data.name) {
          return { success: false, error: 'JSON must have "id" and "name" fields.' }
        }
        const theme: CustomTheme = {
          id: data.id,
          name: data.name,
          tagline: data.tagline || 'Custom theme',
          accent: data.accent || data.variables?.['--color-accent'] || '#888888',
          bg: data.bg || data.variables?.['--color-bg-base'] || '#000000',
          variables: data.variables || {},
        }
        addCustomTheme(theme)
        if (data.radius) {
          if (!themeOverrides.value[theme.id]) {
            themeOverrides.value[theme.id] = { colors: {}, radius: {} }
          }
          themeOverrides.value[theme.id]!.radius = data.radius
        }
        setTheme(theme.id)
        return { success: true }
      }
      catch {
        return { success: false, error: 'Invalid JSON.' }
      }
    }

    function importCssTheme(css: string): { success: boolean; error?: string } {
      const selectorMatch = css.match(/\[data-theme\s*=\s*'([^']+)'\]/)
      if (!selectorMatch?.[1]) {
        return { success: false, error: 'Could not find [data-theme=\'...\'] selector.' }
      }
      const id = selectorMatch[1]
      const vars: Record<string, string> = {}
      const varPattern = /(--color-[\w-]+)\s*:\s*(\S[^;]*);/g
      for (const match of css.matchAll(varPattern)) {
        if (match[1] && match[2]) {
          vars[match[1]] = match[2].trim()
        }
      }
      if (Object.keys(vars).length === 0) {
        return { success: false, error: 'No CSS variables found in the block.' }
      }
      const theme: CustomTheme = {
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        tagline: 'Imported theme',
        accent: vars['--color-accent'] || '#888888',
        bg: vars['--color-bg-base'] || '#000000',
        variables: vars,
      }
      addCustomTheme(theme)
      setTheme(theme.id)
      return { success: true }
    }

    function init() {
      const allIds = [...THEMES.map(t => t.id), ...customThemes.value.map(t => t.id)]
      if (!allIds.includes(activeTheme.value)) {
        activeTheme.value = 'abyss'
      }
      applyTheme(activeTheme.value)
    }

    watch(activeTheme, id => applyTheme(id), { immediate: false })

    return {
      activeTheme,
      showLandingArt,
      activeIllustration,
      customThemes,
      themeOverrides,
      editingTheme,
      themes: THEMES,
      setTheme,
      setColorOverride,
      setRadiusOverride,
      resetOverrides,
      getThemeDefaultsForEditor,
      addCustomTheme,
      removeCustomTheme,
      exportTheme,
      importTheme,
      init,
    }
  },
  {
    persist: true,
  },
)
