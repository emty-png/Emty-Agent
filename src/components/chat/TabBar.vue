<script setup lang="ts">
import { GitBranch, Globe, Plus, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { useGitPaneStore } from '@/stores/gitPane'

const chat = useChatStore()
const browser = useBrowserStore()
const gitPane = useGitPaneStore()
const { tabs, activeId } = storeToRefs(chat)

const activeBrowserOwner = computed(() => browser.getOwner(activeId.value))
const activeGitOwner = computed(() => gitPane.getOwner(activeId.value))

function toggleBrowser() {
  if (activeBrowserOwner.value.isPanelOpen) {
    browser.closePanel(activeId.value)
  }
  else {
    // Close git pane first (mutual exclusivity)
    gitPane.closePanel(activeId.value)
    browser.openPanel(activeId.value)
  }
}

function toggleGitPane() {
  gitPane.togglePanel(activeId.value)
}
</script>

<template>
  <div class="tab-bar">
    <div class="tab-list">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{
          'tab--active': tab.id === activeId,
          'tab--subagent': !!tab.subAgent,
        }"
        @click="activeId = tab.id"
      >
        <span v-if="tab.isStreaming" class="tab-streaming-dot" />
        <span class="tab-title">{{ tab.title }}</span>
        <span
          class="tab-close"
          role="button"
          aria-label="Close tab"
          @click.stop="chat.closeTab(tab.id)"
        >
          <X :size="11" :stroke-width="2" />
        </span>
      </button>
    </div>

    <button
      class="tab-new"
      :class="{ 'tab-new--active': activeBrowserOwner.isPanelOpen }"
      aria-label="Toggle embedded browser"
      title="Toggle embedded browser"
      @click="toggleBrowser"
    >
      <Globe :size="14" :stroke-width="1.8" />
    </button>

    <button
      class="tab-new"
      :class="{ 'tab-new--hidden': tabs.length >= 9 }"
      aria-label="New chat"
      :disabled="tabs.length >= 9"
      @click="chat.addTab"
    >
      <Plus :size="14" :stroke-width="1.8" />
    </button>

    <button
      class="tab-new"
      :class="{ 'tab-new--active': activeGitOwner.isPanelOpen }"
      aria-label="Git Menu"
      title="Git Menu"
      @click="toggleGitPane"
    >
      <GitBranch :size="14" :stroke-width="1.8" />
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  padding-inline: 8px 4px;
  background: var(--color-bg-surface);
  box-shadow: inset 0 -1px 0 var(--color-border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-list {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 140px;
  min-width: 140px;
  height: 30px;
  padding-inline: 10px 8px;
  border-top: 1px solid transparent;
  border-left: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 450;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}
.tab:not(.tab--active):hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab--active {
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  border-top-color: var(--color-border-subtle);
  border-left-color: var(--color-border-subtle);
  border-right-color: var(--color-border-subtle);
  border-bottom-color: var(--color-bg-base);
  cursor: default;
}
.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-close {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}
.tab:not(.tab--active):hover .tab-close,
.tab--active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tab-streaming-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-bright);
  flex-shrink: 0;
  animation: tab-pulse 1.4s ease-in-out infinite;
}
@keyframes tab-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.65);
  }
}

.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.tab-new:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab-new--active {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent-text);
}
.tab-new--hidden {
  opacity: 0;
  pointer-events: none;
}
</style>
