<script setup lang="ts">
import type { ScaffoldTemplate } from '@/utils/scaffold/templates'

const props = defineProps<{
  template: ScaffoldTemplate
}>()

const emit = defineEmits<{
  select: [template: ScaffoldTemplate]
}>()
</script>

<template>
  <button class="template-card" type="button" @click="emit('select', props.template)">
    <span class="template-card-accent" :style="{ backgroundColor: props.template.iconColor }" />
    <div class="template-card-body">
      <div class="template-card-head">
        <h3 class="template-card-title">
          {{ props.template.name }}
        </h3>
        <span class="template-card-badge">
          {{ props.template.category }}
        </span>
      </div>
      <p class="template-card-desc">
        {{ props.template.description }}
      </p>
    </div>
  </button>
</template>

<style scoped>
.template-card {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 0;
  width: 100%;
  text-align: left;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  color: inherit;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
  box-shadow: none;
}

.template-card:hover {
  transform: translateY(-1px) scale(1.01);
  background: var(--color-bg-hover);
  border-color: var(--color-accent-muted);
  box-shadow: var(--color-shadow);
}

.template-card-accent {
  width: 4px;
  align-self: stretch;
  flex-shrink: 0;
}

.template-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 14px 13px;
  min-width: 0;
  flex: 1;
}

.template-card-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}

.template-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.35;
}

.template-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}

.template-card-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  border-radius: var(--radius-md);
  font-size: 10px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  white-space: nowrap;
}
</style>
