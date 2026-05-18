<script setup lang="ts">
import { Check, Minus, RotateCcw, Shield, WandSparkles } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const chatStore = useChatStore()

const { agent, availableToolGroups } = storeToRefs(settingsStore)
const { sessionToolApprovals } = storeToRefs(chatStore)

type ToolGroup = typeof availableToolGroups.value[number]

function getGroupState(group: ToolGroup): 'on' | 'off' | 'mixed' {
  const enabledCount = group.tools.filter(tool => settingsStore.isToolEnabled(tool.id)).length
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
  )
}

function toggleTool(toolId: string) {
  settingsStore.setToolEnabled(toolId, !settingsStore.isToolEnabled(toolId))
}

function clearSessionApprovals() {
  chatStore.clearSessionToolApprovals()
}
</script>

<template>
  <section class="content-section">
    <!-- Header -->
    <header class="section-head">
      <h2 class="section-title">
        Agent
      </h2>
    </header>

    <!-- Permissions Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Permissions
        </h3>
      </div>

      <div class="settings-list">
        <!-- Permission Mode -->
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Permission Mode</span>
            <span class="settings-item-desc">Ask mode pauses execution for approvals. Auto runs tools immediately.</span>
          </div>
          <div class="segmented-control" role="radiogroup" aria-label="Tool execution permission mode">
            <button
              class="mode-btn"
              type="button"
              role="radio"
              :aria-checked="agent.permissionMode === 'ask'"
              @click="agent.permissionMode = 'ask'"
            >
              <Shield :size="15" />
              <span>Ask Permission</span>
            </button>
            <button
              class="mode-btn"
              type="button"
              role="radio"
              :aria-checked="agent.permissionMode === 'auto'"
              @click="agent.permissionMode = 'auto'"
            >
              <WandSparkles :size="15" />
              <span>Auto</span>
            </button>
          </div>
        </div>

        <!-- Temporary approvals -->
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Temporary session approvals</span>
            <span class="settings-item-desc">
              {{ sessionToolApprovals.length }} tool{{ sessionToolApprovals.length === 1 ? '' : 's' }} currently allowed for this app session
            </span>
          </div>
          <button
            class="ghost-btn"
            type="button"
            :disabled="sessionToolApprovals.length === 0"
            @click="clearSessionApprovals"
          >
            <RotateCcw :size="13" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Tool Access Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Tool Access
        </h3>
      </div>

      <div class="tool-groups">
        <div
          v-for="group in availableToolGroups"
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
                  {{ group.tools.filter(tool => settingsStore.isToolEnabled(tool.id)).length }} / {{ group.tools.length }}
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
              :aria-checked="settingsStore.isToolEnabled(tool.id) ? 'true' : 'false'"
              @click="toggleTool(tool.id)"
            >
              <span class="checkbox-indicator checkbox-indicator--small">
                <Check v-if="settingsStore.isToolEnabled(tool.id)" class="icon" :size="11" :stroke-width="3" />
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
  gap: 16px;
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

.section-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.tools-badge {
  padding: 5px 12px;
  border-radius: 9999px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--color-border-subtle);
}

/* =========================================
   Cards & Generic Structuring
 ========================================= */
.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
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
}

.settings-item:last-child {
  border-bottom: none;
}

.settings-item--field {
  cursor: default;
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
   Segmented Control
 ========================================= */
.segmented-control {
  display: flex;
  background: var(--color-bg-elevated, #f3f4f6);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--color-border-mid, #d1d5db);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  padding-inline: 16px;
  white-space: nowrap;
}

/* Specific styling for Ask Permission button */
.mode-btn:first-child {
  color: var(--color-text-secondary);
}

.mode-btn:first-child[aria-checked='true'] {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

/* Specific styling for Auto button */
.mode-btn:last-child {
  color: var(--color-accent, #10b981);
}

.mode-btn:last-child[aria-checked='true'] {
  background: var(--color-accent, #10b981);
  color: var(--color-bg-surface, #ffffff);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

/* =========================================
   Ghost Action Button
 ========================================= */
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid, #d1d5db);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary, #374151);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.ghost-btn:hover:not(:disabled) {
  background: var(--color-bg-hover, #f9fafb);
  color: var(--color-text-primary, #111827);
  border-color: var(--color-text-tertiary, #6b7280);
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
  background: var(--color-bg-hover);
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
  border-radius: 999px;
  background: var(--color-bg-elevated);
}

/* Checkbox Indicator (The visual custom box) */
.checkbox-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
  color: transparent;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 1px;
}

button[aria-checked='true'] .checkbox-indicator,
button[aria-checked='mixed'] .checkbox-indicator {
  background: var(--color-accent-muted, #eff6ff);
  border-color: var(--color-accent-dim, #bfdbfe);
  color: var(--color-accent-text, #1d4ed8);
}

.checkbox-indicator--small {
  width: 16px;
  height: 16px;
  border-radius: 4px;
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
  border-radius: 6px;
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
  background: var(--color-bg-hover);
}

.tool-item:focus-visible {
  outline: none;
  opacity: 1;
  border-color: var(--color-accent-dim);
  background: var(--color-bg-hover);
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

  .settings-item,
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
