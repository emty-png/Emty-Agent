import type { HookConfig, HookEvent } from '@/utils/hooks'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createDefaultHooksConfig,
  getHooksConfigPath,
  hookLog,
  hooksConfigExists,
  invalidateCache,
  loadHooksConfig,
} from '@/utils/hooks'

export const ALL_HOOK_EVENTS: HookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'TurnStart',
  'TurnEnd',
  'StopFailure',
  'PreToolUse',
  'PostToolUse',
  'PreFileWrite',
  'PostFileWrite',
  'PreShellExec',
  'PostShellExec',
]

export const useHooksStore = defineStore('hooks', () => {
  const config = ref<HookConfig | null>(null)
  const configPath = ref<string | null>(null)
  const configExists = ref(false)
  const loading = ref(false)

  const enabledEvents = computed(() => {
    if (!config.value)
      return new Set<HookEvent>()
    return new Set(
      ALL_HOOK_EVENTS.filter(e => config.value!.hooks[e] && config.value!.hooks[e]!.length > 0),
    )
  })

  function eventHookCount(event: HookEvent): number {
    if (!config.value || !config.value.hooks[event])
      return 0
    return config.value.hooks[event]!.reduce((sum, entry) => sum + entry.hooks.length, 0)
  }

  async function loadConfig(workspacePath: string | null) {
    if (!workspacePath) {
      config.value = null
      configExists.value = false
      configPath.value = null
      return
    }

    loading.value = true
    try {
      configPath.value = await getHooksConfigPath(workspacePath)
      configExists.value = await hooksConfigExists(workspacePath)
      if (configExists.value) {
        invalidateCache(workspacePath)
        config.value = await loadHooksConfig(workspacePath)
      }
      else {
        config.value = null
      }
    }
    finally {
      loading.value = false
    }
  }

  async function createDefaultConfig(workspacePath: string) {
    await createDefaultHooksConfig(workspacePath)
    await loadConfig(workspacePath)
  }

  async function toggleEvent(event: HookEvent, enabled: boolean, workspacePath: string) {
    if (!config.value || !configPath.value)
      return

    if (enabled) {
      // Re-enabling: no-op — entries can only be restored by editing the config file
      return
    }

    // Disabling: remove entries for this event and write back to disk
    delete config.value.hooks[event]
    try {
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(configPath.value, new TextEncoder().encode(JSON.stringify(config.value, null, 2)))
      invalidateCache(workspacePath)
    }
    catch (err) {
      console.warn('[hooks] Failed to persist toggle:', err)
    }
  }

  return {
    config,
    configPath,
    configExists,
    loading,
    hookLog,
    enabledEvents,
    eventHookCount,
    loadConfig,
    createDefaultConfig,
    toggleEvent,
  }
})
