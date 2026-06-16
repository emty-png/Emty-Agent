<script setup lang="ts">
import { Loader, RefreshCw } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'

const s = useSettingsStore()
const project = useProjectStore()

const {
  availableSkills,
  projectSkillsStatus,
  projectSkillsStatusMessage,
} = storeToRefs(s)
const { projectPath } = storeToRefs(project)

const enabledSkillCount = computed(() => availableSkills.value.filter(skill => skill.enabled).length)

async function refreshSkills() {
  await s.refreshProjectSkills(projectPath.value)
}
</script>

<template>
  <section class="content-section">
    <div class="skills-header">
      <div class="skills-header-main">
        <h2 class="section-title">
          Skills
        </h2>
        <span class="skills-count">{{ enabledSkillCount }} of {{ availableSkills.length }}</span>
      </div>
      <button class="icon-btn" :disabled="projectSkillsStatus === 'testing'" title="Refresh skills" @click="refreshSkills()">
        <Loader v-if="projectSkillsStatus === 'testing'" :size="14" class="spin" />
        <RefreshCw v-else :size="14" />
      </button>
    </div>

    <div v-if="projectSkillsStatus !== 'idle' && projectSkillsStatusMessage" class="skills-status" :class="{ 'skills-status--error': projectSkillsStatus === 'error' }">
      {{ projectSkillsStatusMessage }}
    </div>

    <div class="skills-list">
      <div
        v-for="skill in availableSkills"
        :key="skill.id"
        class="skill-item"
        :class="{ 'skill-item--disabled': !skill.enabled }"
      >
        <div class="skill-info">
          <span class="skill-title">{{ skill.title }}</span>
          <span class="skill-desc">{{ skill.description }}</span>
        </div>
        <button
          class="model-toggle"
          :class="{ 'model-toggle--on': skill.enabled }"
          type="button"
          :aria-pressed="skill.enabled"
          @click="s.setSkillEnabled(skill.id, !skill.enabled)"
        >
          <span class="model-toggle-thumb" />
        </button>
      </div>
    </div>

    <div v-if="!projectPath" class="skills-empty">
      Open a project to load custom skills
    </div>
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}

.skills-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.skills-header-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.skills-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  padding: 3px 10px;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-md);
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.skills-status {
  padding: 10px 14px;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.skills-status--error {
  background: var(--color-danger-muted);
  color: var(--color-danger-text);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
}

.skill-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: var(--color-bg-surface);
  transition: background 100ms ease;
  cursor: pointer;
}

.skill-item:hover {
  background: var(--color-state-hover);
}

.skill-item--disabled {
  opacity: 0.7;
}

.skill-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.skill-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
}

.skill-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}

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

.skills-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-surface);
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-lg);
  margin-top: 16px;
}
</style>
