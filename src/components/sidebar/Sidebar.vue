<script setup lang="ts">
import {
  FolderOpen,
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@/stores/sidebar'

const props = defineProps<{
  activeView?: 'chat' | 'history' | 'projects'
}>()

const emit = defineEmits<{
  selectView: [view: 'chat' | 'history' | 'projects']
  openSettings: []
}>()

const sidebar = useSidebarStore()
const { collapsed } = storeToRefs(sidebar)
const { toggle } = sidebar
</script>

<template>
  <aside class="sidebar" :class="[{ 'sidebar--collapsed': collapsed }]">
    <!-- ── collapse toggle ──────────────────────────────────────────────── -->
    <div class="sidebar-section sidebar-section--top">
      <button
        class="sidebar-btn sidebar-btn--toggle"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <span class="icon-swap">
          <PanelLeftClose
            :size="15"
            :stroke-width="1.7"
            class="icon-swap__icon"
            :class="[{ 'icon-swap__icon--hidden': collapsed }]"
          />
          <PanelLeftOpen
            :size="15"
            :stroke-width="1.7"
            class="icon-swap__icon icon-swap__icon--back"
            :class="[{ 'icon-swap__icon--hidden': !collapsed }]"
          />
        </span>
        <span class="sidebar-label">Collapse</span>
      </button>
    </div>

    <!-- ── divider ───────────────────────────────────────────────────────── -->
    <div class="sidebar-divider" />

    <!-- ── nav items ─────────────────────────────────────────── -->
    <nav class="sidebar-nav">
      <button
        class="sidebar-btn"
        :class="{
          'sidebar-btn--active': props.activeView !== 'projects' && props.activeView !== 'history',
        }"
        aria-label="Chat"
        @click="emit('selectView', 'chat')"
      >
        <MessageSquare :size="15" :stroke-width="1.7" class="flex-shrink-0" />
        <span class="sidebar-label">Chat</span>
      </button>

      <button
        class="sidebar-btn"
        :class="{ 'sidebar-btn--active': props.activeView === 'history' }"
        aria-label="History"
        @click="emit('selectView', 'history')"
      >
        <History :size="15" :stroke-width="1.7" class="flex-shrink-0" />
        <span class="sidebar-label">History</span>
      </button>

      <button
        class="sidebar-btn"
        :class="{ 'sidebar-btn--active': props.activeView === 'projects' }"
        aria-label="Projects"
        @click="emit('selectView', 'projects')"
      >
        <FolderOpen :size="15" :stroke-width="1.7" class="flex-shrink-0" />
        <span class="sidebar-label">Projects</span>
      </button>

      <slot />
    </nav>

    <!-- ── bottom: settings ──────────────────────────────────── -->
    <div class="sidebar-bottom">
      <div class="sidebar-divider" />
      <div class="sidebar-section--bottom">
        <button class="sidebar-btn" aria-label="Settings" @click="emit('openSettings')">
          <Settings :size="15" :stroke-width="1.7" class="flex-shrink-0" />
          <span class="sidebar-label">Settings</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 249px;
  min-width: 249px;
  max-width: 249px;
  height: 100%;
  background: var(--color-bg-surface);
  border-right: 1px solid var(--color-border-mid);
  transition:
    width 200ms cubic-bezier(0.4, 0, 0.2, 1),
    min-width 200ms cubic-bezier(0.4, 0, 0.2, 1),
    max-width 200ms cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar--collapsed {
  width: 49px;
  min-width: 49px;
  max-width: 49px;
}

.sidebar-section--top {
  padding: 8px 7px 6px;
}

.sidebar-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin-inline: 8px;
  flex-shrink: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 7px;
  flex: 1;
}

.sidebar-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding-inline: 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.sidebar-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.sidebar-btn:active {
  background: var(--color-bg-elevated);
}

.sidebar-btn--toggle {
  color: var(--color-text-tertiary);
}
.sidebar-btn--toggle:hover {
  color: var(--color-text-secondary);
}

.sidebar-btn--active {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}

.sidebar-btn--active:hover {
  background: var(--color-bg-hover);
  color: var(--color-ember-bright);
}

.icon-swap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.icon-swap__icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 200ms ease;
}

.icon-swap__icon--hidden {
  opacity: 0;
  pointer-events: none;
}

.sidebar-bottom {
  flex-shrink: 0;
}
.sidebar-section--bottom {
  padding: 6px 7px 8px;
}

.sidebar-label {
  font-size: 12.5px;
  font-weight: 450;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  max-width: 180px;
  opacity: 1;
  transition:
    max-width 200ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 120ms ease 60ms;
}

.sidebar--collapsed .sidebar-label {
  max-width: 0;
  opacity: 0;
  pointer-events: none;
  transition:
    max-width 200ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 80ms ease;
}
</style>
