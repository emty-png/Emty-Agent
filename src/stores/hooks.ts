import type { HookConfig, HookEvent, KnownHookEvent } from '@/utils/hooks'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createDefaultGlobalHooksConfig,
  createDefaultHooksConfig,
  getGlobalHooksConfigPath,
  getHooksConfigPath,
  globalHooksConfigExists,
  hookLog,
  hooksConfigExists,
  invalidateCache,
  invalidateGlobalCache,
  loadGlobalHooksConfig,
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
  'PreFileEdit',
  'PostFileEdit',
  'PreFileRead',
  'PostFileRead',
  'PreShellExec',
  'PostShellExec',
  'PreMcpUse',
  'PostMcpUse',
  'BeforePromptBuild',
  'AfterPromptBuild',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentEnd',
  'PermissionRequest',
]

export type HookScope = 'global' | 'project'

export const useHooksStore = defineStore('hooks', () => {
  // project scope (existing)
  const config = ref<HookConfig | null>(null)
  const configPath = ref<string | null>(null)
  const configExists = ref(false)
  const loading = ref(false)

  // global scope
  const globalConfig = ref<HookConfig | null>(null)
  const globalConfigPath = ref<string | null>(null)
  const globalConfigExists = ref(false)
  const globalLoading = ref(false)

  // active scope
  const scope = ref<HookScope>('project')

  const activeConfig = computed(() => (scope.value === 'global' ? globalConfig.value : config.value))
  const activeConfigPath = computed(() => (scope.value === 'global' ? globalConfigPath.value : configPath.value))
  const activeConfigExists = computed(() => (scope.value === 'global' ? globalConfigExists.value : configExists.value))
  const activeLoading = computed(() => (scope.value === 'global' ? globalLoading.value : loading.value))

  const customEvents = computed(() => {
    const cfg = scope.value === 'global' ? globalConfig.value : config.value
    return cfg?.customEvents ?? {}
  })

  const allKnownPlusCustom = computed(() => {
    const cfg = scope.value === 'global' ? globalConfig.value : config.value
    const custom = cfg?.customEvents ? Object.keys(cfg.customEvents) : []
    return [...ALL_HOOK_EVENTS, ...custom.filter(c => !ALL_HOOK_EVENTS.includes(c as KnownHookEvent))] as HookEvent[]
  })

  const enabledEvents = computed(() => {
    const cfg = scope.value === 'global' ? globalConfig.value : config.value
    if (!cfg)
      return new Set<HookEvent>()
    return new Set(
      allKnownPlusCustom.value.filter(e => cfg!.hooks[e] && cfg!.hooks[e]!.length > 0 && cfg!.hooks[e]!.some(en => en.enabled !== false)),
    )
  })

  const activeEnabledEvents = computed(() => enabledEvents.value)

  function eventHookCount(event: HookEvent): number {
    const cfg = scope.value === 'global' ? globalConfig.value : config.value
    if (!cfg || !cfg.hooks[event])
      return 0
    return cfg.hooks[event]!.filter(e => e.enabled !== false).reduce((sum, entry) => sum + entry.hooks.filter(h => h.enabled !== false).length, 0)
  }

  function projectEventHookCount(event: HookEvent): number {
    if (!config.value || !config.value.hooks[event])
      return 0
    return config.value.hooks[event]!.filter(e => e.enabled !== false).reduce((sum, entry) => sum + entry.hooks.filter(h => h.enabled !== false).length, 0)
  }

  function globalEventHookCount(event: HookEvent): number {
    if (!globalConfig.value || !globalConfig.value.hooks[event])
      return 0
    return globalConfig.value.hooks[event]!.filter(e => e.enabled !== false).reduce((sum, entry) => sum + entry.hooks.filter(h => h.enabled !== false).length, 0)
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

  async function loadGlobalConfig() {
    globalLoading.value = true
    try {
      globalConfigPath.value = await getGlobalHooksConfigPath()
      globalConfigExists.value = await globalHooksConfigExists()
      if (globalConfigExists.value) {
        invalidateGlobalCache()
        globalConfig.value = await loadGlobalHooksConfig()
      }
      else {
        globalConfig.value = null
      }
    }
    finally {
      globalLoading.value = false
    }
  }

  async function createDefaultConfig(workspacePath: string) {
    await createDefaultHooksConfig(workspacePath)
    await loadConfig(workspacePath)
  }

  async function createGlobalDefaultConfig() {
    await createDefaultGlobalHooksConfig()
    await loadGlobalConfig()
  }

  async function toggleEvent(event: HookEvent, enabled: boolean, workspacePath: string) {
    const cfg = scope.value === 'global' ? globalConfig.value : config.value
    const cfgPath = scope.value === 'global' ? globalConfigPath.value : configPath.value
    if (!cfg || !cfgPath)
      return

    if (!cfg.hooks[event])
      return

    // Toggle enabled flag per-entry instead of deleting (preserves config)
    for (const entry of cfg.hooks[event]!) {
      entry.enabled = enabled
    }
    if (!enabled && cfg.hooks[event]!.every(e => e.enabled === false)) {
      // keep entries but disabled — don't delete
    }

    try {
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(cfgPath, new TextEncoder().encode(JSON.stringify(cfg, null, 2)))
      if (scope.value === 'global')
        invalidateGlobalCache()
      else
        invalidateCache(workspacePath)
    }
    catch {
      // silently ignore persistence errors
    }
  }

  function setScope(s: HookScope) {
    scope.value = s
  }

  return {
    // project
    config,
    configPath,
    configExists,
    loading,
    // global
    globalConfig,
    globalConfigPath,
    globalConfigExists,
    globalLoading,
    // active
    scope,
    activeConfig,
    activeConfigPath,
    activeConfigExists,
    activeLoading,
    hookLog,
    enabledEvents,
    activeEnabledEvents,
    customEvents,
    allKnownPlusCustom,
    eventHookCount,
    projectEventHookCount,
    globalEventHookCount,
    loadConfig,
    loadGlobalConfig,
    createDefaultConfig,
    createGlobalDefaultConfig,
    toggleEvent,
    setScope,
  }
}, {
  persist: {
    pick: ['scope'],
  },
})
