<script setup lang="ts">
import { onMounted, ref } from 'vue'
import FatalErrorScreen from './components/app/FatalErrorScreen.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import { getDb } from './db/database'
import { useChatStore } from './stores/chat'
import { resolveTabWorkspacePath } from './stores/chat/workspace'
import { useProjectStore } from './stores/project'
import { useTerminalStore } from './stores/terminal'
import { captureFatalError, fatalError } from './utils/errors'
import ChatView from './views/Chatview.vue'
import HistoryView from './views/HistoryView.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'history' | 'projects'

const activeView = ref<ViewType>('chat')
const settingsOpen = ref(false)
const chat = useChatStore()
const project = useProjectStore()
const terminal = useTerminalStore()

function selectView(view: ViewType) {
  activeView.value = view
}

onMounted(async () => {
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

async function toggleTerminalPanel() {
  const owner = terminal.getOwner(chat.activeId)
  if (owner.isPanelOpen) {
    terminal.closePanel(chat.activeId)
    return
  }

  const workspacePath = resolveTabWorkspacePath(chat.activeTab, project.projectPath)
  activeView.value = 'chat'
  await terminal.ensureVisibleSession(chat.activeId, workspacePath)
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar title="Emty Agent" @toggle-terminal="toggleTerminalPanel" />

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

      <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
    </template>
  </div>
</template>
