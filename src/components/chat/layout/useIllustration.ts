import type { Component } from 'vue'
import { computed, defineAsyncComponent } from 'vue'
import { useThemeStore } from '@/stores/themes'

const illustrationMap: Record<string, Component> = {
  illustration_1: defineAsyncComponent(() => import('./illustration_1.vue')),
  illustration_2: defineAsyncComponent(() => import('./illustration_2.vue')),
}

export const ILLUSTRATION_IDS = Object.keys(illustrationMap)

export const ILLUSTRATION_NAMES: Record<string, string> = {
  illustration_1: 'Arctic Scene',
  illustration_2: 'Geometric',
}

export function getIllustrationPreview(id: string): Component {
  return illustrationMap[id] ?? illustrationMap.illustration_1!
}

export function useIllustrationComponent() {
  const theme = useThemeStore()

  const illustrationComponent = computed<Component>(() => {
    return illustrationMap[theme.activeIllustration] ?? illustrationMap.illustration_1!
  })

  return { illustrationComponent }
}
