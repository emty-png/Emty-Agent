import { defineStore } from 'pinia'
import { ref } from 'vue'

const ONBOARDING_KEY = 'emty_onboarding_seen_v1'

export const useOnboardingStore = defineStore('onboarding', () => {
  const visible = ref(false)
  const generation = ref(0)

  function hasSeen(): boolean {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1'
    }
    catch {
      return false
    }
  }

  function markSeen(): void {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1')
    }
    catch {}
  }

  function show(): void {
    visible.value = true
    generation.value++
  }

  function hide(): void {
    visible.value = false
    markSeen()
  }

  function maybeShow(): void {
    if (!hasSeen())
      show()
  }

  function resetForDebug(): void {
    try {
      localStorage.removeItem(ONBOARDING_KEY)
    }
    catch {}
  }

  // dev helper: force show even if already seen
  function trigger(): void {
    generation.value++
    visible.value = true
  }

  return { visible, generation, hasSeen, markSeen, show, hide, maybeShow, resetForDebug, trigger }
})
