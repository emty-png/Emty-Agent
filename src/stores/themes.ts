import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeId
  = | 'ember'
    | 'void'
    | 'arctic'
    | 'sakura'
    | 'emerald'
    | 'gold'
    | 'ocean'
    | 'crimson'
    | 'slate'
    | 'amethyst'
    | 'abyss'
    | 'velvet'
    | 'parchment'
    | 'latte'
    | 'paper'
    | 'neon'
    | 'mocha'
    | 'mint'
    | 'coral'
    | 'berry'

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
  // Dark Themes
  { id: 'ember', name: 'Ember', tagline: 'Warm charcoal · Burnt orange', accent: '#c8651f', bg: '#0c0a08' },
  { id: 'void', name: 'Void', tagline: 'Obsidian black · Electric violet', accent: '#7c3aed', bg: '#08060c' },
  { id: 'arctic', name: 'Arctic Frost', tagline: 'Deep navy · Icy cyan', accent: '#0891b2', bg: '#050c18' },
  { id: 'sakura', name: 'Sakura Night', tagline: 'Dark indigo · Electric rose', accent: '#db2777', bg: '#0d0a10' },
  { id: 'emerald', name: 'Emerald', tagline: 'Abyss black · Neon emerald', accent: '#059669', bg: '#020a06' },
  { id: 'gold', name: 'Golden Dusk', tagline: 'Dark espresso · Warm gold', accent: '#d97706', bg: '#0e0c06' },
  { id: 'ocean', name: 'Deep Ocean', tagline: 'Abyss navy · Bioluminescent teal', accent: '#0891b2', bg: '#040d14' },
  { id: 'crimson', name: 'Crimson Noir', tagline: 'Dark graphite · Vivid crimson', accent: '#dc2626', bg: '#0c0808' },
  { id: 'slate', name: 'Slate Storm', tagline: 'Dark steel blue · Electric blue', accent: '#2563eb', bg: '#080c14' },
  { id: 'amethyst', name: 'Amethyst Haze', tagline: 'Deep indigo · Soft lavender', accent: '#7c3aed', bg: '#0b0910' },
  { id: 'abyss', name: 'OLED Abyss', tagline: 'Pure black · Vibrant cyan', accent: '#00e5ff', bg: '#000000' },
  { id: 'velvet', name: 'Velvet Midnight', tagline: 'Deep plum · Soft lavender', accent: '#a855f7', bg: '#06040a' },

  // High-Contrast Light Themes
  { id: 'parchment', name: 'Parchment', tagline: 'Warm paper · Terracotta', accent: '#c96442', bg: '#f5f4ed' },
  { id: 'latte', name: 'Latte', tagline: 'Soft pastel · Electric mauve', accent: '#8839ef', bg: '#eff1f5' },
  { id: 'paper', name: 'Paper', tagline: 'High contrast · Pure minimal', accent: '#000000', bg: '#ffffff' },

  // New Unique Themes
  { id: 'neon', name: 'Neon Prism', tagline: 'Cyberpunk · Electric magenta', accent: '#ff00ff', bg: '#000000' },
  { id: 'mocha', name: 'Mocha', tagline: 'Dark roast · Caramel cream', accent: '#8b5a2b', bg: '#1a1410' },
  { id: 'mint', name: 'Mint Frost', tagline: 'Deep forest · Fresh mint', accent: '#4ade80', bg: '#0d1a12' },
  { id: 'coral', name: 'Sunset Coral', tagline: 'Warm tropical · Living coral', accent: '#ff6b6b', bg: '#1a1210' },
  { id: 'berry', name: 'Midnight Berry', tagline: 'Blackberry · Electric violet', accent: '#7c3aed', bg: '#0a0610' },
]

export const useThemeStore = defineStore(
  'theme',
  () => {
    const activeTheme = ref<ThemeId>('ember')

    /** Apply data-theme attribute to <html> and update meta theme-color */
    function applyTheme(id: ThemeId) {
      document.documentElement.setAttribute('data-theme', id)

      // Keep the Tauri window titlebar/system chrome in sync.
      // The bg-base value per theme is used as the meta theme-color.
      const bgMap: Record<ThemeId, string> = {
        ember: '#0c0a08',
        void: '#08060c',
        arctic: '#050c18',
        sakura: '#0d0a10',
        emerald: '#020a06',
        gold: '#0e0c06',
        ocean: '#040d14',
        crimson: '#0c0808',
        slate: '#080c14',
        amethyst: '#0b0910',
        abyss: '#000000',
        velvet: '#06040a',
        parchment: '#f5f4ed',
        latte: '#eff1f5',
        paper: '#ffffff',
        neon: '#000000',
        mocha: '#1a1410',
        mint: '#0d1a12',
        coral: '#1a1210',
        berry: '#0a0610',
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
