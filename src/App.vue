<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import ChatView from './views/Chatview.vue'
import HistoryView from './views/HistoryView.vue'
import ProjectView from './views/ProjectView.vue'
import { getDb } from './db/database'

type ViewType = 'chat' | 'history' | 'projects'

const activeView = ref<ViewType>('chat')

function selectView(view: ViewType) {
  activeView.value = view
}

onMounted(async () => {
  // initialize the SQLite database on first load
  await getDb()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar title="Emty Agent" />
    <div style="display: flex; flex: 1; overflow: hidden">
      <SideBar :active-view="activeView" @select-view="selectView" />
      <ChatView v-if="activeView === 'chat'" style="flex: 1" />
      <HistoryView
        v-else-if="activeView === 'history'"
        style="flex: 1"
        @new-chat="selectView('chat')"
        @open-chat="selectView('chat')"
      />
      <ProjectView v-else style="flex: 1" />
    </div>
  </div>
</template>
