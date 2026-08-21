<script setup lang="ts">
import { Boxes, FileText } from 'lucide-vue-next'

const selectedItem = defineModel<string>({ default: 'prompt' })
</script>

<template>
  <div class="dev-sidebar-root">
    <div class="panel-header">
      <span class="panel-title">Developer</span>
    </div>
    <div class="panel-body">
      <button
        type="button"
        class="dev-sidebar-item"
        :class="{ 'dev-sidebar-item--active': selectedItem === 'prompt' }"
        @click="selectedItem = 'prompt'"
      >
        <FileText :size="14" :stroke-width="1.7" class="shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">Prompt</span>
      </button>
      <button
        type="button"
        class="dev-sidebar-item"
        :class="{ 'dev-sidebar-item--active': selectedItem === 'providers-models' }"
        @click="selectedItem = 'providers-models'"
      >
        <Boxes :size="14" :stroke-width="1.7" class="shrink-0" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">Providers / Models</span>
        <span class="coming-soon-badge">Coming soon</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dev-sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-surface);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  height: 30px;
  min-height: 30px;
  padding-inline: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.dev-sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding-inline: 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.dev-sidebar-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.dev-sidebar-item--active {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.dev-sidebar-item--active:hover {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.coming-soon-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  padding: 3px 5px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-subtle);
  white-space: nowrap;
}

.dev-sidebar-item--active .coming-soon-badge {
  background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-elevated));
  color: var(--color-accent-text);
  border-color: var(--color-accent-dim);
}
</style>
