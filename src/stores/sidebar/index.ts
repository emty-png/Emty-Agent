import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSidebarStore = defineStore(
  'sidebar',
  () => {
    const collapsed = ref(false)
    const flyoutOpen = ref(false)
    const contextMenuOpen = ref(false)

    function toggle() {
      collapsed.value = !collapsed.value
    }

    function setCollapsed(value: boolean) {
      collapsed.value = value
    }

    function setFlyoutOpen(value: boolean) {
      flyoutOpen.value = value
    }

    function openFlyout() {
      if (collapsed.value)
        flyoutOpen.value = true
    }

    function closeFlyout() {
      flyoutOpen.value = false
    }

    function setContextMenuOpen(value: boolean) {
      contextMenuOpen.value = value
    }

    return { collapsed, flyoutOpen, contextMenuOpen, toggle, setCollapsed, setFlyoutOpen, openFlyout, closeFlyout, setContextMenuOpen }
  },
  {
    persist: {
      pick: ['collapsed'],
    },
  },
)
