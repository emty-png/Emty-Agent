<script setup lang="ts">
import type { Component } from 'vue'
import {
  BookOpen,
  ChevronRight,
  Palette,
  Puzzle,
  Settings,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-vue-next'
import { h, ref } from 'vue'

import ProvidersSection from './providers/ProvidersSection.vue'
import AgentSection from './sections/AgentSection.vue'
import McpSection from './sections/McpSection.vue'
import ModelsSection from './sections/ModelsSection.vue'
import OthersSection from './sections/OthersSection.vue'
import SkillsSection from './sections/SkillsSection.vue'
import ThemeSection from './sections/ThemeSection.vue'

//  props / emits
const emit = defineEmits<{ close: []; browseProviders: [] }>()

// Custom MCP icon (Boxicons) — uses currentColor to inherit theme colors
function McpIcon(props: { size?: number }) {
  const s = (props.size ?? 24) + 2
  return h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: s,
      height: s,
      viewBox: '0 0 24 24',
      fill: 'currentColor',
    },
    [
      h('path', {
        d: 'm19.97,11.84c.66-.66,1.02-1.53,1.02-2.46s-.36-1.8-1.02-2.46l-.04-.04c-.66-.66-1.53-1.02-2.46-1.02-.17,0-.34.03-.51.05.02-.17.05-.33.05-.51,0-.93-.36-1.8-1.02-2.46-.66-.66-1.53-1.02-2.46-1.02s-1.8.36-2.46,1.02l-7.87,7.87c-.27.27-.27.71,0,.98s.71.27.98,0l7.87-7.87c.39-.39.92-.61,1.47-.61s1.08.22,1.47.61c.39.39.61.92.61,1.48s-.22,1.08-.61,1.48l-5.86,5.86-.08.08c-.27.27-.27.71,0,.98.14.14.31.2.49.2s.36-.07.49-.2l5.94-5.94c.39-.39.92-.61,1.48-.61s1.08.22,1.47.61l.04.04c.39.39.61.92.61,1.47s-.22,1.08-.61,1.48l-7.11,7.11c-.63.63-.63,1.66,0,2.29l1.46,1.46c.14.14.31.2.49.2s.36-.07.49-.2c.27-.27.27-.71,0-.98l-1.46-1.46c-.09-.09-.09-.24,0-.33l7.11-7.11Z',
      }),
      h('path', {
        d: 'm17.96,9.83c.27-.27.27-.71,0-.98-.27-.27-.71-.27-.98,0l-5.82,5.82c-.81.81-2.14.81-2.95,0-.81-.81-.81-2.14,0-2.95l5.82-5.82c.27-.27.27-.71,0-.98-.27-.27-.71-.27-.98,0l-5.82,5.82c-1.36,1.36-1.36,3.56,0,4.92.68.68,1.57,1.02,2.46,1.02s1.78-.34,2.46-1.02l5.82-5.82Z',
      }),
    ],
  )
}

//  navigation
type Section = 'agent' | 'theme' | 'skills' | 'mcp' | 'providers' | 'models' | 'others'
const activeSection = ref<Section>('providers')

const NAV: { id: Section; label: string; icon: Component }[] = [
  { id: 'agent', label: 'Agent', icon: Settings },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP', icon: McpIcon },
  { id: 'providers', label: 'Providers', icon: Puzzle },
  { id: 'models', label: 'Models', icon: Zap },
  { id: 'others', label: 'Others', icon: SlidersHorizontal },
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
            <AgentSection v-if="activeSection === 'agent'" />
            <ThemeSection v-else-if="activeSection === 'theme'" />
            <SkillsSection v-else-if="activeSection === 'skills'" />
            <McpSection v-else-if="activeSection === 'mcp'" />
            <ProvidersSection v-else-if="activeSection === 'providers'" @browse-providers="emit('browseProviders')" />
            <ModelsSection v-else-if="activeSection === 'models'" />
            <OthersSection v-else-if="activeSection === 'others'" />
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
  background: color-mix(in srgb, var(--color-bg-base) 65%, transparent);
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

/*  right content  */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 32px;
}
</style>
