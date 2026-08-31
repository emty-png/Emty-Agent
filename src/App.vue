<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import HooksPopup from '@/components/hooks/HooksPopup.vue'
import FatalErrorScreen from './components/app/FatalErrorScreen.vue'
import WelcomeAnimation from './components/app/WelcomeAnimation.vue'
import ZoomIndicator from './components/app/ZoomIndicator.vue'
import OnboardingView from './components/onboarding/OnboardingView.vue'
import ProviderBrowser from './components/settings/providers/ProviderBrowser.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import { useAppView } from './composables/ui/useAppView'
import { useZoom } from './composables/ui/useZoom'
import { getDb } from './db/database'
import { useOnboardingStore } from './stores/onboarding'
import { useProjectStore } from './stores/project'
import { useWelcomeStore } from './stores/welcome'
import { captureFatalError, fatalError } from './utils/errors'
import { ALL_PROVIDERS, warmIconCache } from './utils/modelsdev'
import ChatView from './views/Chatview.vue'
import DeveloperView from './views/DeveloperView.vue'
import HistoryView from './views/HistoryView.vue'
import ProjectView from './views/ProjectView.vue'

type ViewType = 'chat' | 'history' | 'projects' | 'hooks' | 'developer'

const { activeView, setView } = useAppView()
const settingsOpen = ref(false)
const showProviderBrowser = ref(false)
const showHooksPopup = ref(false)

function onBrowseProviders() {
  settingsOpen.value = false
  showProviderBrowser.value = true
}

watch(showProviderBrowser, open => {
  if (!open)
    settingsOpen.value = true
})

const project = useProjectStore()
const welcome = useWelcomeStore()
const onboarding = useOnboardingStore()
// show welcome synchronously before first paint so app doesn't flash main UI
welcome.maybeShowOnFirstLaunch()
if (!welcome.visible) {
  // Welcome didn't show (existing install) — show onboarding directly if never seen
  onboarding.maybeShow()
}

// After welcome hides, show onboarding instantly behind it so there is no gap.
// Welcome leave is 420ms fade — onboarding is mounted immediately (z9998) under
// welcome (z9999) and revealed as welcome fades, so no blank flash.
watch(() => welcome.visible, (isVisible, wasVisible) => {
  if (wasVisible && !isVisible) {
    onboarding.trigger()
  }
})

useZoom()

function selectView(view: ViewType) {
  if (view === 'hooks') {
    showHooksPopup.value = true
    return
  }
  setView(view)
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

  // Update check is handled manually via Settings → Others → Check for Updates.
})

function reloadApp() {
  window.location.reload()
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%">
    <ZoomIndicator />

    <WelcomeAnimation />
    <OnboardingView />

    <TitleBar
      v-if="!fatalError && !welcome.visible && !onboarding.visible"
      title="Emty Agent"
      :active-view="activeView"
      @select-view="selectView"
      @open-settings="settingsOpen = true"
    />

    <FatalErrorScreen v-if="fatalError" :error="fatalError" @reload="reloadApp" />

    <template v-else-if="!welcome.visible && !onboarding.visible">
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
        <DeveloperView v-if="activeView === 'developer'" style="flex: 1" />
      </div>

      <SettingsModal
        v-if="settingsOpen"
        @close="settingsOpen = false"
        @browse-providers="onBrowseProviders"
      />
      <ProviderBrowser v-model="showProviderBrowser" />
      <HooksPopup v-if="showHooksPopup" @close="showHooksPopup = false" />
    </template>
  </div>
</template>
