import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from './App.vue'
import { useThemeStore } from './stores/themes'
import './styles/styles.css'
import './styles/themes.css'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)
app.use(pinia)

// Initialize theme (restores from local storage)
useThemeStore().init()

app.mount('#app')
