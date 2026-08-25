import { defineStore } from 'pinia'
import { ref } from 'vue'

const WELCOME_KEY = 'emty_welcome_seen_v1'

export const useWelcomeStore = defineStore('welcome', () => {
  const visible = ref(false)
  // increment to force animation restart on manual trigger while already visible
  const generation = ref(0)

  function hasSeen(): boolean {
    try {
      if (localStorage.getItem(WELCOME_KEY) === '1')
        return true
      // Existing users who opened the app before this welcome was added
      // have a persisted `settings` entry. Treat them as already seen so
      // the new welcome only shows for truly first-time installs.
      // This matches the manual-trigger preview workflow.
      if (localStorage.getItem('settings'))
        return true
      return false
    }
    catch {
      return false
    }
  }

  function markSeen(): void {
    try {
      localStorage.setItem(WELCOME_KEY, '1')
    }
    catch {
      // ignore storage errors
    }
  }

  function show(): void {
    visible.value = true
    generation.value++
  }

  function hide(): void {
    visible.value = false
    markSeen()
  }

  // manual trigger for dev preview — shows even if already seen and restarts animation
  function trigger(): void {
    generation.value++
    visible.value = true
  }

  function maybeShowOnFirstLaunch(): void {
    if (!hasSeen())
      show()
  }

  function resetForDebug(): void {
    try {
      localStorage.removeItem(WELCOME_KEY)
    }
    catch {}
  }

  return { visible, generation, hasSeen, markSeen, show, hide, trigger, maybeShowOnFirstLaunch, resetForDebug }
})
