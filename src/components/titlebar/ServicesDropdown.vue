<script setup lang="ts">
import { Check, Server } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const s = useSettingsStore()

const isOpen = ref(false)
const activeTab = ref<'mcp' | 'skills'>('mcp')

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

const activeMcpCount = computed(() => s.mcpServers.filter(server => server.enabled).length)
const activeSkillsCount = computed(() => s.availableSkills.filter(skill => skill.enabled).length)
const hasActive = computed(() =>
  activeMcpCount.value > 0 || activeSkillsCount.value > 0,
)

function toggleMcp(id: string, currentlyEnabled: boolean) {
  s.updateMcpServer(id, { enabled: !currentlyEnabled })
}

function toggleSkill(id: string, currentlyEnabled: boolean) {
  s.setSkillEnabled(id, !currentlyEnabled)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeDropdown()
}

window.addEventListener('keydown', onKeydown)
</script>

<template>
  <div class="services-dropdown">
    <button
      class="trigger-btn"
      :class="{ 'trigger-btn--open': isOpen }"
      title="Services and Skills"
      @click.stop="toggleDropdown"
    >
      <div class="icon-wrap">
        <Server :size="15" :stroke-width="1.8" />
        <span v-if="hasActive" class="status-dot" />
      </div>
    </button>

    <Transition name="picker">
      <div v-if="isOpen" class="picker-panel">
        <div class="picker-tabs">
          <button
            class="picker-tab"
            :class="{ 'picker-tab--active': activeTab === 'mcp' }"
            @click="activeTab = 'mcp'"
          >
            MCP Servers
          </button>
          <button
            class="picker-tab"
            :class="{ 'picker-tab--active': activeTab === 'skills' }"
            @click="activeTab = 'skills'"
          >
            Skills
          </button>
        </div>

        <div class="picker-content">
          <div v-if="activeTab === 'mcp'" class="picker-list">
            <div v-if="s.mcpServers.length === 0" class="picker-empty">
              <p class="picker-empty-title">
                No MCP servers
              </p>
              <p class="picker-empty-hint">
                Configure them in Settings.
              </p>
            </div>
            <button
              v-for="server in s.mcpServers"
              :key="server.id"
              class="list-item"
              :class="{ 'list-item--enabled': server.enabled }"
              @click="toggleMcp(server.id, server.enabled)"
            >
              <div class="item-left">
                <span
                  class="item-dot"
                  :class="{ 'item-dot--active': server.enabled && server.status === 'ok' }"
                />
                <span class="item-name">{{ server.name }}</span>
                <span v-if="server.statusMessage && server.enabled" class="item-meta">
                  {{ server.toolCount }} tools
                </span>
              </div>
              <Check v-if="server.enabled" :size="14" class="item-check" />
            </button>
          </div>

          <div v-if="activeTab === 'skills'" class="picker-list">
            <div v-if="s.availableSkills.length === 0" class="picker-empty">
              <p class="picker-empty-title">
                No skills found
              </p>
            </div>
            <template v-else>
              <div v-if="s.availableSkills.some(skill => skill.source === 'builtin')" class="group-label">
                Built-in
              </div>
              <button
                v-for="skill in s.availableSkills.filter(skill => skill.source === 'builtin')"
                :key="skill.id"
                class="list-item"
                :class="{ 'list-item--enabled': skill.enabled }"
                @click="toggleSkill(skill.id, skill.enabled)"
              >
                <div class="item-left">
                  <span class="item-dot" :class="{ 'item-dot--active': skill.enabled }" />
                  <span class="item-name">{{ skill.title || skill.name }}</span>
                </div>
                <Check v-if="skill.enabled" :size="14" class="item-check" />
              </button>

              <div v-if="s.availableSkills.some(skill => skill.source === 'global')" class="group-label project-group">
                Global Skills
              </div>
              <button
                v-for="skill in s.availableSkills.filter(skill => skill.source === 'global')"
                :key="skill.id"
                class="list-item"
                :class="{ 'list-item--enabled': skill.enabled }"
                @click="toggleSkill(skill.id, skill.enabled)"
              >
                <div class="item-left">
                  <span class="item-dot" :class="{ 'item-dot--active': skill.enabled }" />
                  <span class="item-name">{{ skill.title || skill.name }}</span>
                </div>
                <Check v-if="skill.enabled" :size="14" class="item-check" />
              </button>

              <div v-if="s.availableSkills.some(skill => skill.source === 'project')" class="group-label project-group">
                Project Skills
              </div>
              <button
                v-for="skill in s.availableSkills.filter(skill => skill.source === 'project')"
                :key="skill.id"
                class="list-item"
                :class="{ 'list-item--enabled': skill.enabled }"
                @click="toggleSkill(skill.id, skill.enabled)"
              >
                <div class="item-left">
                  <span class="item-dot" :class="{ 'item-dot--active': skill.enabled }" />
                  <span class="item-name">{{ skill.title || skill.name }}</span>
                </div>
                <Check v-if="skill.enabled" :size="14" class="item-check" />
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="isOpen" class="global-backdrop" @click="closeDropdown" />
  </div>
</template>

<style scoped>
/*
  Design system (matches component library + ModelPicker):
  ─────────────────────────────────────────────────────────────
  Border radius  → xs=3  sm=4  md=6  lg=8  xl=12  pill=9999
  Ease out expo  → cubic-bezier(0.16, 1, 0.3, 1)    snappy open
  Ease in expo   → cubic-bezier(0.7,  0, 0.84, 0)   fast close
  Ease smooth    → cubic-bezier(0.4,  0, 0.2,  1)   state change
  Ease spring    → cubic-bezier(0.34, 1.56, 0.64, 1) pop/bounce

  Durations → instant 80ms  micro 100ms  fast 150ms  normal 220ms
*/

/* ── Wrapper ──────────────────────────────────────────────────────────────── */
.services-dropdown {
  position: relative;
  display: flex;
  align-items: stretch;
  height: 100%;
  -webkit-app-region: no-drag;
}

/* ── Trigger button ───────────────────────────────────────────────────────── */
.trigger-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms cubic-bezier(0.4, 0, 0.2, 1);
}

.trigger-btn:hover,
.trigger-btn--open {
  background: var(--color-accent-muted);
  border-color: transparent;
  color: var(--color-accent-text);
}

.trigger-btn:active {
  background: var(--color-bg-elevated);
}

.icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.status-dot {
  position: absolute;
  top: -3px;
  right: -4px;
  width: 6px;
  height: 6px;
  background: var(--color-success-text);
  border: 1px solid var(--color-bg-surface);
  border-radius: 50%;
  box-shadow: 0 0 4px var(--color-success-muted);
}

/* ── Dropdown shell ───────────────────────────────────────────────────────── */
.picker-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(calc(-50% - 20px));
  transform-origin: top center;
  width: 350px;
  height: 200px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
  will-change: transform, opacity;
}

/* ── Tabs ─────────────────────────────────────────────────────────────────── */
.picker-tabs {
  position: relative;
  display: flex;
  padding: 8px 12px 0;
  gap: 16px;
  background: transparent;
  box-shadow: inset 0 -1px 0 var(--color-border-mid);
  flex-shrink: 0;
}

.picker-tab {
  position: relative;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0 2px 2px;
}

.picker-tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--color-text-primary);
  border-radius: 2px 2px 0 0;
  opacity: 0;
  transform: translateY(2px);
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-tab:hover {
  color: var(--color-text-primary);
}

.picker-tab--active {
  color: var(--color-text-primary);
  font-weight: 600;
}

.picker-tab--active::after {
  opacity: 1;
  transform: translateY(0);
}

.tab-badge {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
  padding: 1.5px 7px;
  border-radius: var(--radius-md);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.picker-tab--active .tab-badge {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

/* ── Content & scrollable list ────────────────────────────────────────────── */
.picker-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 0 8px;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.picker-content::-webkit-scrollbar {
  width: 4px;
}
.picker-content::-webkit-scrollbar-track {
  background: transparent;
}
.picker-content::-webkit-scrollbar-thumb {
  background: var(--color-border-bright);
  border-radius: var(--radius-md);
}

.picker-list {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.group-label {
  display: block;
  padding: 10px 16px 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  user-select: none;
}

.project-group {
  margin-top: 4px;
}

/* ── List item ────────────────────────────────────────────────────────────── */
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 12px);
  margin: 1px 6px;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.list-item:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

.list-item--enabled {
  color: var(--color-text-primary);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-dim);
  flex-shrink: 0;
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.item-dot--active {
  background: var(--color-success-text);
  box-shadow: 0 0 6px var(--color-success-muted);
}

.item-name {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  font-size: 10px;
  color: var(--color-text-tertiary);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

.item-check {
  color: var(--color-accent-text);
  flex-shrink: 0;
}

/* ── Empty states ─────────────────────────────────────────────────────────── */
.picker-empty {
  margin: auto;
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.picker-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.picker-empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

/* ── Backdrop ─────────────────────────────────────────────────────────────── */
.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

/* ── Transition ───────────────────────────────────────────────────────────── */
/*
  Opens from TOP (picker appears below the trigger).
  Enter: 150ms ease-out-expo (snappy)
  Leave: 100ms ease-in-expo  (fast, non-intrusive)
*/
.picker-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 100ms cubic-bezier(0.7, 0, 0.84, 0);
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateX(calc(-50% - 20px)) translateY(-8px) scale(0.96);
}

.picker-enter-to,
.picker-leave-from {
  transform: translateX(calc(-50% - 20px)) translateY(0) scale(1);
}
</style>
