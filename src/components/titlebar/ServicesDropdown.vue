<script setup lang="ts">
import { Check, Server } from 'lucide-vue-next'
import { computed, onUnmounted, ref } from 'vue'
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

// ── status logic ────────────────────────────────────────────────────────────
const activeMcpCount = computed(() => s.mcpServers.filter(srv => srv.enabled).length)
const activeSkillsCount = computed(() => s.availableSkills.filter(sk => sk.enabled).length)
const hasActive = computed(() => activeMcpCount.value > 0 || activeSkillsCount.value > 0)

// ── actions ──────────────────────────────────────────────────────────────────
function toggleMcp(id: string, currentlyEnabled: boolean) {
  s.updateMcpServer(id, { enabled: !currentlyEnabled })
}

function toggleSkill(id: string, currentlyEnabled: boolean) {
  s.setSkillEnabled(id, !currentlyEnabled)
}

// ── global close ─────────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closeDropdown()
}
window.addEventListener('keydown', onKeydown)
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="services-dropdown">
    <!-- Trigger -->
    <button
      class="trigger-btn"
      :class="{ 'trigger-btn--open': isOpen }"
      title="Services & Skills"
      @click.stop="toggleDropdown"
    >
      <div class="icon-wrap">
        <Server :size="15" :stroke-width="1.8" />
        <span v-if="hasActive" class="status-dot" />
      </div>
    </button>

    <!-- Dropdown -->
    <Transition name="picker">
      <div v-if="isOpen" class="picker-panel">
        <!-- Tabs -->
        <div class="picker-tabs">
          <button
            class="picker-tab"
            :class="{ 'picker-tab--active': activeTab === 'mcp' }"
            @click="activeTab = 'mcp'"
          >
            MCP Servers
            <span class="tab-badge">{{ s.mcpServers.length }}</span>
          </button>
          <button
            class="picker-tab"
            :class="{ 'picker-tab--active': activeTab === 'skills' }"
            @click="activeTab = 'skills'"
          >
            Skills
            <span class="tab-badge">{{ s.availableSkills.length }}</span>
          </button>
        </div>

        <div class="picker-content">
          <!-- MCP List -->
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

          <!-- Skills List -->
          <div v-if="activeTab === 'skills'" class="picker-list">
            <div v-if="s.availableSkills.length === 0" class="picker-empty">
              <p class="picker-empty-title">
                No skills found
              </p>
            </div>
            <template v-else>
              <!-- Built-in Skills -->
              <div v-if="s.availableSkills.some(sk => sk.source === 'builtin')" class="group-label">
                Built-in
              </div>
              <button
                v-for="skill in s.availableSkills.filter(sk => sk.source === 'builtin')"
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

              <!-- Project Skills -->
              <div v-if="s.availableSkills.some(sk => sk.source === 'project')" class="group-label project-group">
                Project Skills
              </div>
              <button
                v-for="skill in s.availableSkills.filter(sk => sk.source === 'project')"
                :key="skill.id"
                class="list-item"
                :class="{ 'list-item--enabled': skill.enabled }"
                @click="toggleSkill(skill.id, skill.enabled)"
              >
                <div class="item-left">
                  <span class="item-dot" :class="{ 'item-dot--active': skill.enabled }" />
                  <div class="item-stack">
                    <span class="item-name">{{ skill.title || skill.name }}</span>
                    <span v-if="skill.description" class="item-desc">{{ skill.description }}</span>
                  </div>
                </div>
                <Check v-if="skill.enabled" :size="14" class="item-check" />
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Backdrop -->
    <div v-if="isOpen" class="global-backdrop" @click="closeDropdown" />
  </div>
</template>

<style scoped>
.services-dropdown {
  position: relative;
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

/* ── Trigger ────────────────────────────────────────────────────────────────── */
.trigger-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.trigger-btn:hover,
.trigger-btn--open {
  background: var(--color-bg-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
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

/* ── Panel ──────────────────────────────────────────────────────────────────── */
.picker-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  transform-origin: top center;
  width: 300px;
  max-height: 280px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 24px 56px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
  will-change: transform, opacity;
}

/* ── Tabs ───────────────────────────────────────────────────────────────────── */
.picker-tabs {
  display: flex;
  padding: 8px 8px 0;
  gap: 4px;
  background: transparent;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.picker-tab {
  flex: 1;
  height: 30px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 150ms ease;
  padding-bottom: 2px; /* optical balance for the border */
}

.picker-tab:hover {
  color: var(--color-text-secondary);
}

.picker-tab--active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent);
}

.tab-badge {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.4;
  transition: all 150ms ease;
}

.picker-tab--active .tab-badge {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

/* ── Content ────────────────────────────────────────────────────────────────── */
.picker-content {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0 8px;
}

.picker-list {
  display: flex;
  flex-direction: column;
}

.group-label {
  display: block;
  padding: 12px 14px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.project-group {
  margin-top: 4px;
}

/* ── List Item ──────────────────────────────────────────────────────────────── */
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: auto;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition:
    background 100ms ease,
    border-color 100ms ease,
    color 100ms ease;
}

.list-item:hover {
  background: var(--color-bg-hover);
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

.item-stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-dim);
  flex-shrink: 0;
  transition: all 200ms ease;
}

.item-dot--active {
  background: var(--color-success-text);
  box-shadow: 0 0 6px var(--color-success-muted);
}

.item-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
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

/* ── Empty State ────────────────────────────────────────────────────────────── */
.picker-empty {
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
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
  line-height: 1.5;
}

/* ── Transitions & Backdrop ─────────────────────────────────────────────────── */
.picker-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-leave-active {
  transition:
    opacity 160ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 160ms cubic-bezier(0.7, 0, 0.84, 0);
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px) scale(0.96);
}

.picker-enter-to,
.picker-leave-from {
  transform: translateX(-50%) translateY(0) scale(1);
}

.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}
</style>
