<script setup lang="ts">
import { AlertTriangle, Pencil, RotateCcw, Save, ShieldCheck, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getBlocklistParseErrors, SECURITY_ITEMS } from '@/utils/security/securityConfigs'

const settings = useSettingsStore()

interface SecTab {
  id: string
  label: string
  itemId: string
}

const tabs = ref<SecTab[]>([])
const activeTabId = ref<string | null>(null)
const editingTabId = ref<string | null>(null)
const editText = ref('')
const pickerOpen = ref(false)

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)

const activeContent = computed(() => {
  if (!activeTab.value)
    return null
  const item = SECURITY_ITEMS.find(i => i.id === activeTab.value!.itemId)
  if (!item)
    return null
  return settings.securityOverrides[activeTab.value.itemId] ?? item.content
})

const hasOverride = computed(() => {
  if (!activeTab.value)
    return false
  return activeTab.value.itemId in settings.securityOverrides
})

function hasItemOverride(id: string): boolean {
  return id in settings.securityOverrides
}

function openSecurityTab(id: string) {
  const item = SECURITY_ITEMS.find(i => i.id === id)
  if (!item)
    return
  const existing = tabs.value.find(t => t.id === id)
  if (existing) {
    activeTabId.value = existing.id
  }
  else {
    tabs.value.push({ id, label: item.label, itemId: id })
    activeTabId.value = id
  }
  editingTabId.value = null
  pickerOpen.value = false
}

function closeTab(tabId: string) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx === -1)
    return
  if (editingTabId.value === tabId)
    cancelEdit()
  tabs.value.splice(idx, 1)
  if (activeTabId.value === tabId) {
    const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
    activeTabId.value = next?.id ?? null
  }
}

function selectTab(tabId: string) {
  if (editingTabId.value && editingTabId.value !== tabId)
    cancelEdit()
  activeTabId.value = tabId
}

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
  settings.setSecurityOverride(tab.itemId, editText.value)
  editingTabId.value = null
  editText.value = ''
}

function resetToDefault() {
  if (!activeTabId.value)
    return
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab)
    return
  settings.resetSecurityOverride(tab.itemId)
  editingTabId.value = null
  editText.value = ''
}

watch(editingTabId, v => {
  if (v)
    editText.value = activeContent.value ?? ''
})

const editErrors = computed(() => {
  if (!editingTabId.value)
    return []
  // Only regex-based lists need validation; deny-roots are plain paths.
  const tab = tabs.value.find(t => t.id === editingTabId.value)
  if (!tab)
    return []
  const isRegexList = tab.itemId === 'sensitive-patterns' || tab.itemId.startsWith('shell-blocklist')
  if (!isRegexList)
    return []
  return getBlocklistParseErrors(editText.value)
})

const groupedItems = computed(() => {
  const map = new Map<string, typeof SECURITY_ITEMS>()
  for (const item of SECURITY_ITEMS) {
    const g = item.group || 'Security'
    if (!map.has(g))
      map.set(g, [])
    map.get(g)!.push(item)
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})

function onPickerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    pickerOpen.value = false
}
</script>

<template>
  <div class="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--color-bg-base)]">
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
          <ShieldCheck :size="11" :stroke-width="1.8" class="shrink-0 opacity-60" />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis text-left">{{ tab.label }}</span>
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
          aria-label="Browse security configs"
          @click="pickerOpen = true"
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

    <!-- content -->
    <div class="dev-content flex flex-col">
      <template v-if="activeTabId && editingTabId === activeTabId">
        <textarea
          v-model="editText"
          class="dev-editor flex-1"
          spellcheck="false"
          @keydown.ctrl.s.prevent="saveEdit"
          @keydown.meta.s.prevent="saveEdit"
          @keydown.esc="cancelEdit"
        />
        <div
          v-if="editErrors.length > 0"
          class="flex shrink-0 flex-col gap-1 border-t border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-danger-muted)_40%,transparent)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-danger-text)]"
        >
          <div class="flex items-center gap-1.5 font-[600]">
            <AlertTriangle :size="12" :stroke-width="2" />
            Invalid regex — these lines will be ignored:
          </div>
          <ul class="list-disc pl-5">
            <li v-for="(err, i) in editErrors" :key="i" class="font-mono text-[11px] break-all">
              {{ err }}
            </li>
          </ul>
        </div>
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
          <span class="dev-empty-desc">Click "+" to browse and edit security blocklists</span>
        </div>
      </div>
    </div>

    <!-- picker modal -->
    <Teleport to="body">
      <div v-if="pickerOpen" class="dev-popup-backdrop" data-overlay @click.self="pickerOpen = false" @keydown="onPickerKeydown">
        <div class="dev-popup-modal" role="dialog" aria-modal="true" aria-label="Security blocklists">
          <div class="modal-header">
            <span class="modal-title">Security Blocklists</span>
            <button class="modal-close" aria-label="Close" @click="pickerOpen = false">
              <X :size="14" :stroke-width="2" />
            </button>
          </div>
          <div class="modal-body">
            <div class="dev-content flex flex-col gap-4 !p-5">
              <div class="flex shrink-0 items-start gap-3 p-3 px-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-muted)] border border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] text-[12.5px] leading-[1.5]">
                <ShieldCheck :size="16" :stroke-width="1.8" class="shrink-0 text-[var(--color-accent-text)] mt-[1px]" />
                <span class="flex-1">Every path and command blocklist is fully editable. Changes are saved locally and applied immediately to <code class="font-mono text-[11px]">safePath</code> checks and <code class="font-mono text-[11px]">run_command</code> / <code class="font-mono text-[11px]">git_command</code> blocking.</span>
              </div>

              <div
                v-for="group in groupedItems"
                :key="group.name"
                class="settings-card"
              >
                <div class="settings-card-header">
                  <div class="settings-card-header-text">
                    <h3 class="settings-card-title">
                      {{ group.name }}
                    </h3>
                    <span class="settings-card-desc">
                      {{ group.name === 'Path Protection' ? 'Controls which files and directories the agent is forbidden to touch.' : 'Controls which shell commands are blocked before execution.' }}
                    </span>
                  </div>
                  <span class="group-badge">{{ group.items.length }} items</span>
                </div>
                <div class="settings-list">
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    type="button"
                    class="settings-item settings-item--clickable"
                    @click="openSecurityTab(item.id)"
                  >
                    <div class="settings-item-content">
                      <span class="settings-item-label">
                        {{ item.label }}
                        <span v-if="hasItemOverride(item.id)" class="override-dot" title="Custom override" />
                      </span>
                      <span class="settings-item-desc">{{ item.description }}</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
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
.dev-popup-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: color-mix(in srgb, var(--color-bg-base) 65%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dev-popup-modal {
  display: flex;
  flex-direction: column;
  width: 720px;
  max-width: 100%;
  height: 560px;
  max-height: calc(100vh - 48px);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  overflow: hidden;
  animation: modal-in 160ms cubic-bezier(0.2, 0, 0, 1) both;
}
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
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  min-height: 44px;
  padding-inline: 20px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.modal-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.modal-close:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}
.modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}
.modal-body .dev-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}
.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  flex-shrink: 0;
}
.settings-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.settings-card-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.settings-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.settings-card-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
.group-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  padding: 2px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  flex-shrink: 0;
  margin-top: 2px;
}
.settings-list {
  display: flex;
  flex-direction: column;
}
.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: none;
  border-left: none;
  border-right: none;
  border-top: none;
  width: 100%;
  text-align: left;
}
.settings-item:last-child {
  border-bottom: none;
}
.settings-item--clickable {
  cursor: pointer;
  transition: background 120ms ease;
}
.settings-item--clickable:hover {
  background: var(--color-state-hover);
}
.settings-item-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.settings-item-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.override-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  flex-shrink: 0;
}
.settings-item-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
</style>
