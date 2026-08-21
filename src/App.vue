<script setup lang="ts">
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { onMounted, ref, watch } from 'vue'
import FatalErrorScreen from './components/app/FatalErrorScreen.vue'
import ZoomIndicator from './components/app/ZoomIndicator.vue'
import OnboardingFlow from './components/onboarding/OnboardingFlow.vue'
import ProviderBrowser from './components/settings/providers/ProviderBrowser.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import { useZoom } from './composables/ui/useZoom'
import { getDb } from './db/database'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { captureFatalError, fatalError } from './utils/errors'
import { ALL_PROVIDERS, warmIconCache } from './utils/modelsdev'
import ChatView from './views/Chatview.vue'
import DeveloperView from './views/DeveloperView.vue'
import HistoryView from './views/HistoryView.vue'
import HooksView from './views/HooksView.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'history' | 'projects' | 'hooks' | 'developer'

const activeView = ref<ViewType>('chat')
const settingsOpen = ref(false)
const showProviderBrowser = ref(false)

function onBrowseProviders() {
  settingsOpen.value = false
  showProviderBrowser.value = true
}

watch(showProviderBrowser, open => {
  if (!open)
    settingsOpen.value = true
})

const project = useProjectStore()
const settings = useSettingsStore()

useZoom()

function selectView(view: ViewType) {
  activeView.value = view
}

onMounted(async () => {
  warmIconCache(ALL_PROVIDERS.map(p => p.id))

  // A new window is opened with ?noProject=1 to start without an active project
  if (new URLSearchParams(window.location.search).get('noProject') === '1') {
    project.clearProject()
  }

  try {
    await getDb()
  }
  catch (error) {
    captureFatalError(error, {
      title: 'Unable to start Emty Agent',
      context: 'Database initialisation failed during startup.',
    })
  }

  // Check for updates in the background
  try {
    const update = await check()
    if (update) {
      await update.downloadAndInstall()
      await relaunch()
    }
  }
  catch (error) {
    console.error('Failed to check for updates on startup:', error)
  }
})

function reloadApp() {
  window.location.reload()
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%">
    <ZoomIndicator />

    <TitleBar
      v-if="settings.completedOnboarding && !fatalError"
      title="Emty Agent"
      :active-view="activeView"
      @select-view="selectView"
      @open-settings="settingsOpen = true"
    />

    <FatalErrorScreen v-if="fatalError" :error="fatalError" @reload="reloadApp" />

    <OnboardingFlow
      v-else-if="!settings.completedOnboarding"
      @complete="settings.completeOnboarding()"
    />

    <template v-else>
      <div style="display: flex; flex: 1; overflow: hidden">
        <SideBar
          :active-view="activeView"
          @select-view="selectView"
          @open-settings="settingsOpen = true"
        />
        <ChatView v-show="activeView === 'chat'" style="flex: 1" />
        <HistoryView
          v-if="activeView === 'history'"
          style="flex: 1"
          @new-chat="selectView('chat')"
          @open-chat="selectView('chat')"
        />
        <ProjectView v-if="activeView === 'projects'" style="flex: 1" />
        <HooksView v-if="activeView === 'hooks'" style="flex: 1" />
        <DeveloperView v-if="activeView === 'developer'" style="flex: 1" />
      </div>

      <SettingsModal
        v-if="settingsOpen"
        @close="settingsOpen = false"
        @browse-providers="onBrowseProviders"
      />
      <ProviderBrowser v-model="showProviderBrowser" />
    </template>
  </div>
</template>
