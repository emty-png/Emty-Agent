<script setup lang="ts">
import type { ToolCatalogGroup } from '@/utils/tools/catalog'
import {
  Bot,
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  Layout,
  LayoutList,
  Monitor,
  Palette,
  SlidersHorizontal,
  X,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { SYSTEM_PROMPTS } from '@/utils/tools/promptDescriptions'
import { DEFAULT_TOOL_DESCRIPTIONS } from '@/utils/tools/toolDescriptions'

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

const emit = defineEmits<{ close: []; selectTool: [tool: ToolInfo]; selectPrompt: [prompt: PromptInfo] }>()

const settingsStore = useSettingsStore()
const { availableToolGroups } = storeToRefs(settingsStore)

type Section = 'subagent' | 'task' | 'fs' | 'browser' | 'web' | 'shell' | 'design' | 'others' | 'prompts'
const activeSection = ref<Section>('subagent')

const NAV: { id: Section; label: string; icon: typeof Bot }[] = [
  { id: 'subagent', label: 'SubAgent', icon: Bot },
  { id: 'task', label: 'Task', icon: LayoutList },
  { id: 'fs', label: 'Fs', icon: FolderOpen },
  { id: 'browser', label: 'Browser', icon: Monitor },
  { id: 'web', label: 'Web', icon: Globe },
  { id: 'shell', label: 'Shell', icon: Layout },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'others', label: 'Others', icon: SlidersHorizontal },
  { id: 'prompts', label: 'System prompt', icon: FileText },
]

const SUBAGENT_TOOL_IDS = new Set(['ask_questions', 'spawn_subagent', 'plan', 'sleep'])
const TASK_TOOL_IDS = new Set(['create_task', 'update_task', 'list_tasks', 'get_task'])
const FS_GROUP_IDS = new Set(['filesystem'])
const BROWSER_GROUP_IDS = new Set(['browser'])
const WEB_GROUP_IDS = new Set(['web'])
const SHELL_GROUP_IDS = new Set(['shell'])
const DESIGN_GROUP_IDS = new Set(['design-scaffold', 'design-files', 'design-build'])
const SUBAGENT_PROMPT_IDS = new Set(['subagent-explorer', 'subagent-researcher', 'subagent-debugger', 'subagent-general'])

const subagentPrompts = computed(() =>
  SYSTEM_PROMPTS.filter(p => SUBAGENT_PROMPT_IDS.has(p.id)),
)

const activeGroups = computed<ToolCatalogGroup[]>(() => {
  const groups = availableToolGroups.value
  switch (activeSection.value) {
    case 'subagent':
      return groups
        .filter(g => g.id === 'agent')
        .map(g => ({
          ...g,
          tools: g.tools.filter(t => SUBAGENT_TOOL_IDS.has(t.id)),
        }))
        .filter(g => g.tools.length > 0)
    case 'task':
      return groups
        .filter(g => g.id === 'agent')
        .map(g => ({
          ...g,
          label: 'Task',
          tools: g.tools.filter(t => TASK_TOOL_IDS.has(t.id)),
        }))
        .filter(g => g.tools.length > 0)
    case 'fs':
      return groups.filter(g => FS_GROUP_IDS.has(g.id))
    case 'browser':
      return groups.filter(g => BROWSER_GROUP_IDS.has(g.id))
    case 'web':
      return groups.filter(g => WEB_GROUP_IDS.has(g.id))
    case 'shell':
      return groups.filter(g => SHELL_GROUP_IDS.has(g.id))
    case 'design':
      return groups.filter(g => DESIGN_GROUP_IDS.has(g.id))
    case 'others':
      return groups.filter(
        g =>
          !FS_GROUP_IDS.has(g.id)
          && !BROWSER_GROUP_IDS.has(g.id)
          && !WEB_GROUP_IDS.has(g.id)
          && !SHELL_GROUP_IDS.has(g.id)
          && !DESIGN_GROUP_IDS.has(g.id)
          && g.id !== 'agent',
      )
    default:
      return []
  }
})

const promptGroups = computed(() => {
  const groups: { name: string; description: string; prompts: typeof SYSTEM_PROMPTS }[] = []
  const groupMap = new Map<string, typeof SYSTEM_PROMPTS>()
  for (const prompt of SYSTEM_PROMPTS) {
    if (SUBAGENT_PROMPT_IDS.has(prompt.id))
      continue
    const groupName = prompt.group || 'System Prompts'
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, [])
    }
    groupMap.get(groupName)!.push(prompt)
  }
  const descriptions: Record<string, string> = {
    'Agent Modes': 'Base system prompts used by the primary agent across different modes.',
    System: 'System-level prompts for session context compaction and memory management.',
  }
  for (const [name, prompts] of groupMap.entries()) {
    groups.push({
      name,
      description: descriptions[name] || 'Custom system prompts',
      prompts,
    })
  }
  return groups
})

function hasToolOverride(toolId: string): boolean {
  if (settingsStore.toolDescriptionOverrides[toolId])
    return true
  const defaultDesc = DEFAULT_TOOL_DESCRIPTIONS[toolId as keyof typeof DEFAULT_TOOL_DESCRIPTIONS]
  return defaultDesc === undefined && toolId in settingsStore.toolDescriptionOverrides
}

function hasPromptOverride(promptId: string): boolean {
  return `prompt-${promptId}` in settingsStore.promptOverrides
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="dev-popup-backdrop" data-overlay @click.self="emit('close')" @keydown="onKeydown">
      <div class="dev-popup-modal" role="dialog" aria-modal="true" aria-label="Developer Tools">
        <div class="modal-header">
          <span class="modal-title">Developer Tools</span>
          <button class="modal-close" aria-label="Close" @click="emit('close')">
            <X :size="14" :stroke-width="2" />
          </button>
        </div>

        <div class="modal-body">
          <nav class="dev-nav">
            <button
              v-for="item in NAV"
              :key="item.id"
              class="nav-item"
              :class="{ 'nav-item--active': activeSection === item.id }"
              @click="activeSection = item.id"
            >
              <component :is="item.icon" :size="14" :stroke-width="1.8" class="nav-icon" />
              <span>{{ item.label }}</span>
              <ChevronRight
                :size="12"
                :stroke-width="2"
                class="nav-arrow"
                :class="{ 'nav-arrow--active': activeSection === item.id }"
              />
            </button>
          </nav>

          <div class="dev-content">
            <!-- System prompt section -->
            <template v-if="activeSection === 'prompts'">
              <div
                v-for="group in promptGroups"
                :key="group.name"
                class="settings-card"
              >
                <div class="settings-card-header">
                  <div class="settings-card-header-text">
                    <h3 class="settings-card-title">
                      {{ group.name }}
                    </h3>
                    <span class="settings-card-desc">{{ group.description }}</span>
                  </div>
                  <span class="group-badge">{{ group.prompts.length }} prompts</span>
                </div>
                <div class="settings-list">
                  <button
                    v-for="prompt in group.prompts"
                    :key="prompt.id"
                    type="button"
                    class="settings-item settings-item--clickable"
                    @click="emit('selectPrompt', prompt)"
                  >
                    <div class="settings-item-content">
                      <span class="settings-item-label">
                        {{ prompt.label }}
                        <span v-if="hasPromptOverride(prompt.id)" class="override-dot" title="Custom prompt" />
                      </span>
                      <span class="settings-item-desc">{{ prompt.description || `${prompt.content.slice(0, 100)}...` }}</span>
                    </div>
                  </button>
                </div>
              </div>
            </template>

            <!-- SubAgent section with prompts -->
            <template v-else-if="activeSection === 'subagent'">
              <div v-if="subagentPrompts.length > 0" class="settings-card">
                <div class="settings-card-header">
                  <div class="settings-card-header-text">
                    <h3 class="settings-card-title">
                      SubAgent Prompts
                    </h3>
                    <span class="settings-card-desc">Specialized system prompts for focused sub-agent personalities.</span>
                  </div>
                  <span class="group-badge">{{ subagentPrompts.length }} prompts</span>
                </div>
                <div class="settings-list">
                  <button
                    v-for="prompt in subagentPrompts"
                    :key="prompt.id"
                    type="button"
                    class="settings-item settings-item--clickable"
                    @click="emit('selectPrompt', prompt)"
                  >
                    <div class="settings-item-content">
                      <span class="settings-item-label">
                        {{ prompt.label }}
                        <span v-if="hasPromptOverride(prompt.id)" class="override-dot" title="Custom prompt" />
                      </span>
                      <span class="settings-item-desc">{{ prompt.description }}</span>
                    </div>
                  </button>
                </div>
              </div>
              <div
                v-for="group in activeGroups"
                :key="group.id"
                class="settings-card"
              >
                <div class="settings-card-header">
                  <div class="settings-card-header-text">
                    <h3 class="settings-card-title">
                      {{ group.label }}
                    </h3>
                    <span class="settings-card-desc">{{ group.description }}</span>
                  </div>
                  <span class="group-badge">{{ group.tools.length }} tools</span>
                </div>
                <div class="settings-list">
                  <button
                    v-for="tool in group.tools"
                    :key="tool.id"
                    type="button"
                    class="settings-item settings-item--clickable"
                    @click="emit('selectTool', { id: tool.id, label: tool.label, description: tool.description, groupLabel: group.label })"
                  >
                    <div class="settings-item-content">
                      <span class="settings-item-label">
                        {{ tool.label }}
                        <span v-if="hasToolOverride(tool.id)" class="override-dot" title="Custom description" />
                      </span>
                      <span class="settings-item-desc">{{ tool.description }}</span>
                    </div>
                  </button>
                </div>
              </div>
            </template>

            <!-- Tool sections -->
            <template v-else-if="activeGroups.length > 0">
              <div
                v-for="group in activeGroups"
                :key="group.id"
                class="settings-card"
              >
                <div class="settings-card-header">
                  <div class="settings-card-header-text">
                    <h3 class="settings-card-title">
                      {{ group.label }}
                    </h3>
                    <span class="settings-card-desc">{{ group.description }}</span>
                  </div>
                  <span class="group-badge">{{ group.tools.length }} tools</span>
                </div>
                <div class="settings-list">
                  <button
                    v-for="tool in group.tools"
                    :key="tool.id"
                    type="button"
                    class="settings-item settings-item--clickable"
                    @click="emit('selectTool', { id: tool.id, label: tool.label, description: tool.description, groupLabel: group.label })"
                  >
                    <div class="settings-item-content">
                      <span class="settings-item-label">
                        {{ tool.label }}
                        <span v-if="hasToolOverride(tool.id)" class="override-dot" title="Custom description" />
                      </span>
                      <span class="settings-item-desc">{{ tool.description }}</span>
                    </div>
                  </button>
                </div>
              </div>
            </template>
            <div v-else class="dev-content-empty">
              <span class="text-[13px] text-[var(--color-text-tertiary)]">No tools in this section</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
  width: 820px;
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
}

.dev-nav {
  display: flex;
  flex-direction: column;
  width: 188px;
  min-width: 188px;
  padding: 12px 8px;
  gap: 1px;
  border-right: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding-inline: 10px 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
  position: relative;
}

.nav-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.nav-item--active {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.nav-item--active:hover {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-arrow {
  margin-left: auto;
  color: var(--color-text-tertiary);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.nav-item:hover .nav-arrow,
.nav-arrow--active {
  opacity: 1;
  transform: translateX(0);
}

.dev-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 28px;
}

.dev-content-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 16px;
}

.settings-card:last-child {
  margin-bottom: 0;
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
  letter-spacing: 0.01em;
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
