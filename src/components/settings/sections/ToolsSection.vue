<script setup lang="ts">
import { Check, Hammer, Minus, Palette } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()

const { availableToolGroups } = storeToRefs(settingsStore)

const toolView = ref<'build' | 'design'>('build')

const DESIGN_GROUP_IDS = new Set(['design-scaffold', 'design-files', 'design-build'])

const filteredToolGroups = computed(() => {
  if (toolView.value === 'design')
    return availableToolGroups.value.filter(g => DESIGN_GROUP_IDS.has(g.id))
  return availableToolGroups.value.filter(g => !DESIGN_GROUP_IDS.has(g.id))
})

type ToolGroup = typeof availableToolGroups.value[number]

type ToolMode = 'build' | 'design'

function getGroupState(group: ToolGroup): 'on' | 'off' | 'mixed' {
  const mode: ToolMode = toolView.value
  const enabledCount = group.tools.filter(tool => settingsStore.isToolEnabled(tool.id, mode)).length
  if (enabledCount === 0)
    return 'off'
  if (enabledCount === group.tools.length)
    return 'on'
  return 'mixed'
}

function toggleGroup(group: ToolGroup) {
  const isCurrentlyOn = getGroupState(group) === 'on'
  settingsStore.setToolsEnabled(
    group.tools.map(tool => tool.id),
    !isCurrentlyOn,
    toolView.value,
  )
}

function toggleTool(toolId: string) {
  settingsStore.setToolEnabled(toolId, !settingsStore.isToolEnabled(toolId, toolView.value), toolView.value)
}
</script>

<template>
  <section class="content-section">
    <header class="section-head">
      <h2 class="section-title">
        Tools
      </h2>
    </header>

    <!-- View tabs -->
    <div class="view-tabs">
      <button
        class="view-tab"
        :class="{ 'view-tab--active': toolView === 'build' }"
        @click="toolView = 'build'"
      >
        <Hammer :size="16" :stroke-width="1.8" />
        <span class="view-tab-title">Build</span>
      </button>
      <button
        class="view-tab"
        :class="{ 'view-tab--active': toolView === 'design' }"
        @click="toolView = 'design'"
      >
        <Palette :size="16" :stroke-width="1.8" />
        <span class="view-tab-title">Design</span>
      </button>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Tool Access
        </h3>
      </div>

      <div class="tool-groups">
        <div
          v-for="group in filteredToolGroups"
          :key="group.id"
          class="tool-group"
        >
          <button
            class="group-toggle-btn"
            type="button"
            role="checkbox"
            :aria-checked="getGroupState(group) === 'on' ? 'true' : getGroupState(group) === 'mixed' ? 'mixed' : 'false'"
            :aria-label="`Toggle all ${group.label} tools`"
            @click="toggleGroup(group)"
          >
            <span class="checkbox-indicator">
              <Check v-if="getGroupState(group) === 'on'" class="icon" :size="13" :stroke-width="3" />
              <Minus v-else-if="getGroupState(group) === 'mixed'" class="icon" :size="13" :stroke-width="3" />
            </span>

            <div class="settings-item-content">
              <div class="group-title-row">
                <span class="settings-item-label">{{ group.label }}</span>
                <span class="badge">
                  {{ group.tools.filter(tool => settingsStore.isToolEnabled(tool.id, toolView)).length }} / {{ group.tools.length }}
                </span>
              </div>
              <p class="settings-item-desc">
                {{ group.description }}
              </p>
            </div>
          </button>

          <div v-if="group.tools.length > 0" class="tool-list">
            <button
              v-for="tool in group.tools"
              :key="tool.id"
              class="tool-item"
              type="button"
              role="checkbox"
              :aria-checked="settingsStore.isToolEnabled(tool.id, toolView) ? 'true' : 'false'"
              @click="toggleTool(tool.id)"
            >
              <span class="checkbox-indicator checkbox-indicator--small">
                <Check v-if="settingsStore.isToolEnabled(tool.id, toolView)" class="icon" :size="11" :stroke-width="3" />
              </span>
              <span class="settings-item-content">
                <span class="tool-name">{{ tool.label }}</span>
                <span class="settings-item-desc">{{ tool.description }}</span>
              </span>
            </button>
          </div>

          <div v-else class="tool-empty">
            No tools discovered yet.
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* =========================================
   Layout & Typography
 ========================================= */
.content-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* =========================================
   View Tabs
 ========================================= */
.view-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.view-tab {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
}

.view-tab:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}

.view-tab--active {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.view-tab--active:hover {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.view-tab-title {
  font-size: 13px;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.section-title {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

/* =========================================
   Cards & Generic Structuring
 ========================================= */
.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.settings-card-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.settings-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
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
}

.settings-item-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

/* =========================================
   Tool Groups & Checkboxes
 ========================================= */
.tool-groups {
  display: flex;
  flex-direction: column;
}

.tool-group {
  border-bottom: 1px solid var(--color-border-subtle);
}

.tool-group:last-child {
  border-bottom: none;
}

.group-toggle-btn {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  width: 100%;
  padding: 14px 20px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;
}

.group-toggle-btn:hover {
  background: var(--color-state-hover);
}

.group-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  padding: 2px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
}

.checkbox-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
  color: transparent;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 1px;
}

button[aria-checked='true'] .checkbox-indicator,
button[aria-checked='mixed'] .checkbox-indicator {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.checkbox-indicator--small {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
}

.checkbox-indicator .icon {
  opacity: 0;
  transform: scale(0.5);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

button[aria-checked='true'] .checkbox-indicator .icon,
button[aria-checked='mixed'] .checkbox-indicator .icon {
  opacity: 1;
  transform: scale(1);
}

/* =========================================
   Tool Listing Nodes
 ========================================= */
.tool-list {
  display: flex;
  flex-direction: column;
  padding: 4px 16px 12px 46px;
  gap: 4px;
}

.tool-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-item[aria-checked='false'] {
  opacity: 0.65;
}

.tool-item:hover {
  opacity: 1;
  background: var(--color-state-hover);
}

.tool-item:focus-visible {
  outline: none;
  opacity: 1;
  border-color: var(--color-accent-dim);
  background: var(--color-state-hover);
}

.tool-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.tool-empty {
  padding: 0 20px 14px 50px;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

/* =========================================
   Responsive Polishing
 ========================================= */
@media (max-width: 640px) {
  .section-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .settings-card-header,
  .group-toggle-btn {
    padding: 12px 16px;
  }

  .tool-list {
    padding: 4px 12px 12px 40px;
  }

  .tool-empty {
    padding: 0 16px 12px 42px;
  }
}
</style>
