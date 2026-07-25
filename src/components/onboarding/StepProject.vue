<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, FolderPlus, FolderX } from 'lucide-vue-next'
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'

defineEmits<{ next: [] }>()

const project = useProjectStore()
const s = useSettingsStore()

const projectName = computed(() => {
  if (!project.projectPath)
    return null
  return project.projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
})

async function pickFolder() {
  const selected = await open({
    directory: true,
    recursive: true,
    multiple: false,
    title: 'Open project folder',
  })
  if (typeof selected === 'string')
    project.addProject(selected)
}

function clearProject() {
  project.clearProject()
}
</script>

<template>
  <div class="step-project">
    <div class="step-header">
      <h2 class="step-title">
        Project & Permissions
      </h2>
      <p class="step-desc">
        Select a project folder and default permission mode
      </p>
    </div>

    <div class="project-body">
      <!-- Project picker -->
      <div class="section-block">
        <label class="form-label">Project Folder</label>
        <div class="project-current">
          <div v-if="projectName" class="project-name">
            <FolderOpen :size="14" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
            <span>{{ projectName }}</span>
            <button class="clear-btn" @click="clearProject">
              <FolderX :size="13" :stroke-width="1.8" />
            </button>
          </div>
          <button class="pick-folder-btn" @click="pickFolder">
            <FolderPlus :size="14" :stroke-width="1.8" />
            {{ projectName ? 'Change Folder' : 'Select Folder' }}
          </button>
        </div>
        <span class="form-hint">This sets the working directory for the agent</span>
      </div>

      <!-- Permission mode -->
      <div class="section-block">
        <label class="form-label">Default Permission Mode</label>
        <p class="form-hint" style="margin-bottom: 8px;">
          Controls how the agent handles tool calls that modify files or execute commands.
        </p>
        <div class="permission-grid">
          <button
            class="permission-card"
            :class="{ active: s.agent.permissionMode === 'ask' }"
            @click="s.agent.permissionMode = 'ask'"
          >
            <span class="permission-card-title">Ask</span>
            <span class="permission-card-desc">Prompt before every tool execution</span>
          </button>
          <button
            class="permission-card"
            :class="{ active: s.agent.permissionMode === 'auto' }"
            @click="s.agent.permissionMode = 'auto'"
          >
            <span class="permission-card-title">Auto</span>
            <span class="permission-card-desc">AI reviews tool calls; blocks dangerous ones</span>
          </button>
          <button
            class="permission-card"
            :class="{ active: s.agent.permissionMode === 'yolo' }"
            @click="s.agent.permissionMode = 'yolo'"
          >
            <span class="permission-card-title">Yolo</span>
            <span class="permission-card-desc">Allow tool execution without prompting</span>
          </button>
        </div>
      </div>
    </div>

    <div class="step-actions">
      <button class="step-btn-secondary" @click="$emit('next')">
        Skip
      </button>
      <button class="step-btn" @click="$emit('next')">
        Next
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-project {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.step-header {
  flex-shrink: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border-mid);
  margin-bottom: 16px;
}

.step-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin: 0 0 4px 0;
}

.step-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
}

.project-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-hint {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  margin: 0;
}

.project-current {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-name {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.project-name span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.clear-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}

.clear-btn:hover {
  background: color-mix(in srgb, var(--color-danger-muted) 30%, transparent);
  color: var(--color-danger-text);
}

.pick-folder-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
}

.pick-folder-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-text-primary);
  border-color: var(--color-border-strong);
}

.permission-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.permission-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
  font-family: inherit;
}

.permission-card:hover {
  border-color: var(--color-border-strong);
}

.permission-card.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.permission-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.permission-card.active .permission-card-title {
  color: var(--color-accent);
}

.permission-card-desc {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}

.step-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-mid);
  margin-top: 16px;
}

.step-btn {
  height: 36px;
  padding: 0 24px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.step-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-elevated));
  border-color: var(--color-border-strong);
}

.step-btn-secondary {
  height: 36px;
  padding: 0 24px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
}

.step-btn-secondary:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-border-strong);
}
</style>
