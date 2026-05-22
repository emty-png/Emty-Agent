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
  captureFatalError(event.reason, {
    title: 'An async task failed',
    context: 'Unhandled promise rejection',
  })
})

app.mount('#app')
