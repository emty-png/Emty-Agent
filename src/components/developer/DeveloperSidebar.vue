<script setup lang="ts">
import { Boxes, FileText, ShieldCheck } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const selectedItem = defineModel<string>({ default: 'prompt' })
const selectedProvider = defineModel<string | null>('selectedProvider', { default: 'global' })

const settings = useSettingsStore()
const { openai, anthropic, google, compatibleProviders } = storeToRefs(settings)

interface ProviderEntry {
  id: string
  name: string
  subtitle: string
  mdevId?: string
}

const builtinConfigured = computed<ProviderEntry[]>(() => {
  const list: ProviderEntry[] = []
  if (openai.value.apiKey.trim())
    list.push({ id: 'openai', name: 'OpenAI', subtitle: 'api.openai.com', mdevId: 'openai' })
  if (anthropic.value.apiKey.trim())
    list.push({ id: 'anthropic', name: 'Anthropic', subtitle: 'api.anthropic.com', mdevId: 'anthropic' })
  if (google.value.apiKey.trim())
    list.push({ id: 'google', name: 'Google Gemini', subtitle: 'generativelanguage.googleapis.com', mdevId: 'google' })
  return list
})

const compatibleConfigured = computed<ProviderEntry[]>(() => {
  return compatibleProviders.value
    .filter(p => p.baseURL.trim() || p.apiKey.trim() || (p.headers && Object.keys(p.headers).length > 0))
    .filter(p => p.apiKey.trim() || p.baseURL.trim())
    .map(p => {
      const entry: ProviderEntry = {
        id: p.id,
        name: p.name || 'Unnamed Provider',
        subtitle: p.baseURL || p.mdevId || p.id,
      }
      if (p.mdevId)
        entry.mdevId = p.mdevId
      return entry
    })
})

const configuredProviders = computed<ProviderEntry[]>(() => [
  ...builtinConfigured.value,
  ...compatibleConfigured.value,
])

function selectProvidersModels() {
  selectedItem.value = 'providers-models'
  if (!selectedProvider.value)
    selectedProvider.value = 'global'
}

function selectTreeItem(id: string) {
  selectedItem.value = 'providers-models'
  selectedProvider.value = id
}

watch(selectedItem, val => {
  if (val === 'providers-models' && !selectedProvider.value)
    selectedProvider.value = 'global'
})

// keep provider selection valid if providers list changes
watch(configuredProviders, list => {
  if (selectedItem.value !== 'providers-models')
    return
  if (selectedProvider.value === 'global')
    return
  if (selectedProvider.value && !list.some(p => p.id === selectedProvider.value)) {
    selectedProvider.value = 'global'
  }
})
</script>

<template>
  <div class="dev-sidebar-root">
    <div class="panel-header">
      <span class="panel-title">Developer</span>
    </div>
    <div class="panel-body">
      <button
        type="button"
        class="dev-sidebar-item"
        :class="{ 'dev-sidebar-item--active': selectedItem === 'prompt' }"
        @click="selectedItem = 'prompt'"
      >
        <FileText :size="14" :stroke-width="1.7" class="shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">Prompt</span>
      </button>
      <button
        type="button"
        class="dev-sidebar-item"
        :class="{ 'dev-sidebar-item--active': selectedItem === 'security' }"
        @click="selectedItem = 'security'"
      >
        <ShieldCheck :size="14" :stroke-width="1.7" class="shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">Security</span>
      </button>
      <button
        type="button"
        class="dev-sidebar-item"
        :class="{ 'dev-sidebar-item--active': selectedItem === 'providers-models' }"
        @click="selectProvidersModels"
      >
        <Boxes :size="14" :stroke-width="1.7" class="shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">Providers / Models</span>
      </button>

      <!-- Tree below Providers / Models -->
      <div v-if="selectedItem === 'providers-models'" class="dev-tree">
        <button
          type="button"
          class="dev-tree-item"
          :class="{ 'dev-tree-item--active': selectedProvider === 'global' }"
          @click="selectTreeItem('global')"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">Global</span>
        </button>

        <div v-if="configuredProviders.length === 0" class="dev-tree-empty">
          No providers configured
        </div>

        <button
          v-for="p in configuredProviders"
          :key="p.id"
          type="button"
          class="dev-tree-item"
          :class="{ 'dev-tree-item--active': selectedProvider === p.id }"
          @click="selectTreeItem(p.id)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">{{ p.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dev-sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-surface);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  height: 30px;
  min-height: 30px;
  padding-inline: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.dev-sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding-inline: 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.dev-sidebar-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.dev-sidebar-item--active {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.dev-sidebar-item--active:hover {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.dev-tree {
  display: flex;
  flex-direction: column;
  padding: 4px 8px 8px 16px;
  gap: 1px;
  border-left: 1px solid var(--color-border-subtle);
  margin-left: 12px;
  margin-top: 2px;
}

.dev-tree-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 26px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.dev-tree-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-subtle);
}

.dev-tree-item--active {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
  border-color: var(--color-accent-dim);
}

.dev-tree-item--active:hover {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
  border-color: var(--color-accent-dim);
}

.dev-tree-icon {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.dev-tree-empty {
  font-size: 11px;
  color: var(--color-text-tertiary);
  padding: 4px 8px;
  font-style: italic;
}
</style>
