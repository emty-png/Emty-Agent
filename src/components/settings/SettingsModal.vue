<script setup lang="ts">
import type { Component } from 'vue'
import {
  BookOpen,
  ChevronRight,
  Palette,
  Puzzle,
  Server,
  Settings,
  Shield,
  X,
  Zap,
} from 'lucide-vue-next'
import { ref } from 'vue'

import AgentSection from './sections/AgentSection.vue'
import GeneralSection from './sections/GeneralSection.vue'
import McpSection from './sections/McpSection.vue'
import ModelsSection from './sections/ModelsSection.vue'
import ProvidersSection from './sections/ProvidersSection.vue'
import SkillsSection from './sections/SkillsSection.vue'
import ThemeSection from './sections/ThemeSection.vue'

//  props / emits
const emit = defineEmits<{ close: [] }>()

//  navigation
type Section = 'general' | 'agent' | 'theme' | 'skills' | 'mcp' | 'providers' | 'models'
const activeSection = ref<Section>('providers')

const NAV: { id: Section; label: string; icon: Component }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'agent', label: 'Agent', icon: Shield },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP', icon: Server },
  { id: 'providers', label: 'Providers', icon: Puzzle },
  { id: 'models', label: 'Models', icon: Zap },
]

// close on Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}
</script>

<template>
  <Teleport to="body">
    <!-- backdrop -->
    <div class="settings-backdrop" data-overlay @click.self="emit('close')" @keydown="onKeydown">
      <!-- modal -->
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <!--  modal header  -->
        <div class="modal-header">
          <span class="modal-title">Settings</span>
          <button class="modal-close" aria-label="Close settings" @click="emit('close')">
            <X :size="14" :stroke-width="2" />
          </button>
        </div>

        <!--  body: sidebar + content  -->
        <div class="modal-body">
          <!-- left nav -->
          <nav class="settings-nav">
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

          <!-- right content -->
          <div class="settings-content">
            <GeneralSection v-if="activeSection === 'general'" />
            <AgentSection v-else-if="activeSection === 'agent'" />
            <ThemeSection v-else-if="activeSection === 'theme'" />
            <SkillsSection v-else-if="activeSection === 'skills'" />
            <McpSection v-else-if="activeSection === 'mcp'" />
            <ProvidersSection v-else-if="activeSection === 'providers'" />
            <ModelsSection v-else-if="activeSection === 'models'" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*  backdrop  */
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/*  modal shell  */
.settings-modal {
  display: flex;
  flex-direction: column;
  width: 820px;
  max-width: 100%;
  height: 560px;
  max-height: calc(100vh - 48px);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
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

/*  header  */
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
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.modal-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/*  body  */
.modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/*  left nav  */
.settings-nav {
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
  border-radius: 6px;
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
  background: var(--color-bg-hover);
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

/*  right content  */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 32px;
}
</style>
