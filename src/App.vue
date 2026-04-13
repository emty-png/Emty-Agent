<script setup lang="ts">
import { ref } from 'vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import ChatView from './views/Chatview.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'projects'

const activeView = ref<ViewType>('chat')

function selectView(view: ViewType) {
  activeView.value = view
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar title="Emty Agent" />
    <div style="display: flex; flex: 1; overflow: hidden">
      <SideBar :active-view="activeView" @select-view="selectView" />
      <ChatView v-if="activeView === 'chat'" style="flex: 1" />
      <ProjectView v-else style="flex: 1" />
    </div>
  </div>
</template>
