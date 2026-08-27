import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from './App.vue'
import { useThemeStore } from './stores/themes'
import { captureFatalError } from './utils/errors'
import './styles/styles.css'
import './styles/themes.css'
import 'devicon/devicon.min.css'
import '@xterm/xterm/css/xterm.css'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)
app.use(pinia)

// Initialize theme (restores from local storage)
useThemeStore().init()

// Prime shell/platform off the critical path — warms resolveShell() cache (300-700ms probe)
// so first run_command doesn't pay cold cost. Uses requestIdleCallback when available.
function primeShellCache() {
  import('@/utils/tools/shell').then(({ primeShellAsync }) => {
    primeShellAsync().catch(() => {})
  }).catch(() => {})
}
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(primeShellCache)
}
else {
  setTimeout(primeShellCache, 500)
}

app.config.errorHandler = (error, _instance, info) => {
  captureFatalError(error, {
    title: 'A Vue component crashed',
    context: info,
  })
}

window.addEventListener('error', event => {
  captureFatalError(event.error ?? event.message, {
    title: 'An unexpected runtime error occurred',
    context: `${event.filename}:${event.lineno}:${event.colno}`,
  })
})

window.addEventListener('unhandledrejection', event => {
  // Ignore harmless Tauri IPC race condition when aborting fetch streams or closing channels
  if (
    typeof event.reason === 'string'
    && event.reason.includes('The resource id')
    && event.reason.includes('is invalid')
  ) {
    event.preventDefault()
    return
  }

  captureFatalError(event.reason, {
    title: 'An async task failed',
    context: 'Unhandled promise rejection',
  })
})

app.mount('#app')
