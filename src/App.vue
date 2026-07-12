<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import FatalErrorScreen from './components/app/FatalErrorScreen.vue'
import ProviderBrowser from './components/settings/providers/ProviderBrowser.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import { getDb } from './db/database'
import { useProjectStore } from './stores/project'
import { captureFatalError, fatalError } from './utils/errors'
import { ALL_PROVIDERS, warmIconCache } from './utils/modelsdev'
import ChatView from './views/Chatview.vue'
import HistoryView from './views/HistoryView.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'history' | 'projects'

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
})

function reloadApp() {
  window.location.reload()
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar
      title="Emty Agent"
      :active-view="activeView"
      @select-view="selectView"
      @open-settings="settingsOpen = true"
    />

    <FatalErrorScreen v-if="fatalError" :error="fatalError" @reload="reloadApp" />

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
