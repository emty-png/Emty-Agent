<script setup lang="ts">
import { Check, ChevronDown, GitBranch, Hand, HandFist, Layers, Minus, RotateCcw, ShieldCheck, Users, UserX } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const chatStore = useChatStore()

const { agent, availableToolGroups, contextCaching, autoContext, memory } = storeToRefs(settingsStore)
const { sessionToolApprovals } = storeToRefs(chatStore)

type ToolGroup = typeof availableToolGroups.value[number]
type PermissionMode = 'ask' | 'auto' | 'yolo'

const permOptions = [
  { mode: 'ask' as const, label: 'Ask Permission', icon: Hand },
  { mode: 'auto' as const, label: 'Auto', icon: ShieldCheck },
  { mode: 'yolo' as const, label: 'Yolo', icon: HandFist },
]

const subagentOptions = [
  { value: 'worktree' as const, label: 'Worktree', icon: GitBranch },
  { value: 'inherit' as const, label: 'Inherit', icon: Layers },
]

const gitCoAuthorOptions = [
  { value: true, label: 'On', icon: Users },
  { value: false, label: 'Off', icon: UserX },
]

const permOpen = ref(false)
const subagentOpen = ref(false)
const gitOpen = ref(false)

function closeAllPops() {
  permOpen.value = false
  subagentOpen.value = false
  gitOpen.value = false
}

function currentPermOption() {
  return permOptions.find(o => o.mode === agent.value.permissionMode) ?? permOptions[0]!
}

function currentSubagentOption() {
  return subagentOptions.find(o => o.value === agent.value.subagents.isolation) ?? subagentOptions[0]!
}

function currentGitOption() {
  return gitCoAuthorOptions.find(o => o.value === agent.value.gitCoAuthor) ?? gitCoAuthorOptions[0]!
}

function togglePerm() {
  const next = !permOpen.value
  closeAllPops()
  permOpen.value = next
}

function toggleSubagent() {
  const next = !subagentOpen.value
  closeAllPops()
  subagentOpen.value = next
}

function toggleGit() {
  const next = !gitOpen.value
  closeAllPops()
  gitOpen.value = next
}

function selectPermMode(mode: PermissionMode) {
  agent.value.permissionMode = mode
  permOpen.value = false
}

function selectSubagentIsolation(value: 'worktree' | 'inherit') {
  agent.value.subagents.isolation = value
  subagentOpen.value = false
}

function selectGitCoAuthor(value: boolean) {
  agent.value.gitCoAuthor = value
  gitOpen.value = false
}

function onPermKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closeAllPops()
}

onMounted(() => window.addEventListener('keydown', onPermKeydown))
onUnmounted(() => window.removeEventListener('keydown', onPermKeydown))

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

    <!-- Core Settings Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Core Settings
        </h3>
      </div>
      <div class="settings-list">
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Auto project context</span>
            <span class="settings-item-desc">Load AGENTS.md and DESIGN.md from project root automatically</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': autoContext.enabled }"
            type="button"
            :aria-pressed="autoContext.enabled"
            @click="autoContext.enabled = !autoContext.enabled"
          ><span class="model-toggle-thumb" /></button>
        </label>
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Context caching</span>
            <span class="settings-item-desc">Cache reusable prompt segments to reduce latency and cost</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': contextCaching.enabled }"
            type="button"
            :aria-pressed="contextCaching.enabled"
            @click="contextCaching.enabled = !contextCaching.enabled"
          ><span class="model-toggle-thumb" /></button>
        </label>
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Agent memory</span>
            <span class="settings-item-desc">Reuse global preferences and project history across future chats</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': memory.enabled }"
            type="button"
            :aria-pressed="memory.enabled"
            @click="memory.enabled = !memory.enabled"
          ><span class="model-toggle-thumb" /></button>
        </label>
      </div>
    </div>

    <!-- Cache Settings Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Cache Configuration
        </h3>
      </div>
      <div class="settings-list">
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Anthropic cache TTL</span>
            <span class="settings-item-desc">How long Claude prompt cache breakpoints are retained</span>
          </div>
          <select v-model="contextCaching.anthropicTtl" class="settings-select">
            <option value="5m">
              5 minutes
            </option>
            <option value="1h">
              1 hour
            </option>
          </select>
        </div>
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">OpenAI cache retention</span>
            <span class="settings-item-desc">Extended 24h only applies to models that support it</span>
          </div>
          <select v-model="contextCaching.openaiPromptCacheRetention" class="settings-select">
            <option value="in_memory">
              In-memory
            </option>
            <option value="24h">
              Extended 24h
            </option>
          </select>
        </div>
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Gemini cached content</span>
            <span class="settings-item-desc">Paste an existing cached-content name to reuse it on requests</span>
          </div>
          <input
            v-model="contextCaching.googleCachedContent"
            type="text"
            class="settings-input"
            placeholder="cachedContents/"
            autocomplete="off"
            spellcheck="false"
          >
        </div>
      </div>
    </div>

    <!-- Permissions Card -->
    <div class="settings-card settings-card--pop">
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
            <span class="settings-item-desc">Ask prompts for every tool call. Auto lets the AI review and approve safe actions. Yolo allows everything.</span>
          </div>
          <div class="perm-picker">
            <button
              class="perm-trigger"
              :class="`perm-trigger--${agent.permissionMode}`"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="permOpen"
              @click="togglePerm"
            >
              <component :is="currentPermOption().icon" :size="14" :stroke-width="2" />
              <span class="perm-trigger-label">{{ currentPermOption().label }}</span>
              <ChevronDown
                :size="14"
                :stroke-width="2.5"
                class="perm-chevron"
                :class="{ 'perm-chevron--open': permOpen }"
              />
            </button>

            <div class="perm-anchor">
              <Transition name="perm">
                <div v-if="permOpen" class="perm-menu" role="menu">
                  <button
                    v-for="opt in permOptions"
                    :key="opt.mode"
                    class="perm-option"
                    :class="{
                      'perm-option--active': agent.permissionMode === opt.mode,
                      'perm-option--yolo': opt.mode === 'yolo',
                    }"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="agent.permissionMode === opt.mode"
                    @click="selectPermMode(opt.mode)"
                  >
                    <component :is="opt.icon" :size="13" :stroke-width="2" />
                    <span>{{ opt.label }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <div v-if="permOpen" class="perm-backdrop" @click="permOpen = false" />
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
    <div class="settings-card settings-card--pop">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Sub-Agents
        </h3>
      </div>

      <div class="settings-list">
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Workspace isolation</span>
            <span class="settings-item-desc">Worktree mode gives debugger and general sub-agents their own git workspace when possible.</span>
          </div>
          <div class="perm-picker">
            <button
              class="perm-trigger"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="subagentOpen"
              @click="toggleSubagent"
            >
              <component :is="currentSubagentOption().icon" :size="14" :stroke-width="2" />
              <span class="perm-trigger-label">{{ currentSubagentOption().label }}</span>
              <ChevronDown
                :size="14"
                :stroke-width="2.5"
                class="perm-chevron"
                :class="{ 'perm-chevron--open': subagentOpen }"
              />
            </button>

            <div class="perm-anchor">
              <Transition name="perm">
                <div v-if="subagentOpen" class="perm-menu" role="menu">
                  <button
                    v-for="opt in subagentOptions"
                    :key="opt.value"
                    class="perm-option"
                    :class="{ 'perm-option--active': agent.subagents.isolation === opt.value }"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="agent.subagents.isolation === opt.value"
                    @click="selectSubagentIsolation(opt.value)"
                  >
                    <component :is="opt.icon" :size="13" :stroke-width="2" />
                    <span>{{ opt.label }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <div v-if="subagentOpen" class="perm-backdrop" @click="subagentOpen = false" />
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card settings-card--pop">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Git Co-Authoring
        </h3>
      </div>

      <div class="settings-list">
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Attribution</span>
            <span class="settings-item-desc">Adds a Co-authored-by trailer to commits made by the agent, so contributions appear on GitHub.</span>
          </div>
          <div class="perm-picker">
            <button
              class="perm-trigger"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="gitOpen"
              @click="toggleGit"
            >
              <component :is="currentGitOption().icon" :size="14" :stroke-width="2" />
              <span class="perm-trigger-label">{{ currentGitOption().label }}</span>
              <ChevronDown
                :size="14"
                :stroke-width="2.5"
                class="perm-chevron"
                :class="{ 'perm-chevron--open': gitOpen }"
              />
            </button>

            <div class="perm-anchor">
              <Transition name="perm">
                <div v-if="gitOpen" class="perm-menu" role="menu">
                  <button
                    v-for="opt in gitCoAuthorOptions"
                    :key="String(opt.value)"
                    class="perm-option"
                    :class="{ 'perm-option--active': agent.gitCoAuthor === opt.value }"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="agent.gitCoAuthor === opt.value"
                    @click="selectGitCoAuthor(opt.value)"
                  >
                    <component :is="opt.icon" :size="13" :stroke-width="2" />
                    <span>{{ opt.label }}</span>
                  </button>
                </div>
              </Transition>
            </div>

            <div v-if="gitOpen" class="perm-backdrop" @click="gitOpen = false" />
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Session Compaction
        </h3>
      </div>

      <div class="settings-list">
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Auto compact</span>
            <span class="settings-item-desc">Summarize older turns automatically when prompt usage crosses the configured threshold.</span>
          </div>
          <label class="checkbox-row">
            <input v-model="agent.sessionCompaction.auto" type="checkbox" class="native-checkbox">
          </label>
        </div>

        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Auto compact threshold</span>
            <span class="settings-item-desc">Recommended range is 80-85% so compaction happens before the context window hard-fails.</span>
          </div>
          <div class="range-field">
            <input
              v-model.number="agent.sessionCompaction.thresholdPercent"
              type="range"
              min="80"
              max="85"
              step="1"
              class="range-input"
            >
            <span class="range-value">{{ agent.sessionCompaction.thresholdPercent }}%</span>
          </div>
        </div>

        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Manual compact button</span>
            <span class="settings-item-desc">Show the compact button inside the prompt estimator popover.</span>
          </div>
          <label class="checkbox-row">
            <input v-model="agent.sessionCompaction.showManualButton" type="checkbox" class="native-checkbox">
          </label>
        </div>
      </div>
    </div>

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
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.settings-card--pop {
  overflow: visible;
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
  background: var(--color-bg-elevated);
  padding: 3px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-bg-base) 4%, transparent);
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
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
  background: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
  color: var(--color-text-primary);
  font-weight: 600;
  box-shadow: var(--color-shadow-sm);
}

/* Specific styling for Auto button */
.mode-btn:last-child {
  color: var(--color-accent);
}

.mode-btn:last-child[aria-checked='true'] {
  background: var(--color-accent);
  color: var(--color-bg-surface);
  font-weight: 600;
  box-shadow: var(--color-shadow-sm);
}

/* =========================================
   Permission Mode Picker (Popup)
 ========================================= */
.perm-picker {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.perm-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px 0 12px;
  min-width: 160px;
  justify-content: space-between;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    color 130ms ease;
}

.perm-trigger:hover {
  border-color: var(--color-text-tertiary);
}

.perm-trigger-label {
  flex: 1;
  text-align: left;
}

.perm-trigger--auto {
  color: var(--color-accent);
}

.perm-trigger--yolo {
  color: var(--color-warning-text);
}

.perm-chevron {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.perm-chevron--open {
  transform: rotate(180deg);
}

.perm-anchor {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
}

.perm-menu {
  width: 180px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 3%, transparent),
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 12px 28px rgba(0, 0, 0, 0.35);
}

.perm-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background 100ms ease,
    border-color 100ms ease,
    color 100ms ease;
}

.perm-option:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

.perm-option--active {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.perm-option--active.perm-option--yolo {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  border-color: var(--color-danger);
}

.perm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

.perm-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom;
}

.perm-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s cubic-bezier(0.7, 0, 0.84, 0);
  transform-origin: bottom;
}

.perm-enter-from,
.perm-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
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
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.ghost-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.native-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--color-accent);
}

.checkbox-pill {
  min-width: 58px;
  text-align: center;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border-mid);
}

.range-field {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
}

.range-input {
  width: 140px;
  accent-color: var(--color-accent);
}

.range-value {
  min-width: 40px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
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

/* Checkbox Indicator (The visual custom box) */
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

/* =========================================
   Settings Inputs
 ========================================= */
.settings-select {
  height: 32px;
  padding-inline: 12px 8px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  transition: border-color 130ms ease;
  flex-shrink: 0;
  min-width: 140px;
}

.settings-select:focus {
  border-color: var(--color-accent-dim);
}

.settings-input {
  height: 32px;
  padding-inline: 12px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 130ms ease;
  flex-shrink: 0;
  width: 180px;
}

.settings-input::placeholder {
  color: var(--color-text-dim);
}

.settings-input:focus {
  border-color: var(--color-accent-dim);
}

/* =========================================
   Toggle Switch
 ========================================= */
.model-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 34px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-mid);
  background: var(--color-toggle-track-off);
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
  flex-shrink: 0;
}

.model-toggle--on {
  background: var(--color-toggle-track-on);
  border-color: var(--color-accent);
}

.model-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-toggle-thumb-off);
  transition:
    transform 140ms cubic-bezier(0.4, 0, 0.2, 1),
    background 140ms ease;
}

.model-toggle--on .model-toggle-thumb {
  transform: translateX(14px);
  background: var(--color-text-primary);
}
</style>
