<script setup lang="ts">
import { Pencil, RotateCcw, Save, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useSettingsStore } from '@/stores/settings'
import { SYSTEM_PROMPTS } from '@/utils/tools/promptDescriptions'
import { DEFAULT_TOOL_DESCRIPTIONS } from '@/utils/tools/toolDescriptions'
import DeveloperPopup from '../components/developer/DeveloperPopup.vue'
import DeveloperSidebar from '../components/developer/DeveloperSidebar.vue'
import ProvidersModelsPanel from '../components/developer/ProvidersModelsPanel.vue'
import SecurityPanel from '../components/developer/SecurityPanel.vue'

const settings = useSettingsStore()

const selectedItem = ref('prompt')
const selectedProviderId = ref<string | null>('global')
const popupOpen = ref(false)

interface ToolInfo {
  id: string
  label: string
  description: string
  groupLabel: string
}

interface PromptInfo {
  id: string
  label: string
  content: string
  group?: string
  description?: string
}

interface DevTab {
  id: string
  label: string
  type: 'tool' | 'prompt'
  itemId: string
}

const tabs = ref<DevTab[]>([])
const activeTabId = ref<string | null>(null)

// ── edit state ────────────────────────────────────────────────────────────────
const editingTabId = ref<string | null>(null)
const editText = ref('')

const activeContent = computed(() => {
  if (!activeTabId.value)
    return null
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab)
    return null
  return getOriginalContent(tab)
})

const hasOverride = computed(() => {
  if (!activeTabId.value)
    return false
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab)
    return false
  if (tab.type === 'tool')
    return tab.itemId in settings.toolDescriptionOverrides
  return `prompt-${tab.itemId}` in settings.promptOverrides
})

function getOriginalContent(tab: DevTab): string {
  if (tab.type === 'tool') {
    return settings.toolDescriptionOverrides[tab.itemId]
      ?? DEFAULT_TOOL_DESCRIPTIONS[tab.itemId as keyof typeof DEFAULT_TOOL_DESCRIPTIONS]
      ?? ''
  }
  const prompt = SYSTEM_PROMPTS.find(p => p.id === tab.itemId)
  return settings.promptOverrides[`prompt-${tab.itemId}`] ?? prompt?.content ?? ''
}

function openToolTab(tool: ToolInfo) {
  const existing = tabs.value.find(t => t.id === tool.id)
  if (existing) {
    activeTabId.value = existing.id
  }
  else {
    tabs.value.push({ id: tool.id, label: tool.label, type: 'tool', itemId: tool.id })
    activeTabId.value = tool.id
  }
  editingTabId.value = null
  popupOpen.value = false
}

function openPromptTab(prompt: PromptInfo) {
  const tabId = `prompt-${prompt.id}`
  const existing = tabs.value.find(t => t.id === tabId)
  if (existing) {
    activeTabId.value = existing.id
  }
  else {
    tabs.value.push({ id: tabId, label: prompt.label, type: 'prompt', itemId: prompt.id })
    activeTabId.value = tabId
  }
  editingTabId.value = null
  popupOpen.value = false
}

function closeTab(tabId: string) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx === -1)
    return
  if (editingTabId.value === tabId)
    cancelEdit()
  tabs.value.splice(idx, 1)
  if (activeTabId.value === tabId) {
    const nextTab = tabs.value[Math.min(idx, tabs.value.length - 1)]
    activeTabId.value = nextTab?.id ?? null
  }
}

function selectTab(tabId: string) {
  if (editingTabId.value && editingTabId.value !== tabId)
    cancelEdit()
  activeTabId.value = tabId
}

// ── edit actions ──────────────────────────────────────────────────────────────
function enterEdit() {
  if (!activeTabId.value)
    return
  editingTabId.value = activeTabId.value
  editText.value = activeContent.value ?? ''
}

function cancelEdit() {
  editingTabId.value = null
  editText.value = ''
}

function saveEdit() {
  if (!activeTabId.value)
    return
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab)
    return
  if (tab.type === 'tool') {
    settings.setToolDescriptionOverride(tab.itemId, editText.value)
  }
  else {
    settings.setPromptOverride(`prompt-${tab.itemId}`, editText.value)
  }
  editingTabId.value = null
  editText.value = ''
}

function resetToDefault() {
  if (!activeTabId.value)
    return
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab)
    return
  if (tab.type === 'tool') {
    settings.resetToolDescriptionOverride(tab.itemId)
  }
  else {
    settings.resetPromptOverride(`prompt-${tab.itemId}`)
  }
  editingTabId.value = null
  editText.value = ''
}

// ── resizable split ───────────────────────────────────────────────────────────
const SPLIT_MIN = 18 // %
const SPLIT_MAX = 60 // %
const splitPercent = ref(25)

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

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

watch(editingTabId, v => {
  if (v)
    editText.value = activeContent.value ?? ''
})
</script>

<template>
  <div class="dev-root">
    <div ref="containerRef" class="split" :class="{ 'split--dragging': dragging }">
      <!-- left: sidebar -->
      <div class="split-panel split-panel--left" :style="{ width: `${splitPercent}%` }">
        <DeveloperSidebar v-model="selectedItem" v-model:selected-provider="selectedProviderId" />
      </div>

      <!-- drag handle -->
      <div
        class="split-handle"
        :class="{ 'split-handle--active': dragging }"
        @mousedown="onDragStart"
      />

      <!-- right: content area -->
      <div class="split-panel split-panel--right">
        <template v-if="selectedItem === 'providers-models'">
          <ProvidersModelsPanel :selected-provider-id="selectedProviderId ?? 'global'" />
        </template>
        <template v-else-if="selectedItem === 'security'">
          <SecurityPanel />
        </template>
        <template v-else>
          <!-- tab bar -->
          <div class="dev-tabbar">
            <div class="flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                class="group/dev-tab flex h-[30px] w-[140px] min-w-[140px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-t-[var(--radius-sm)] border-b border-l border-r border-t pl-[10px] pr-[8px] text-[12px] font-[450] transition-[background,color,border-color] duration-[120ms] ease-[ease]"
                :class="activeTabId === tab.id
                  ? 'cursor-default border-b-[var(--color-bg-base)] border-l-[var(--color-border-subtle)] border-r-[var(--color-border-subtle)] border-t-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                  : 'cursor-pointer border-b-[var(--color-border-subtle)] border-l-transparent border-r-transparent border-t-transparent bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]'"
                @click="selectTab(tab.id)"
              >
                <span class="min-w-0 flex-1 overflow-hidden text-ellipsis">{{ tab.label }}</span>
                <span
                  class="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-[opacity,background] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
                  :class="activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover/dev-tab:opacity-100'"
                  role="button"
                  aria-label="Close tab"
                  @click.stop="closeTab(tab.id)"
                >
                  <X :size="11" :stroke-width="2" />
                </span>
              </button>
            </div>

            <div class="flex shrink-0 items-center gap-1 pb-[4px] pl-2">
              <button
                class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
                aria-label="Open developer tools"
                @click="popupOpen = true"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" /></svg>
              </button>
              <template v-if="activeTabId">
                <div class="mx-1 h-4 w-px shrink-0 bg-[var(--color-border-subtle)]" />
                <template v-if="editingTabId === activeTabId">
                  <button
                    type="button"
                    class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent-dim)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] transition-[background,color,border-color] duration-[120ms] ease-[ease] hover:brightness-105"
                    aria-label="Save"
                    title="Save (Ctrl+S)"
                    @click="saveEdit"
                  >
                    <Save :size="13" :stroke-width="2" />
                  </button>
                  <button
                    type="button"
                    class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
                    aria-label="Cancel"
                    title="Cancel (Esc)"
                    @click="cancelEdit"
                  >
                    <X :size="13" :stroke-width="2" />
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                    aria-label="Edit"
                    title="Edit"
                    @click="enterEdit"
                  >
                    <Pencil :size="13" :stroke-width="1.8" />
                  </button>
                  <button
                    v-if="hasOverride"
                    type="button"
                    class="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-danger-text)]"
                    aria-label="Reset to default"
                    title="Reset to default"
                    @click="resetToDefault"
                  >
                    <RotateCcw :size="13" :stroke-width="1.8" />
                  </button>
                </template>
              </template>
            </div>
          </div>

          <!-- content area -->
          <div class="dev-content">
            <template v-if="activeTabId && editingTabId === activeTabId">
              <textarea
                v-model="editText"
                class="dev-editor"
                spellcheck="false"
                @keydown.ctrl.s.prevent="saveEdit"
                @keydown.meta.s.prevent="saveEdit"
                @keydown.esc="cancelEdit"
              />
            </template>
            <template v-else-if="activeContent">
              <div class="tool-viewer">
                <div class="tool-viewer-body">
                  <pre class="tool-viewer-code">{{ activeContent }}</pre>
                </div>
              </div>
            </template>
            <div v-else class="dev-content-empty">
              <div class="dev-empty-state">
                <span class="dev-empty-title">Nothing to see here...</span>
                <span class="dev-empty-desc">Click "+" to browse and edit prompts and tools</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <DeveloperPopup
      v-if="popupOpen"
      @close="popupOpen = false"
      @select-tool="openToolTab"
      @select-prompt="openPromptTab"
    />
  </div>
</template>

<style scoped>
.dev-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

.split {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.split--dragging {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}

.split-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.split-panel--left {
  width: 220px;
  min-width: 160px;
  min-height: 0;
  border-right: none;
}

.split-panel--right {
  flex: 1;
  min-width: 200px;
  min-height: 0;
  overflow: hidden;
}

.split-handle {
  position: relative;
  width: 1px;
  background: var(--color-border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 10;
}

.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
  z-index: 11;
}

.split-handle:hover,
.split-handle--active {
  background: var(--color-accent, #10b981);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent, #10b981) 20%, transparent);
}

.dev-tabbar {
  display: flex;
  height: 36px;
  min-height: 36px;
  align-items: flex-end;
  background: var(--color-bg-surface);
  padding-inline: 4px;
  box-shadow: inset 0 -1px 0 var(--color-border-subtle);
}

.dev-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  min-height: 32px;
  padding-inline: 10px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-surface);
  flex-shrink: 0;
}

.dev-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding-inline: 8px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.dev-toolbar-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-strong);
}

.dev-toolbar-btn--primary {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.dev-toolbar-btn--primary:hover {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.dev-toolbar-btn--reset {
  border-color: transparent;
  background: transparent;
  color: var(--color-text-tertiary);
}

.dev-toolbar-btn--reset:hover {
  color: var(--color-danger-text);
  background: transparent;
}

.dev-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.dev-content-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dev-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.dev-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.dev-empty-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.tool-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tool-viewer-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.tool-viewer-code {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.dev-editor {
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 16px;
  background: var(--color-bg-base);
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
}
</style>
