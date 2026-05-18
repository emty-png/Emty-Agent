import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeId = 'abyss'

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
  /** Representative accent hex for preview swatches */
  accent: string
  /** Background base hex */
  bg: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'abyss', name: 'OLED Abyss', tagline: 'Pure black · Vibrant cyan', accent: '#00e5ff', bg: '#000000' },
]

export const useThemeStore = defineStore(
  'theme',
  () => {
    const activeTheme = ref<ThemeId>('abyss')

    /** Apply data-theme attribute to <html> and update meta theme-color */
    function applyTheme(id: ThemeId) {
      document.documentElement.setAttribute('data-theme', id)

      // Keep the Tauri window titlebar/system chrome in sync.
      // The bg-base value per theme is used as the meta theme-color.
      const bgMap: Record<ThemeId, string> = {
        abyss: '#000000',
      }

      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (meta)
        meta.content = bgMap[id]
    }

    function setTheme(id: ThemeId) {
      activeTheme.value = id
      applyTheme(id)
    }

    /** Call once on app boot — restores persisted theme from localStorage */
    function init() {
      // Force 'abyss' in case any persisted state in localstorage has an old theme ID
      if (activeTheme.value !== 'abyss') {
        activeTheme.value = 'abyss'
      }
      applyTheme(activeTheme.value)
    }

    // Keep DOM in sync whenever the stored value changes (e.g. after hydration)
    watch(activeTheme, id => applyTheme(id), { immediate: false })

    return { activeTheme, themes: THEMES, setTheme, init }
  },
  {
    persist: true, // persists entire state to localStorage under key "theme"
  },
)
