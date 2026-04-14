<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import { getDb } from './db/database'
import ChatView from './views/Chatview.vue'
import HistoryView from './views/HistoryView.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'history' | 'projects'

const activeView = ref<ViewType>('chat')
const settingsOpen = ref(false)

function selectView(view: ViewType) {
  activeView.value = view
}

onMounted(async () => {
  await getDb()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar title="Emty Agent" />
    <div style="display: flex; flex: 1; overflow: hidden">
      <SideBar
        :active-view="activeView"
        @select-view="selectView"
        @open-settings="settingsOpen = true"
      />
      <ChatView v-if="activeView === 'chat'" style="flex: 1" />
      <HistoryView
        v-else-if="activeView === 'history'"
        style="flex: 1"
        @new-chat="selectView('chat')"
        @open-chat="selectView('chat')"
      />
      <ProjectView v-else style="flex: 1" />
    </div>

    <!-- settings modal — teleported to body inside SettingsModal itself -->
    <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
