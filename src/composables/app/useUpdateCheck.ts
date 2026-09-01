import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { ref, shallowRef } from 'vue'

// Module-level refs — shared singleton across all component instances
const isCheckingUpdate = ref(false)
const isDownloadingUpdate = ref(false)
const updateStatus = ref('')
const hasUpdate = ref(false)
const showUpdateConfirm = ref(false)
const pendingUpdate = shallowRef<Awaited<ReturnType<typeof check>> | null>(null)

async function checkForUpdate() {
  if (isCheckingUpdate.value || isDownloadingUpdate.value)
    return
  isCheckingUpdate.value = true
  updateStatus.value = 'Checking for updates...'

  try {
    const update = await check()
    if (update) {
      hasUpdate.value = true
      pendingUpdate.value = update
      showUpdateConfirm.value = true
      updateStatus.value = `Update ${update.version} available.`
    }
    else {
      updateStatus.value = 'You are on the latest version.'
      hasUpdate.value = false
      pendingUpdate.value = null
    }
  }
  catch (error) {
    updateStatus.value = 'Error checking for updates'
    console.error(error)
  }
  finally {
    isCheckingUpdate.value = false
  }
}

function cancelUpdate() {
  showUpdateConfirm.value = false
}

function handleUpdateButtonClick() {
  if (hasUpdate.value && pendingUpdate.value) {
    showUpdateConfirm.value = true
    return
  }
  checkForUpdate()
}

async function confirmUpdate() {
  const update = pendingUpdate.value
  if (!update)
    return
  showUpdateConfirm.value = false
  isDownloadingUpdate.value = true
  updateStatus.value = `Downloading update ${update.version}...`
  try {
    await update.downloadAndInstall(event => {
      if (event.event === 'Finished') {
        updateStatus.value = 'Download finished. Restarting...'
      }
    })
    await relaunch()
  }
  catch (error) {
    updateStatus.value = 'Failed to download update'
    console.error(error)
  }
  finally {
    isDownloadingUpdate.value = false
  }
}

export function useUpdateCheck() {
  return {
    isCheckingUpdate,
    isDownloadingUpdate,
    updateStatus,
    hasUpdate,
    showUpdateConfirm,
    pendingUpdate,
    checkForUpdate,
    cancelUpdate,
    handleUpdateButtonClick,
    confirmUpdate,
  }
}
