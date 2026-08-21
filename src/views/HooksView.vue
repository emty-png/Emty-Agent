<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { ExternalLink, FileText, FolderOpen, RefreshCw, Save, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import HookEventCard from '@/components/hooks/HookEventCard.vue'
import HookLogEntry from '@/components/hooks/HookLogEntry.vue'
import { ALL_HOOK_EVENTS, useHooksStore } from '@/stores/hooks'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const hooks = useHooksStore()
const { splitPercent } = storeToRefs(project)
const { config, configExists, loading, hookLog } = storeToRefs(hooks)

const activeTab = ref<'events' | 'log' | 'config'>('events')

// ── config editor state ──────────────────────────────────────────────────────
const rawConfig = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

// ── sidebar ──────────────────────────────────────────────────────────────────
const picking = ref(false)

const tabBtnBaseClass = 'px-[14px] py-1.5 text-xs font-medium font-[inherit] border-0 border-b-2 border-solid bg-transparent cursor-pointer transition-[color,border-color] duration-[120ms] ease-[ease] rounded-[var(--radius-sm)_var(--radius-sm)_0_0] hover:text-[var(--color-text-secondary)]'

const createConfigBtnClass = 'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-accent-dim)] bg-[var(--color-accent-muted)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-bright)] transition-colors hover:bg-[var(--color-accent-muted-plus)] hover:border-[var(--color-accent)]'

const panelHeaderBtnClass = 'inline-flex items-center justify-center w-5 h-5 border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-[background,color] duration-[120ms] ease-[ease]'

const actionBtnClass = 'inline-flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-[background,color] duration-[120ms] ease-[ease]'

const sidebarItemClass = 'group flex items-center gap-1.5 h-[30px] pl-3 pr-2.5 mx-1 cursor-pointer rounded-[var(--radius-md)] text-[12.5px] font-[inherit] transition-[background,color] duration-[120ms] ease-[ease] whitespace-nowrap overflow-hidden text-ellipsis select-none text-left w-[calc(100%-8px)]'

// ── load hooks config + raw JSON ──────────────────────────────────────────────
onMounted(() => {
  hooks.loadConfig(project.projectPath)
})

watch(() => project.projectPath, () => {
  hooks.loadConfig(project.projectPath)
  activeTab.value = 'events'
})

watch(activeTab, tab => {
  if (tab === 'config')
    loadRawConfig()
})

async function loadRawConfig() {
  if (!hooks.configPath) {
    rawConfig.value = ''
    return
  }
  try {
    rawConfig.value = await readTextFile(hooks.configPath)
  }
  catch {
    rawConfig.value = ''
  }
}

async function saveConfig() {
  if (!hooks.configPath)
    return
  saving.value = true
  saveError.value = null
  try {
    JSON.parse(rawConfig.value)
    await writeTextFile(hooks.configPath, rawConfig.value)
    if (project.projectPath)
      await hooks.loadConfig(project.projectPath)
  }
  catch (e) {
    saveError.value = String(e)
  }
  finally {
    saving.value = false
  }
}

async function handleCreateConfig() {
  if (project.projectPath) {
    await hooks.createDefaultConfig(project.projectPath)
    await loadRawConfig()
  }
}

async function openConfigFile() {
  if (hooks.configPath)
    await openPath(hooks.configPath)
}

// ── project sidebar actions ───────────────────────────────────────────────────
async function addProject() {
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
    if (typeof selected === 'string')
      project.addProject(selected)
  }
  finally {
    picking.value = false
  }
}

function selectProject(path: string) {
  project.setProject(path)
}

function removeProject(path: string) {
  project.removeProject(path)
}

function projectName(path: string) {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path
}

function totalHookCount(): number {
  if (!config.value)
    return 0
  return ALL_HOOK_EVENTS.reduce((sum, event) => sum + hooks.eventHookCount(event), 0)
}

// ── resizable split ───────────────────────────────────────────────────────────
const SPLIT_MIN = 18
const SPLIT_MAX = 60
const containerRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

function onDragStart(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value || !containerRef.value)
    return
  const rect = containerRef.value.getBoundingClientRect()
  const raw = ((e.clientX - rect.left) / rect.width) * 100
  splitPercent.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, raw))
}

function onMouseUp() {
  dragging.value = false
}

onMounted(async () => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

// ── breadcrumb segments ───────────────────────────────────────────────────────
function breadcrumb(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').slice(-4)
}
</script>

<template>
  <div
    ref="containerRef"
    class="flex flex-1 h-full overflow-hidden bg-[var(--color-bg-base)]"
    :class="dragging ? 'cursor-col-resize select-none [-webkit-user-select:none]' : ''"
  >
    <!-- ── left: project sidebar ─────────────────────────────────────── -->
    <div
      class="flex flex-col overflow-hidden shrink-0 bg-[var(--color-bg-surface)] min-w-[160px]"
      :style="{ width: `${splitPercent}%` }"
    >
      <div class="flex items-center h-[30px] min-h-[30px] px-3 border-b border-[var(--color-border-subtle)] shrink-0 gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="text-[var(--color-text-tertiary)]"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
        <span class="text-[11px] font-semibold tracking-[0.06em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap overflow-hidden text-ellipsis">Projects</span>
        <button
          class="ml-auto" :class="[panelHeaderBtnClass]"
          title="Add project"
          @click="addProject"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto py-1 [scrollbar-width:thin] [scrollbar-color:var(--color-border-mid)_transparent]">
        <div
          v-if="project.openProjects.length === 0"
          class="flex flex-col items-center justify-center gap-1.5 px-3 py-6 text-center"
        >
          <FolderOpen :size="16" class="text-[var(--color-text-dim)]" />
          <p class="m-0 text-[11px] text-[var(--color-text-dim)]">
            No projects open
          </p>
        </div>
        <button
          v-for="path in project.openProjects"
          :key="path"
          :class="[sidebarItemClass, project.projectPath === path
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-muted)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)]']"
          @click="selectProject(path)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[var(--color-text-tertiary)]"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ projectName(path) }}</span>
          <span
            v-if="project.projectPath === path && totalHookCount() > 0"
            class="text-[10px] font-semibold text-[var(--color-accent-text)] bg-[var(--color-accent-muted)] rounded-[99px] py-px px-1.5 shrink-0 group-hover:hidden"
          >{{ totalHookCount() }}</span>
          <span
            role="button"
            tabindex="0"
            class="hidden w-[18px] h-[18px] border-none rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer place-items-center shrink-0 group-hover:grid hover:text-[var(--color-danger-text)] hover:bg-[rgba(248,81,73,0.12)]"
            title="Remove project"
            @click.stop="removeProject(path)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </span>
        </button>
      </div>
    </div>

    <!-- drag handle -->
    <div
      class="relative w-px bg-[var(--color-border-subtle)] cursor-col-resize shrink-0 z-10 transition-[background,box-shadow] duration-[150ms] ease-[ease] after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-1 after:-right-1 after:z-[11] hover:bg-[var(--color-accent,#10b981)] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent,#10b981)_20%,transparent)]"
      :class="dragging ? 'bg-[var(--color-accent,#10b981)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent,#10b981)_20%,transparent)]' : ''"
      @mousedown="onDragStart"
    />

    <!-- ── right: main content ───────────────────────────────────────── -->
    <div class="flex flex-col overflow-hidden shrink-0 flex-1 min-w-[200px]">
      <!-- no project open -->
      <div
        v-if="!project.projectPath"
        class="flex-1 flex flex-col items-center justify-center gap-2 p-10 text-center"
      >
        <div class="text-[32px] text-[var(--color-accent-dim)] opacity-50 mb-1 leading-none">
          ⬡
        </div>
        <p class="text-sm font-medium text-[var(--color-text-secondary)] m-0">
          No project open
        </p>
        <p class="text-[12.5px] text-[var(--color-text-tertiary)] max-w-[240px] leading-[1.6] m-0">
          Select a project from the sidebar or add a new one
        </p>
      </div>

      <template v-else>
        <!-- tabs -->
        <div class="flex gap-0.5 pt-1.5 px-[14px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
          <button
            :class="[tabBtnBaseClass, activeTab === 'events' ? 'text-[var(--color-text-primary)] [border-bottom-color:var(--color-accent)]' : 'text-[var(--color-text-dim)] [border-bottom-color:transparent]']"
            @click="activeTab = 'events'"
          >
            Events
          </button>
          <button
            :class="[tabBtnBaseClass, activeTab === 'log' ? 'text-[var(--color-text-primary)] [border-bottom-color:var(--color-accent)]' : 'text-[var(--color-text-dim)] [border-bottom-color:transparent]']"
            @click="activeTab = 'log'"
          >
            Log
          </button>
          <button
            :class="[tabBtnBaseClass, activeTab === 'config' ? 'text-[var(--color-text-primary)] [border-bottom-color:var(--color-accent)]' : 'text-[var(--color-text-dim)] [border-bottom-color:transparent]']"
            @click="activeTab = 'config'"
          >
            Config
          </button>
        </div>

        <!-- loading -->
        <div v-if="loading" class="flex flex-1 items-center justify-center">
          <RefreshCw :size="18" class="animate-spin text-[var(--color-text-dim)]" />
        </div>

        <!-- no config file -->
        <div v-else-if="!configExists && activeTab !== 'config'" class="flex flex-1 flex-col items-center justify-center gap-3 px-[18px] py-8 text-center">
          <div class="flex h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
            <Zap :size="24" :stroke-width="2" />
          </div>
          <div class="flex flex-col gap-1">
            <p class="m-0 text-[14px] font-semibold text-[var(--color-text-primary)]">
              No hooks configured
            </p>
            <p class="m-0 text-[12.5px] text-[var(--color-text-tertiary)] leading-relaxed">
              Create a <code class="rounded-md bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[11.5px] text-[var(--color-accent)] font-medium border border-[var(--color-border-subtle)]">.emty/hooks.json</code> file in your project to define lifecycle hooks.
            </p>
          </div>
          <button
            :class="createConfigBtnClass"
            @click="handleCreateConfig"
          >
            <FileText :size="13" />
            Create hooks.json
          </button>
        </div>

        <!-- events tab -->
        <div
          v-else-if="activeTab === 'events'"
          class="flex-1 overflow-y-auto pt-3 px-3 pb-0 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]"
        >
          <div class="flex flex-col gap-1.5 pb-6">
            <HookEventCard
              v-for="event in ALL_HOOK_EVENTS"
              :key="event"
              :event="event"
              :entries="config?.hooks[event] ?? []"
              :enabled="hooks.enabledEvents.has(event)"
              :hook-count="hooks.eventHookCount(event)"
              @toggle="hooks.toggleEvent(event, !hooks.enabledEvents.has(event), project.projectPath)"
            />
          </div>
        </div>

        <!-- log tab -->
        <div
          v-else-if="activeTab === 'log'"
          class="flex-1 overflow-y-auto pt-3 px-3 pb-0 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]"
        >
          <div class="flex flex-col gap-1 pb-6">
            <div v-if="hookLog.length === 0" class="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
              <RefreshCw :size="16" class="text-[var(--color-text-dim)]" />
              <p class="m-0 text-xs text-[var(--color-text-dim)]">
                No hook executions yet
              </p>
            </div>
            <HookLogEntry
              v-for="entry in hookLog"
              :key="entry.id"
              :entry="entry"
            />
          </div>
        </div>

        <!-- config tab -->
        <div
          v-else-if="activeTab === 'config'"
          class="flex-1 flex flex-col overflow-hidden"
        >
          <div v-if="!configExists" class="flex flex-1 flex-col items-center justify-center gap-3 px-[18px] py-8 text-center">
            <div class="flex h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
              <Zap :size="24" :stroke-width="2" />
            </div>
            <div class="flex flex-col gap-1">
              <p class="m-0 text-[14px] font-semibold text-[var(--color-text-primary)]">
                No hooks configured
              </p>
              <p class="m-0 text-[12.5px] text-[var(--color-text-tertiary)] leading-relaxed">
                Create a <code class="rounded-md bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[11.5px] text-[var(--color-accent)] font-medium border border-[var(--color-border-subtle)]">.emty/hooks.json</code> file to get started.
              </p>
            </div>
            <button
              :class="createConfigBtnClass"
              @click="handleCreateConfig"
            >
              <FileText :size="13" />
              Create hooks.json
            </button>
          </div>
          <template v-else>
            <div class="flex items-center h-[30px] min-h-[30px] px-[14px] gap-0.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0 text-[11.5px] text-[var(--color-text-tertiary)]">
              <span
                v-for="(part, i) in breadcrumb(hooks.configPath!)"
                :key="i"
              >
                <span v-if="i > 0" class="mx-0.5 text-[var(--color-border-bright)]">/</span>
                <span :class="i === breadcrumb(hooks.configPath!).length - 1 ? 'text-[var(--color-text-secondary)] font-medium' : ''">{{ part }}</span>
              </span>
              <div class="ml-auto flex items-center gap-0.5">
                <button
                  v-if="configExists"
                  :class="actionBtnClass"
                  title="Refresh"
                  @click="loadRawConfig"
                >
                  <RefreshCw :size="12" :stroke-width="1.8" />
                </button>
                <button
                  :class="[actionBtnClass, saving ? 'opacity-50 pointer-events-none' : '']"
                  title="Save (Ctrl+S)"
                  :disabled="saving"
                  @click="saveConfig"
                >
                  <RefreshCw v-if="saving" :size="12" :stroke-width="1.8" class="animate-spin" />
                  <Save v-else :size="12" :stroke-width="1.8" />
                </button>
                <button
                  :class="actionBtnClass"
                  title="Open in system editor"
                  @click="openConfigFile"
                >
                  <ExternalLink :size="12" :stroke-width="1.8" />
                </button>
              </div>
            </div>
            <div v-if="saveError" class="px-[14px] py-1.5 text-[11px] text-[var(--color-danger-text)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)]">
              {{ saveError }}
            </div>
            <div class="flex-1 overflow-hidden flex flex-col">
              <textarea
                v-model="rawConfig"
                class="w-full h-full resize-none border-none outline-none p-2 px-[14px] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] font-['JetBrains_Mono','Fira_Code','Cascadia_Code','Consolas',monospace] text-[13px] leading-normal [tab-size:2] overflow-auto"
                spellcheck="false"
                @keydown.ctrl.s.prevent="saveConfig"
                @keydown.meta.s.prevent="saveConfig"
              />
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel-header-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}

.action-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}
</style>
