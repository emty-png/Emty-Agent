<script setup lang="ts">
import { Check, Minus, RotateCcw, Shield, WandSparkles } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const chatStore = useChatStore()

const { agent, availableToolGroups } = storeToRefs(settingsStore)
const { sessionToolApprovals } = storeToRefs(chatStore)

type ToolGroup = typeof availableToolGroups.value[number]

const totalEnabledTools = computed(() =>
  availableToolGroups.value.reduce(
    (count, group) => count + group.tools.filter(tool => settingsStore.isToolEnabled(tool.id)).length,
    0,
  ),
)

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
      <div class="text-group">
        <h2 class="section-title">
          Agent
        </h2>
        <p class="section-subtitle">
          Control tool permissions and which tools the agent is allowed to know about.
        </p>
      </div>
      <span class="tools-badge" aria-label="Total enabled tools">
        {{ totalEnabledTools }} enabled
      </span>
    </header>

    <!-- Permissions Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Permissions
        </h3>
        <p class="settings-card-desc">
          Ask mode pauses execution until you approve or deny each tool call. Auto runs tools immediately.
        </p>
      </div>

      <div class="card-section">
        <div class="segmented-control" role="radiogroup" aria-label="Tool execution permission mode">
          <button
            class="mode-btn"
            type="button"
            role="radio"
            :aria-checked="agent.permissionMode === 'ask'"
            @click="agent.permissionMode = 'ask'"
          >
            <Shield :size="16" />
            <span>Ask Permission</span>
          </button>
          <button
            class="mode-btn"
            type="button"
            role="radio"
            :aria-checked="agent.permissionMode === 'auto'"
            @click="agent.permissionMode = 'auto'"
          >
            <WandSparkles :size="16" />
            <span>Auto</span>
          </button>
        </div>
      </div>

      <div class="card-section border-top row-between">
        <div class="text-group">
          <span class="label">Temporary session approvals</span>
          <span class="desc">
            {{ sessionToolApprovals.length }} tool{{ sessionToolApprovals.length === 1 ? '' : 's' }} currently allowed for this app session
          </span>
        </div>
        <button
          class="ghost-btn"
          type="button"
          :disabled="sessionToolApprovals.length === 0"
          @click="clearSessionApprovals"
        >
          <RotateCcw :size="14" />
          <span>Clear</span>
        </button>
      </div>
    </div>

    <!-- Tool Access Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Tool Access
        </h3>
        <p class="settings-card-desc">
          Disabled tools are removed from the tool list sent to the model, so they do not consume context.
        </p>
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
              <Check v-if="getGroupState(group) === 'on'" class="icon" :size="14" :stroke-width="3" />
              <Minus v-else-if="getGroupState(group) === 'mixed'" class="icon" :size="14" :stroke-width="3" />
            </span>

            <div class="text-group">
              <div class="group-title-row">
                <span class="label">{{ group.label }}</span>
                <span class="badge">
                  {{ group.tools.filter(tool => settingsStore.isToolEnabled(tool.id)).length }} / {{ group.tools.length }}
                </span>
              </div>
              <p class="desc">
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
                <Check v-if="settingsStore.isToolEnabled(tool.id)" class="icon" :size="12" :stroke-width="3" />
              </span>
              <span class="text-group">
                <span class="tool-name">{{ tool.label }}</span>
                <span class="desc">{{ tool.description }}</span>
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
  gap: 24px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.section-title {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  letter-spacing: -0.01em;
}

.section-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-tertiary, #6b7280);
}

.tools-badge {
  padding: 5px 12px;
  border-radius: 9999px;
  background: var(--color-bg-elevated, #f3f4f6);
  color: var(--color-text-secondary, #374151);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--color-border-subtle, rgba(0, 0, 0, 0.05));
}

/* =========================================
   Cards & Generic Structuring
========================================= */
.settings-card {
  background: var(--color-bg-surface, #ffffff);
  border: 1px solid var(--color-border-subtle, #e5e7eb);
  border-radius: 14px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.02),
    0 4px 12px rgba(0, 0, 0, 0.02);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.settings-card-header {
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border-subtle, #e5e7eb);
  background: var(--color-bg-surface, #ffffff);
}

.settings-card-title {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.settings-card-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-tertiary, #6b7280);
}

.card-section {
  padding: 20px 24px;
}

.border-top {
  border-top: 1px solid var(--color-border-subtle, #e5e7eb);
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

/* =========================================
   Text Utilities
========================================= */
.text-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-tertiary, #6b7280);
  margin: 0;
}

/* =========================================
   Segmented Control
========================================= */
.segmented-control {
  display: flex;
  background: var(--color-bg-elevated, #f3f4f6);
  padding: 4px;
  border-radius: 10px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-tertiary, #6b7280);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.mode-btn:hover:not([aria-checked='true']) {
  color: var(--color-text-secondary, #374151);
  background: rgba(255, 255, 255, 0.5);
}

.mode-btn[aria-checked='true'] {
  background: var(--color-accent-muted, #eff6ff);
  color: var(--color-accent-text, #1d4ed8);
  box-shadow:
    inset 0 0 0 1px var(--color-accent-dim, #bfdbfe),
    0 1px 2px rgba(0, 0, 0, 0.04);
  font-weight: 600;
}

.mode-btn:focus-visible {
  outline: 2px solid var(--color-accent-dim, #3b82f6);
  outline-offset: -2px;
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
  border-radius: 8px;
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

.ghost-btn:focus-visible {
  outline: 2px solid var(--color-accent-dim, #3b82f6);
  outline-offset: 2px;
}

/* =========================================
   Tool Groups & Checkboxes
========================================= */
.tool-group {
  border-top: 1px solid var(--color-border-subtle, #e5e7eb);
}

.tool-group:first-child {
  border-top: none;
}

.group-toggle-btn {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  width: 100%;
  padding: 18px 24px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s ease;
}

.group-toggle-btn:hover {
  background: var(--color-bg-hover, #f9fafb);
}

.group-toggle-btn:focus-visible {
  outline: none;
  background: var(--color-bg-hover, #f9fafb);
  box-shadow: inset 0 0 0 2px var(--color-accent-dim, #3b82f6);
}

.group-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary, #6b7280);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-bg-elevated, #f3f4f6);
}

/* Checkbox Indicator (The visual custom box) */
.checkbox-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--color-border-mid, #d1d5db);
  background: var(--color-bg-elevated, #f3f4f6);
  color: transparent;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 1px; /* Optical tweak to align with first text line */
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

/* Checkbox Icons Animations */
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
  padding: 0 16px 16px 50px;
  gap: 4px;
}

.tool-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
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
  background: var(--color-bg-hover, #f9fafb);
}

.tool-item:focus-visible {
  outline: none;
  opacity: 1;
  border-color: var(--color-accent-dim, #3b82f6);
  background: var(--color-bg-hover, #f9fafb);
}

.tool-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.tool-empty {
  padding: 0 24px 20px 56px;
  font-size: 13px;
  color: var(--color-text-tertiary, #6b7280);
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

  .card-section,
  .settings-card-header,
  .group-toggle-btn {
    padding: 16px;
  }

  .tool-list {
    padding: 0 12px 16px 42px;
  }

  .tool-empty {
    padding: 0 16px 16px 46px;
  }
}
</style>
