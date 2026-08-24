import { ref } from 'vue'

export type AppViewId = 'chat' | 'history' | 'projects' | 'hooks' | 'developer'

// Module-level singleton — shared across every component that navigates the app shell
const activeView = ref<AppViewId>('chat')

export function useAppView() {
  function setView(view: AppViewId) {
    activeView.value = view
  }

  return { activeView, setView }
}
