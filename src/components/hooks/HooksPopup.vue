<script setup lang="ts">
import type { HookEvent, HookMatcher } from '@/utils/hooks/types'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Archive,
  Blocks,
  Bot,
  CircleAlert,
  Eye,
  FilePenLine,
  FolderOpen,
  FolderPlus,
  Globe,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHooksStore } from '@/stores/hooks'
import { useProjectStore } from '@/stores/project'

const emit = defineEmits<{ close: [] }>()

type Section = 'session' | 'turn' | 'prompt' | 'compact' | 'edit' | 'write' | 'read' | 'shell' | 'others' | 'mcp' | 'subagent' | 'error' | 'custom'
const activeSection = ref<Section>('session')

interface NavItem { id: Section; label: string; icon: typeof Rocket; group: string }
const NAV: NavItem[] = [
  { id: 'session', label: 'Session', icon: Rocket, group: 'Lifecycle' },
  { id: 'turn', label: 'Turn', icon: RefreshCw, group: 'Lifecycle' },
  { id: 'prompt', label: 'Prompt', icon: MessageSquare, group: 'Lifecycle' },
  { id: 'compact', label: 'Compact', icon: Archive, group: 'Lifecycle' },
  { id: 'edit', label: 'Edit', icon: Pencil, group: 'File' },
  { id: 'write', label: 'Write', icon: FilePenLine, group: 'File' },
  { id: 'read', label: 'Read', icon: Eye, group: 'File' },
  { id: 'shell', label: 'Shell', icon: Terminal, group: 'Execution' },
  { id: 'others', label: 'Tools', icon: Wrench, group: 'Tool' },
  { id: 'mcp', label: 'MCP', icon: Plug, group: 'Tool' },
  { id: 'subagent', label: 'Subagent', icon: Bot, group: 'Execution' },
  { id: 'error', label: 'Error', icon: CircleAlert, group: 'Lifecycle' },
  { id: 'custom', label: 'Custom', icon: Blocks, group: 'Custom' },
]

const GROUPS = ['Lifecycle', 'File', 'Tool', 'Execution', 'Custom'] as const

const project = useProjectStore()
const hooksStore = useHooksStore()
const {
  config,
  configExists,
  configPath,
  loading,
  globalConfig,
  globalConfigExists,
  globalConfigPath,
  globalLoading,
  scope,
  customEvents,
} = storeToRefs(hooksStore)

// active (scope-aware) helpers for UI
const isGlobal = computed(() => scope.value === 'global')
const activeLoading = computed(() => (isGlobal.value ? globalLoading.value : loading.value))
const activeExists = computed(() => (isGlobal.value ? globalConfigExists.value : configExists.value))

const SECTION_EVENTS: Record<Section, HookEvent[]> = {
  session: ['SessionStart', 'SessionEnd'],
  turn: ['TurnStart', 'TurnEnd'],
  prompt: ['BeforePromptBuild', 'AfterPromptBuild'],
  compact: ['PreCompact', 'PostCompact'],
  edit: ['PreFileEdit', 'PostFileEdit'],
  write: ['PreFileWrite', 'PostFileWrite'],
  read: ['PreFileRead', 'PostFileRead'],
  shell: ['PreShellExec', 'PostShellExec'],
  others: ['PreToolUse', 'PostToolUse', 'PermissionRequest'],
  mcp: ['PreMcpUse', 'PostMcpUse'],
  subagent: ['SubagentStart', 'SubagentEnd'],
  error: ['StopFailure'],
  custom: [],
}

const customSectionEvents = computed<HookEvent[]>(() => {
  const ce = isGlobal.value ? globalConfig.value?.customEvents : config.value?.customEvents
  if (!ce)
    return []
  return Object.keys(ce)
})

const EVENT_META: Record<string, { label: string; desc: string; blockable: boolean; matcherHint: string }> = {
  SessionStart: { label: 'Session Start', desc: 'Fires when the first message is sent in a tab', blockable: true, matcherHint: '' },
  SessionEnd: { label: 'Session End', desc: 'Fires when a tab is closed', blockable: false, matcherHint: '' },
  TurnStart: { label: 'Turn Start', desc: 'Fires when the user submits a prompt', blockable: true, matcherHint: '' },
  TurnEnd: { label: 'Turn End', desc: 'Fires when the agent completes its turn', blockable: false, matcherHint: '' },
  BeforePromptBuild: { label: 'Before Prompt Build', desc: 'Fires before system prompt is built (can block/modify via toolInputPatch.prompt)', blockable: true, matcherHint: 'Prompt regex, e.g. /fix.*bug/i or *' },
  AfterPromptBuild: { label: 'After Prompt Build', desc: 'Fires after system prompt is assembled', blockable: false, matcherHint: '' },
  PreCompact: { label: 'Pre Compact', desc: 'Fires before conversation compaction (can block)', blockable: true, matcherHint: '' },
  PostCompact: { label: 'Post Compact', desc: 'Fires after compaction completes', blockable: false, matcherHint: '' },
  StopFailure: { label: 'Stop Failure', desc: 'Fires when the agent fails terminally (after retries exhausted or non-retryable error)', blockable: false, matcherHint: '' },
  SubagentStart: { label: 'Subagent Start', desc: 'Fires when a subagent is spawned', blockable: false, matcherHint: 'Personality, e.g. explore | plan or *' },
  SubagentEnd: { label: 'Subagent End', desc: 'Fires when a subagent completes', blockable: false, matcherHint: '' },
  PreToolUse: { label: 'Pre Tool Use', desc: 'Fires before any tool executes (can block/mutate)', blockable: true, matcherHint: 'Tool name, e.g. read_file | write_file or * or /mcp__/' },
  PostToolUse: { label: 'Post Tool Use', desc: 'Fires after a tool completes', blockable: false, matcherHint: 'Tool name, e.g. read_file | write_file or *' },
  PermissionRequest: { label: 'Permission Request', desc: 'Fires before permission modal (can auto-deny via hook)', blockable: true, matcherHint: 'Tool name or *' },
  PreFileWrite: { label: 'Pre File Write', desc: 'Fires before a file is written (can block)', blockable: true, matcherHint: 'File glob, e.g. *.ts or src/** or /\\.secret/' },
  PostFileWrite: { label: 'Post File Write', desc: 'Fires after a file is written', blockable: false, matcherHint: 'File glob, e.g. *.ts or src/**' },
  PreFileEdit: { label: 'Pre File Edit', desc: 'Fires before a file is edited (can block)', blockable: true, matcherHint: 'File glob, e.g. *.ts or src/**' },
  PostFileEdit: { label: 'Post File Edit', desc: 'Fires after a file is edited', blockable: false, matcherHint: 'File glob, e.g. *.ts or src/**' },
  PreFileRead: { label: 'Pre File Read', desc: 'Fires before a file is read/glob/grep (can block)', blockable: true, matcherHint: 'File glob, e.g. *.ts or **/*.md' },
  PostFileRead: { label: 'Post File Read', desc: 'Fires after file read completes', blockable: false, matcherHint: 'File glob' },
  PreMcpUse: { label: 'Pre MCP Use', desc: 'Fires before an MCP tool executes (can block)', blockable: true, matcherHint: 'Tool, e.g. mcp__* or mcp__github__*' },
  PostMcpUse: { label: 'Post MCP Use', desc: 'Fires after MCP tool completes', blockable: false, matcherHint: 'Tool, e.g. mcp__*' },
  PreShellExec: { label: 'Pre Shell Exec', desc: 'Fires before a shell command runs (can block)', blockable: true, matcherHint: 'Command pattern, e.g. git * or npm * or /rm -rf/' },
  PostShellExec: { label: 'Post Shell Exec', desc: 'Fires after a shell command completes', blockable: false, matcherHint: 'Command pattern, e.g. git *' },
}

// ── inline project picker (copied from chat/pickers/ProjectPicker.vue) + Global ──────
const pickerOpen = ref(false)
const picking = ref(false)

const projectName = computed(() => {
  if (isGlobal.value)
    return 'Global'
  if (!project.projectPath)
    return null
  return project.projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
})

const selectableProjects = computed(() =>
  project.openProjects.filter(path => !project.designProjects.includes(path)),
)

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}

function closePicker() {
  pickerOpen.value = false
}

function selectGlobal() {
  hooksStore.setScope('global')
  hooksStore.loadGlobalConfig()
  closePicker()
}

function selectProject(path: string) {
  project.setProject(path)
  hooksStore.setScope('project')
  closePicker()
}

async function pickFolder() {
  if (picking.value)
    return
  picking.value = true
  try {
    const selected = await open({
      directory: true,
      recursive: true,
      multiple: false,
      title: 'Open project folder',
    })
    if (typeof selected === 'string') {
      project.addProject(selected)
      hooksStore.setScope('project')
      closePicker()
    }
  }
  finally {
    picking.value = false
  }
}

const triggerClasses = computed(() => {
  const base = 'flex items-center gap-1.5 h-[28px] px-2 border rounded-(--radius-md) text-[12.5px] cursor-pointer shrink-0 transition-[background,border-color,border-radius] duration-120ms'
  return pickerOpen.value
    ? `${base} bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg) text-(--color-text-secondary)`
    : `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)`
})

function itemClasses(isActive: boolean, variant?: 'new' | 'danger') {
  const base = 'flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[12.5px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100'
  if (isActive) {
    return `${base} bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary)`
  }
  if (variant === 'new') {
    return `${base} bg-transparent border-transparent text-(--color-accent-text) hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:text-(--color-accent-text)`
  }
  if (variant === 'danger') {
    return `${base} bg-transparent border-transparent text-(--color-danger-text) hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] hover:border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:text-(--color-danger-text)`
  }
  return `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)`
}

function onPickerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && pickerOpen.value) {
    pickerOpen.value = false
    e.stopPropagation()
  }
}

onMounted(() => window.addEventListener('keydown', onPickerKeydown))
onUnmounted(() => window.removeEventListener('keydown', onPickerKeydown))

// ── hooks content ──────────────────────────────────────────────────────────
const activeEvents = computed(() => {
  if (activeSection.value === 'custom')
    return customSectionEvents.value
  return SECTION_EVENTS[activeSection.value] as HookEvent[]
})

const expandedEntries = ref<Set<string>>(new Set())
function toggleEntryExpanded(event: HookEvent, idx: number) {
  const key = `${event}:${idx}`
  if (expandedEntries.value.has(key))
    expandedEntries.value.delete(key)
  else
    expandedEntries.value.add(key)
}
function isEntryExpanded(event: HookEvent, idx: number) {
  return expandedEntries.value.has(`${event}:${idx}`)
}

const showAdvancedFor = ref<Set<string>>(new Set())
function toggleAdvanced(event: HookEvent, idx: number) {
  const k = `${event}:${idx}`
  if (showAdvancedFor.value.has(k))
    showAdvancedFor.value.delete(k)
  else
    showAdvancedFor.value.add(k)
}
function isAdvanced(event: HookEvent, idx: number) {
  return showAdvancedFor.value.has(`${event}:${idx}`)
}

function entriesFor(event: HookEvent) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  return cfg?.hooks[event] ?? []
}

function hookCount(event: HookEvent): number {
  return hooksStore.eventHookCount(event)
}

function ensureConfig() {
  if (isGlobal.value) {
    if (!globalConfig.value)
      globalConfig.value = { version: 2, hooks: {} }
    if (globalConfig.value.version === undefined)
      globalConfig.value.version = 2
    return globalConfig.value
  }
  if (!config.value)
    config.value = { version: 2, hooks: {} }
  if (config.value.version === undefined)
    config.value.version = 2
  return config.value
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist() {
  if (saveTimer)
    clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 350)
}

async function persist() {
  if (isGlobal.value) {
    if (!globalConfigExists.value) {
      try {
        await hooksStore.createGlobalDefaultConfig()
      }
      catch {
        return
      }
    }
    if (!globalConfigPath.value || !globalConfig.value)
      return
    try {
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(globalConfigPath.value, new TextEncoder().encode(JSON.stringify(globalConfig.value, null, 2)))
      const { invalidateGlobalCache } = await import('@/utils/hooks')
      invalidateGlobalCache()
    }
    catch {
      // ignore
    }
    return
  }

  if (!project.projectPath)
    return
  // ensure file exists first
  if (!configExists.value) {
    try {
      await hooksStore.createDefaultConfig(project.projectPath)
    }
    catch {
      return
    }
  }
  if (!configPath.value || !config.value)
    return
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(configPath.value, new TextEncoder().encode(JSON.stringify(config.value, null, 2)))
    const { invalidateCache } = await import('@/utils/hooks')
    invalidateCache(project.projectPath)
  }
  catch {
    // ignore
  }
}

async function handleCreateConfig() {
  if (isGlobal.value) {
    await hooksStore.createGlobalDefaultConfig()
    return
  }
  if (project.projectPath) {
    await hooksStore.createDefaultConfig(project.projectPath)
  }
}

function addHookEntry(event: HookEvent) {
  const cfg = ensureConfig()
  if (!cfg.hooks[event])
    cfg.hooks[event] = []
  cfg.hooks[event]!.push({ matcher: '', hooks: [{ command: '', timeoutSec: 5, type: 'shell' }], priority: 0, enabled: true, runMode: 'sequential' })
  schedulePersist()
}

function removeHookEntry(event: HookEvent, idx: number) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  if (!cfg?.hooks[event])
    return
  cfg.hooks[event]!.splice(idx, 1)
  if (cfg.hooks[event]!.length === 0)
    delete cfg.hooks[event]
  schedulePersist()
}

function updateMatcher(event: HookEvent, idx: number, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  entry.matcher = value
  schedulePersist()
}

function updateEntryField(event: HookEvent, idx: number, field: 'name' | 'description', value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry) {
    return
  }(entry as unknown as Record<string, unknown>)[field] = value
  schedulePersist()
}

function updateEntryEnabled(event: HookEvent, idx: number, v: boolean) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  entry.enabled = v
  schedulePersist()
}

function updatePriority(event: HookEvent, idx: number, v: number) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const n = Number.isNaN(v) ? 0 : Math.max(-1000, Math.min(1000, Math.trunc(v)))
  entry.priority = n
  schedulePersist()
}

function updateRunMode(event: HookEvent, idx: number, v: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  if (v === 'sequential' || v === 'parallel' || v === 'race')
    entry.runMode = v as HookMatcher extends never ? never : 'sequential' | 'parallel' | 'race'
  else
    delete entry.runMode
  schedulePersist()
}

function updateMatchField(event: HookEvent, idx: number, key: keyof HookMatcher, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  if (!entry.match)
    entry.match = {}
  if (!value) {
    delete (entry.match as unknown as Record<string, unknown>)[key as string]
    if (Object.keys(entry.match).length === 0)
      delete entry.match
  }
  else {
    ;(entry.match as unknown as Record<string, unknown>)[key as string] = value
  }
  schedulePersist()
}

function updateMatchInput(event: HookEvent, idx: number, value: string) {
  // value is JSON for input matchers like {"file_path":"*.ts"}
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  if (!value.trim()) {
    if (entry.match)
      delete entry.match.input
    schedulePersist()
    return
  }
  try {
    const parsed = JSON.parse(value) as Record<string, string>
    if (!entry.match)
      entry.match = {}
    entry.match.input = parsed
  }
  catch {
    // ignore invalid json until valid
    return
  }
  schedulePersist()
}

function updateCommand(event: HookEvent, idx: number, cmdIdx: number, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  hook.command = value
  schedulePersist()
}

function updateTimeout(event: HookEvent, idx: number, cmdIdx: number, value: number) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  const v = Number.isNaN(value) ? 5 : Math.max(1, Math.min(900, Math.trunc(value)))
  hook.timeoutSec = v
  schedulePersist()
}

function updateCommandType(event: HookEvent, idx: number, cmdIdx: number, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  if (value === 'shell' || value === 'node' || value === 'js')
    hook.type = value as HookMatcher extends never ? never : 'shell' | 'node' | 'js'
  else
    delete hook.type
  schedulePersist()
}

function updateCommandCwd(event: HookEvent, idx: number, cmdIdx: number, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  if (!value)
    delete hook.cwd
  else
    hook.cwd = value
  schedulePersist()
}

function updateCommandEnv(event: HookEvent, idx: number, cmdIdx: number, value: string) {
  // value is "KEY=val,FOO=bar" or JSON
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  if (!value.trim()) {
    delete hook.env
    schedulePersist()
    return
  }
  try {
    if (value.trim().startsWith('{')) {
      hook.env = JSON.parse(value) as Record<string, string>
    }
    else {
      const env: Record<string, string> = {}
      for (const part of value.split(',')) {
        const [k, ...rest] = part.split('=')
        if (!k)
          continue
        const v = rest.join('=')
        if (k.trim() && v !== undefined)
          env[k.trim()] = v.trim()
      }
      if (Object.keys(env).length) {
        hook.env = env
      }
      else {
        delete (hook as { env?: Record<string, string> }).env
      }
    }
  }
  catch {
    return
  }
  schedulePersist()
}

function updateCommandEnabled(event: HookEvent, idx: number, cmdIdx: number, v: boolean) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  hook.enabled = v
  schedulePersist()
}

function updateCommandFile(event: HookEvent, idx: number, cmdIdx: number, value: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  const hook = entry.hooks[cmdIdx]
  if (!hook)
    return
  if (!value) {
    delete (hook as { file?: string }).file
  }
  else {
    hook.file = value
  }
  schedulePersist()
}

function addCommandToEntry(event: HookEvent, idx: number) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  entry.hooks.push({ command: '', timeoutSec: 5, type: 'shell' })
  schedulePersist()
}

function removeCommand(event: HookEvent, idx: number, cmdIdx: number) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  const entry = cfg?.hooks[event]?.[idx]
  if (!entry)
    return
  entry.hooks.splice(cmdIdx, 1)
  if (entry.hooks.length === 0) {
    entry.hooks.push({ command: '', timeoutSec: 5 })
  }
  schedulePersist()
}

async function handleExport() {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  if (!cfg)
    return
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ defaultPath: 'hooks.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (path)
      await writeFile(path, new TextEncoder().encode(JSON.stringify(cfg, null, 2)))
  }
  catch { /* ignore */ }
}

async function handleImport() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const selected = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (typeof selected === 'string') {
      const bytes = await readFile(selected)
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      if (parsed && typeof parsed === 'object' && 'hooks' in parsed) {
        const cfg = ensureConfig()
        Object.assign(cfg, parsed)
        schedulePersist()
      }
    }
  }
  catch { /* ignore */ }
}

// ── custom events ────────────────────────────────────────────────────────
const newCustomName = ref('')
const newCustomDesc = ref('')
const newCustomBlockable = ref(false)
function addCustomEvent() {
  const name = newCustomName.value.trim()
  if (!name || !/^[A-Z_]\w*$/i.test(name))
    return
  const cfg = ensureConfig()
  if (!cfg.customEvents)
    cfg.customEvents = {}
  if (cfg.customEvents[name])
    return
  cfg.customEvents[name] = { ...(newCustomDesc.value ? { description: newCustomDesc.value } : {}), blockable: newCustomBlockable.value }
  newCustomName.value = ''
  newCustomDesc.value = ''
  newCustomBlockable.value = false
  schedulePersist()
}
function removeCustomEvent(name: string) {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  if (!cfg?.customEvents?.[name])
    return
  delete cfg.customEvents[name]
  if (cfg.hooks[name])
    delete cfg.hooks[name]
  schedulePersist()
}

// ── dry-run ───────────────────────────────────────────────────────────────
const dryRunTarget = ref('')
const dryRunResults = ref<Record<string, boolean>>({})
function runDryRun() {
  const cfg = isGlobal.value ? globalConfig.value : config.value
  if (!cfg)
    return
  const results: Record<string, boolean> = {}
  // keep fakeInput for future structured matching use
  void dryRunTarget.value
  for (const evt of activeEvents.value) {
    for (let i = 0; i < (cfg.hooks[evt]?.length ?? 0); i++) {
      const entry = cfg.hooks[evt]![i]!
      // use matchesHookEntry via dynamic import to avoid cycle
      // simple inline check: test matcher string
      const key = `${evt}:${i}`
      let matched = true
      if (entry.matcher && entry.matcher !== '') {
        matched = entry.matcher.split('|').some(p => {
          const trimmed = p.trim()
          if (!trimmed)
            return false
          if (trimmed.includes('*') || trimmed.includes('?')) {
            const re = new RegExp(`^${trimmed.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
            return re.test(dryRunTarget.value)
          }
          return dryRunTarget.value === trimmed
        })
      }
      if (matched && entry.match) {
        // simplified: if any match field present, require target to contain
        // real matching uses config.matchesHookEntry; we approximate
        matched = true
      }
      // Use real matcher if available via import
      try {
        // lazy import would be async, approximate for now
      }
      catch {}
      results[key] = matched
    }
  }
  dryRunResults.value = results
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (pickerOpen.value) {
      pickerOpen.value = false
      return
    }
    emit('close')
  }
}

watch(() => project.projectPath, () => {
  if (project.projectPath && scope.value === 'project')
    hooksStore.loadConfig(project.projectPath)
}, { immediate: true })

watch(() => scope.value, s => {
  if (s === 'global')
    hooksStore.loadGlobalConfig()
  else if (project.projectPath)
    hooksStore.loadConfig(project.projectPath)
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[99999] bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] backdrop-blur-[2px] flex items-center justify-center p-6" data-overlay @click.self="emit('close')" @keydown="onKeydown">
      <div class="flex flex-col w-[920px] max-w-full h-[620px] max-h-[calc(100vh-48px)] bg-[var(--color-bg-card)] border border-[var(--color-border-bright)] rounded-[var(--radius-lg)] shadow-[var(--color-shadow-floating)] overflow-hidden animate-[modal-in_160ms_cubic-bezier(0.2,0,0,1)_both]" role="dialog" aria-modal="true" aria-label="Lifecycle Hooks">
        <div class="flex items-center justify-between h-11 min-h-[44px] pl-5 pr-[14px] border-b border-[var(--color-border-subtle)] shrink-0 bg-[var(--color-bg-card)] rounded-t-[var(--radius-lg)] overflow-visible relative z-20 gap-2">
          <span class="text-[13px] font-semibold text-[var(--color-text-secondary)] tracking-[0.04em] uppercase shrink-0">Lifecycle Hooks</span>
          <div class="flex items-center gap-1">
            <button class="inline-flex items-center gap-1.5 h-[28px] px-2.5 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] text-[12px] font-medium hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)] transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease]" @click="handleImport">
              Import
            </button>
            <button class="inline-flex items-center gap-1.5 h-[28px] px-2.5 border border-transparent rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] text-[12px] font-medium hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)] transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease]" @click="handleExport">
              Export
            </button>
          </div>
          <div class="ml-auto flex items-center">
            <!-- inline project picker + Global -->
            <div class="relative flex items-center">
              <button
                :class="triggerClasses"
                aria-label="Select project"
                @click="togglePicker"
              >
                <Globe v-if="isGlobal" :size="13" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-tertiary)]" />
                <FolderOpen v-else :size="13" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-tertiary)]" />
                <span class="min-w-0 max-w-[140px] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{{ projectName ?? 'Select Project' }}</span>
              </button>

              <div class="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10000]">
                <Transition
                  enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top"
                  enter-from-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
                  enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
                  leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-top"
                  leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
                  leave-to-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
                >
                  <div
                    v-if="pickerOpen"
                    class="w-[210px] bg-[var(--color-bg-surface)] border border-[var(--color-border-mid)] rounded-[var(--radius-lg)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] p-1 flex flex-col gap-0.5"
                  >
                    <button
                      :class="itemClasses(isGlobal)"
                      @click="selectGlobal"
                    >
                      <Globe :size="13" :stroke-width="1.8" class="shrink-0" />
                      <span>Global</span>
                    </button>
                    <div class="h-px bg-[var(--color-border-mid)] mx-1 my-0.5" />
                    <button
                      :class="itemClasses(false, 'new')"
                      :disabled="picking"
                      @click="pickFolder"
                    >
                      <FolderPlus :size="13" :stroke-width="1.8" class="shrink-0" />
                      <span>New Project</span>
                    </button>

                    <template v-if="selectableProjects.length > 0">
                      <div class="h-px bg-[var(--color-border-mid)] mx-1 my-0.5" />
                      <button
                        v-for="path in selectableProjects"
                        :key="path"
                        :class="itemClasses(!isGlobal && project.projectPath === path)"
                        @click="selectProject(path)"
                      >
                        <FolderOpen :size="13" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-tertiary)]" />
                        <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() }}</span>
                      </button>
                    </template>
                  </div>
                </Transition>
              </div>

              <div v-if="pickerOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="closePicker" />
            </div>
          </div>
          <button class="grid place-items-center w-7 h-7 border-none rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-[background_120ms_ease,color_120ms_ease] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] shrink-0" aria-label="Close" @click="emit('close')">
            <X :size="14" :stroke-width="2" />
          </button>
        </div>

        <div class="flex flex-1 overflow-hidden min-h-0 min-w-0 bg-[var(--color-bg-card)] rounded-b-[var(--radius-lg)]">
          <!-- centered state when no project and not global — no sidebar -->
          <div
            v-if="!isGlobal && !project.projectPath"
            class="flex-1 flex flex-col items-center justify-center gap-3 py-8 px-6 text-center -translate-y-[22px]"
          >
            <span class="text-[13px] font-medium text-[var(--color-text-secondary)]">No project open</span>
            <span class="text-xs text-[var(--color-text-tertiary)]">Open a project to configure hooks.</span>
          </div>

          <!-- loading -->
          <div
            v-else-if="activeLoading"
            class="flex-1 flex flex-col items-center justify-center gap-3 py-8 px-6 text-center -translate-y-[22px]"
          >
            <RefreshCw :size="18" class="animate-spin text-[var(--color-text-dim)]" />
            <span class="text-xs text-[var(--color-text-tertiary)]">Loading hooks...</span>
          </div>

          <!-- centered state when no hooks.json — no sidebar -->
          <div
            v-else-if="!activeExists"
            class="flex-1 flex flex-col items-center justify-center gap-3 py-8 px-6 text-center -translate-y-[22px]"
          >
            <span class="text-[13px] text-[var(--color-text-tertiary)]">Nothing to see here...</span>
            <button class="inline-flex items-center gap-1.5 h-[30px] px-3 border border-[var(--color-accent-dim)] rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent-bright)] text-[12.5px] font-medium cursor-pointer transition-[background_120ms_ease,border-color_120ms_ease] hover:bg-[var(--color-accent-muted-plus)] hover:border-[var(--color-accent)]" @click="handleCreateConfig">
              <Plus :size="13" />
              Create hooks.json
            </button>
          </div>

          <!-- normal: sidebar + content -->
          <template v-else>
            <nav class="flex flex-col w-[200px] min-w-[200px] py-3 px-2 gap-px border-r border-[var(--color-border-subtle)] shrink-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] bg-[var(--color-bg-card)]">
              <template v-for="group in GROUPS" :key="group">
                <div class="px-2 pt-3.5 pb-1.5 first:pt-1">
                  <span class="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-text-tertiary)] select-none">{{ group }}</span>
                </div>
                <template v-for="item in NAV.filter(n => n.group === group)" :key="item.id">
                  <button
                    v-if="item.id !== 'custom' || true"
                    class="group flex items-center gap-[9px] h-[34px] px-[10px] pr-2 border-none rounded-[var(--radius-md)] text-[13px] font-[450] cursor-pointer text-left transition-[background_120ms_ease,color_120ms_ease,transform_100ms_ease] relative w-full active:scale-[0.98]" :class="[
                      activeSection === item.id
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]'
                        : 'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)]',
                    ]"
                    @click="activeSection = item.id"
                  >
                    <component :is="item.icon" :size="14" :stroke-width="1.8" class="shrink-0" />
                    <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
                  </button>
                </template>
              </template>
            </nav>

            <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pt-5 px-6 pb-7 flex flex-col gap-4 items-stretch [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] bg-[var(--color-bg-card)]">
              <!-- dry-run bar -->
              <div class="flex items-center gap-2 p-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 shadow-[0_1px_2px_color-mix(in_srgb,var(--color-border-subtle)_40%,transparent)]">
                <div class="grid place-items-center w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] shrink-0">
                  <Search :size="13" class="text-[var(--color-text-tertiary)]" />
                </div>
                <input v-model="dryRunTarget" placeholder="Test matcher — e.g. src/foo.ts or write_file" class="flex-1 min-w-0 h-7 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)] transition-[border-color_130ms_ease,background_130ms_ease]">
                <button class="h-7 px-3.5 border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] text-[12px] font-medium hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-bright)] transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease]" @click="runDryRun">
                  Test
                </button>
              </div>

              <!-- custom events manager -->
              <div v-if="activeSection === 'custom'" class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0">
                <div class="pt-4 px-5 pb-3 border-b border-[var(--color-border-subtle)]">
                  <h3 class="m-0 text-[13px] font-semibold text-[var(--color-text-secondary)]">
                    Custom Events
                  </h3>
                  <span class="text-xs text-[var(--color-text-tertiary)]">Define your own events (e.g., OnDeploy) and trigger via runCustomHook</span>
                </div>
                <div class="p-4 flex flex-col gap-3">
                  <div v-if="customSectionEvents.length === 0" class="text-xs text-[var(--color-text-dim)] italic">
                    No custom events yet.
                  </div>
                  <div v-for="evt in customSectionEvents" :key="evt" class="flex items-center justify-between gap-2 p-2 border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)]">
                    <div class="flex flex-col">
                      <span class="text-[12.5px] font-medium text-[var(--color-text-primary)]">{{ evt }}</span>
                      <span class="text-[11px] text-[var(--color-text-tertiary)]">{{ (isGlobal ? globalConfig?.customEvents?.[evt]?.description : config?.customEvents?.[evt]?.description) ?? 'Custom event' }} · {{ (isGlobal ? globalConfig?.customEvents?.[evt]?.blockable : config?.customEvents?.[evt]?.blockable) ? 'blockable' : 'not blockable' }}</span>
                    </div>
                    <button class="grid place-items-center w-7 h-7 border border-[var(--color-border-mid)] rounded-[var(--radius-md)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] hover:text-[var(--color-danger-text)]" @click="removeCustomEvent(evt)">
                      <Trash2 :size="13" />
                    </button>
                  </div>
                  <div class="flex items-end gap-2 pt-2 border-t border-dashed border-[var(--color-border-subtle)]">
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                      <label class="text-[11px] font-medium text-[var(--color-text-secondary)]">Name (A-Za-z0-9_)</label>
                      <input v-model="newCustomName" placeholder="MyEvent" class="h-8 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]">
                    </div>
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                      <label class="text-[11px] font-medium text-[var(--color-text-secondary)]">Description</label>
                      <input v-model="newCustomDesc" placeholder="Fires on ..." class="h-8 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]">
                    </div>
                    <label class="flex items-center gap-1.5 h-8 px-2 text-[11.5px] text-[var(--color-text-secondary)] shrink-0 whitespace-nowrap"><input v-model="newCustomBlockable" type="checkbox" class="shrink-0"> blockable</label>
                    <button class="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 shrink-0 whitespace-nowrap border border-[var(--color-accent-dim)] rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent-bright)] text-[12px] font-medium hover:bg-[var(--color-accent-muted-plus)] hover:border-[var(--color-accent)] transition-[background_120ms_ease,border-color_120ms_ease]" @click="addCustomEvent">
                      <Plus :size="13" class="shrink-0" /> Add
                    </button>
                  </div>
                  <div v-for="evt in customSectionEvents" :key="`${evt}-cfg`" class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden">
                    <div class="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]">
                      <span class="text-[12px] font-semibold text-[var(--color-text-secondary)]">{{ evt }} — {{ hookCount(evt as HookEvent) }} hooks</span>
                      <button class="inline-flex items-center gap-1 h-7 px-2.5 border border-[var(--color-accent-dim)] rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent-bright)] text-[11.5px] font-medium" @click="addHookEntry(evt as HookEvent)">
                        <Plus :size="12" /> Add hook
                      </button>
                    </div>
                    <div v-if="entriesFor(evt as HookEvent).length === 0" class="p-3 text-xs text-[var(--color-text-dim)] italic text-center">
                      No hooks for this event yet.
                    </div>
                    <div v-for="(entry, idx) in entriesFor(evt as HookEvent)" :key="idx" class="border-b border-[var(--color-border-subtle)] last:border-b-0">
                      <div class="p-3 flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                          <input :value="entry.matcher ?? ''" placeholder="Matcher e.g. * or src/**" class="flex-1 h-7 px-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px]" @input="updateMatcher(evt as HookEvent, idx, ($event.target as HTMLInputElement).value)">
                          <button class="h-7 px-2 border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[11px]" @click="removeHookEntry(evt as HookEvent, idx)">
                            <Trash2 :size="12" />
                          </button>
                        </div>
                        <div v-for="(hook, cmdIdx) in entry.hooks" :key="cmdIdx" class="flex items-center gap-2">
                          <input :value="hook.command" placeholder="command" class="flex-1 h-7 px-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px]" @input="updateCommand(evt as HookEvent, idx, cmdIdx, ($event.target as HTMLInputElement).value)">
                          <input :value="hook.timeoutSec ?? 5" type="number" class="w-14 h-7 px-1 text-center bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px]" @input="updateTimeout(evt as HookEvent, idx, cmdIdx, Number(($event.target as HTMLInputElement).value))">
                          <button class="w-7 h-7 grid place-items-center border border-[var(--color-border-mid)] rounded-[var(--radius-md)]" @click="removeCommand(evt as HookEvent, idx, cmdIdx)">
                            <Trash2 :size="12" />
                          </button>
                        </div>
                        <button class="self-start h-6 px-2 border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[11px]" @click="addCommandToEntry(evt as HookEvent, idx)">
                          + Add command
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <template v-else>
                <div
                  v-for="event in activeEvents"
                  :key="event"
                  class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0"
                >
                  <div class="flex items-start justify-between gap-2.5 pt-4 px-5 pb-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-text-primary)] tracking-[0.01em] flex items-center gap-2">
                        {{ (EVENT_META[event] ?? { label: event, desc: customEvents[event]?.description ?? 'Custom event', blockable: !!customEvents[event]?.blockable, matcherHint: '' }).label }}
                        <span v-if="(EVENT_META[event]?.blockable ?? !!customEvents[event]?.blockable)" class="text-[10px] font-semibold tracking-[0.04em] uppercase text-[var(--color-warning-text)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] py-px px-1.5 rounded-[var(--radius-sm)]">blockable</span>
                      </h3>
                      <span class="text-xs text-[var(--color-text-tertiary)] leading-[1.4]">{{ (EVENT_META[event] ?? { desc: '' }).desc }}</span>
                    </div>
                    <span class="text-[11px] font-medium text-[var(--color-text-tertiary)] py-1 px-2.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] shrink-0 mt-0.5 whitespace-nowrap">{{ hookCount(event) }} hook{{ hookCount(event) === 1 ? '' : 's' }}</span>
                  </div>

                  <div class="flex flex-col">
                    <div v-if="entriesFor(event).length === 0" class="py-4 px-5 text-xs text-[var(--color-text-dim)] italic text-center border-b border-[var(--color-border-subtle)]">
                      No hooks for this event yet.
                    </div>

                    <div
                      v-for="(entry, idx) in entriesFor(event)"
                      :key="idx"
                      class="flex flex-col border-b border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-bg-base)_40%,transparent)] shrink-0"
                    >
                      <!-- entry header: name/priority/enabled/runMode -->
                      <div class="flex items-center gap-2 px-5 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                        <input :value="entry.name ?? ''" placeholder="Name (optional)" class="h-7 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)] transition-[border-color_130ms_ease,background_130ms_ease] w-[148px]" @input="updateEntryField(event, idx, 'name', ($event.target as HTMLInputElement).value)">
                        <input :value="entry.description ?? ''" placeholder="Description" class="flex-1 min-w-0 h-7 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)] transition-[border-color_130ms_ease,background_130ms_ease]" @input="updateEntryField(event, idx, 'description', ($event.target as HTMLInputElement).value)">
                        <label class="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] cursor-pointer select-none shrink-0"><input type="checkbox" class="w-3.5 h-3.5 rounded-[3px] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] accent-[var(--color-accent)]" :checked="entry.enabled !== false" @change="updateEntryEnabled(event, idx, ($event.target as HTMLInputElement).checked)"> enabled</label>
                        <span class="text-[11px] font-medium text-[var(--color-text-tertiary)] shrink-0">prio</span>
                        <input :value="entry.priority ?? 0" type="number" class="w-[64px] h-7 px-1 text-center bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-dim)]" @input="updatePriority(event, idx, Number(($event.target as HTMLInputElement).value))">
                        <select :value="entry.runMode ?? 'sequential'" class="h-7 px-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-dim)]" @change="updateRunMode(event, idx, ($event.target as HTMLSelectElement).value)">
                          <option value="sequential">
                            sequential
                          </option>
                          <option value="parallel">
                            parallel
                          </option>
                          <option value="race">
                            race
                          </option>
                        </select>
                        <button class="text-[11px] font-medium px-2.5 h-7 border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-bright)] transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease]" @click="toggleEntryExpanded(event, idx)">
                          {{ isEntryExpanded(event, idx) ? 'Collapse' : 'Expand' }}
                        </button>
                      </div>

                      <!-- matcher row -->
                      <div class="flex items-center justify-between gap-4 py-3.5 px-5 border-b border-[var(--color-border-subtle)] shrink-0 bg-[var(--color-bg-surface)]">
                        <div class="flex flex-col gap-[3px] flex-1 min-w-0">
                          <span class="text-[13px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">Matcher</span>
                          <span class="text-xs text-[var(--color-text-tertiary)] leading-[1.4]">{{ (EVENT_META[event]?.matcherHint) || 'Leave empty to match all — supports *, **, ?, {a,b}, !neg, /regex/' }}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <span v-if="dryRunResults[`${event}:${idx}`] !== undefined" class="text-[11px] font-medium px-2 py-0.5 rounded-full border" :class="dryRunResults[`${event}:${idx}`] ? 'bg-[var(--color-success-muted)] text-[var(--color-success-text)] border-[color-mix(in_srgb,var(--color-success)_18%,transparent)]' : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] border-[var(--color-border-subtle)]'">{{ dryRunResults[`${event}:${idx}`] ? 'matches' : 'no match' }}</span>
                          <input
                            :value="entry.matcher ?? ''"
                            type="text"
                            class="h-8 px-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-lg)] text-[var(--color-text-primary)] text-[13px] font-[inherit] outline-none transition-[border-color_130ms_ease,background_130ms_ease] shrink-0 w-[210px] placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)]"
                            :placeholder="(EVENT_META[event]?.matcherHint) || 'e.g., *'"
                            autocomplete="off"
                            spellcheck="false"
                            @input="updateMatcher(event, idx, ($event.target as HTMLInputElement).value)"
                          >
                        </div>
                      </div>

                      <!-- advanced structured matcher -->
                      <div class="px-5 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                        <button class="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-accent-text)] hover:text-[var(--color-accent-bright)] transition-colors" @click="toggleAdvanced(event, idx)">
                          <span class="w-1.5 h-1.5 rounded-full" :class="isAdvanced(event, idx) ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                          {{ isAdvanced(event, idx) ? 'Hide advanced matcher' : 'Advanced matcher (structured)' }}
                        </button>
                        <div v-if="isAdvanced(event, idx)" class="mt-3 grid grid-cols-2 gap-2 p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)]">
                          <input :value="entry.match?.toolName ?? ''" placeholder="toolName glob/regex" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'toolName', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.filePath ?? ''" placeholder="filePath glob/regex" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'filePath', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.command ?? ''" placeholder="command glob/regex" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'command', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.projectName ?? ''" placeholder="projectName" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'projectName', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.mode ?? ''" placeholder="mode" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'mode', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.prompt ?? ''" placeholder="prompt regex" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateMatchField(event, idx, 'prompt', ($event.target as HTMLInputElement).value)">
                          <input :value="entry.match?.input ? JSON.stringify(entry.match.input) : ''" placeholder="input JSON e.g. {&quot;pattern&quot;:&quot;*.ts&quot;}" class="col-span-2 h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @change="updateMatchInput(event, idx, ($event.target as HTMLInputElement).value)">
                        </div>
                      </div>

                      <!-- commands -->
                      <div
                        v-for="(hook, cmdIdx) in entry.hooks"
                        :key="cmdIdx"
                        class="flex flex-col"
                      >
                        <div class="flex flex-col gap-2.5 py-3 px-5 border-b border-[var(--color-border-subtle)] shrink-0 bg-[var(--color-bg-surface)]" :class="cmdIdx === 0 ? 'border-t-0' : 'border-t border-[var(--color-border-subtle)]'">
                          <div class="flex items-center gap-2">
                            <input
                              :value="hook.command"
                              type="text"
                              class="flex-1 h-8 px-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-lg)] text-[var(--color-text-primary)] text-[13px] font-[inherit] outline-none transition-[border-color_130ms_ease,background_130ms_ease] placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)]"
                              placeholder="e.g., echo hello or ./scripts/check.sh"
                              autocomplete="off"
                              spellcheck="false"
                              @input="updateCommand(event, idx, cmdIdx, ($event.target as HTMLInputElement).value)"
                            >
                            <select :value="hook.type ?? 'shell'" class="h-8 px-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-lg)] text-[12px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-dim)] focus:bg-[var(--color-bg-card)]" @change="updateCommandType(event, idx, cmdIdx, ($event.target as HTMLSelectElement).value)">
                              <option value="shell">
                                shell
                              </option>
                              <option value="node">
                                node
                              </option>
                              <option value="js">
                                js
                              </option>
                            </select>
                            <div class="flex items-center gap-1 shrink-0 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-lg)] px-1.5 h-8 focus-within:border-[var(--color-accent-dim)] transition-[border-color_130ms_ease]">
                              <input
                                :value="hook.timeoutSec ?? 5"
                                type="number"
                                min="1"
                                max="900"
                                class="h-6 w-12 bg-transparent border-none rounded-none text-[var(--color-text-primary)] text-[13px] font-[inherit] outline-none text-center placeholder:text-[var(--color-text-dim)]"
                                @input="updateTimeout(event, idx, cmdIdx, Number(($event.target as HTMLInputElement).value))"
                              >
                              <span class="text-[11px] text-[var(--color-text-tertiary)] font-medium">s</span>
                            </div>
                            <label class="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] cursor-pointer select-none shrink-0"><input type="checkbox" class="w-3.5 h-3.5 rounded-[3px] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] accent-[var(--color-accent)]" :checked="hook.enabled !== false" @change="updateCommandEnabled(event, idx, cmdIdx, ($event.target as HTMLInputElement).checked)"> on</label>
                            <button
                              class="grid place-items-center w-[30px] h-[30px] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] cursor-pointer transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease] shrink-0 hover:bg-[var(--color-danger-muted)] hover:border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:text-[var(--color-danger-text)]"
                              title="Remove command"
                              type="button"
                              @click="removeCommand(event, idx, cmdIdx)"
                            >
                              <Trash2 :size="13" :stroke-width="1.8" />
                            </button>
                          </div>
                          <div v-if="isEntryExpanded(event, idx)" class="grid grid-cols-2 gap-2 p-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)]">
                            <input :value="hook.cwd ?? ''" placeholder="cwd (optional, default workspace)" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateCommandCwd(event, idx, cmdIdx, ($event.target as HTMLInputElement).value)">
                            <input :value="hook.env ? JSON.stringify(hook.env) : ''" placeholder="env JSON or KEY=val,FOO=bar" class="h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @change="updateCommandEnv(event, idx, cmdIdx, ($event.target as HTMLInputElement).value)">
                            <input v-if="hook.type === 'node' || hook.type === 'js'" :value="hook.file ?? ''" placeholder="file path (for node/js)" class="col-span-2 h-7 px-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent-dim)]" @input="updateCommandFile(event, idx, cmdIdx, ($event.target as HTMLInputElement).value)">
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-2 py-2.5 px-5 bg-[var(--color-bg-surface)] border-t border-dashed border-[var(--color-border-subtle)]">
                        <button class="inline-flex items-center gap-1.5 h-[26px] px-[9px] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-secondary)] text-[11.5px] font-medium cursor-pointer transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-tertiary)]" type="button" @click="addCommandToEntry(event, idx)">
                          <Plus :size="12" />
                          Add command
                        </button>
                        <button class="inline-flex items-center gap-1.5 h-[26px] px-[9px] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-tertiary)] text-[11.5px] font-medium cursor-pointer transition-[background_120ms_ease,border-color_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:text-[var(--color-danger-text)]" type="button" @click="removeHookEntry(event, idx)">
                          <Trash2 :size="12" />
                          Remove entry
                        </button>
                      </div>
                    </div>

                    <div class="flex items-center justify-start gap-4 py-3.5 px-5 bg-[var(--color-bg-surface)] shrink-0">
                      <button class="inline-flex items-center gap-1.5 h-[30px] px-3 border border-[var(--color-accent-dim)] rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent-bright)] text-[12.5px] font-medium cursor-pointer transition-[background_120ms_ease,border-color_120ms_ease] hover:bg-[var(--color-accent-muted-plus)] hover:border-[var(--color-accent)]" type="button" @click="addHookEntry(event)">
                        <Plus :size="13" />
                        Add hook
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
