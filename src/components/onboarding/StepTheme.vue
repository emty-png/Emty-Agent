<script setup lang="ts">
import ThemeSwitcher from '@/components/settings/ThemeSwitcher.vue'

defineEmits<{ finish: [] }>()
</script>

<template>
  <div class="step-theme">
    <div class="step-header">
      <h2 class="step-title">
        Appearance
      </h2>
      <p class="step-desc">
        Choose a theme for your workspace
      </p>
    </div>

    <div class="theme-body">
      <ThemeSwitcher />
    </div>

    <div class="step-actions">
      <button class="step-btn" @click="$emit('finish')">
        Finish
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-theme {
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

.theme-body {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
}

.theme-body::-webkit-scrollbar {
  width: 6px;
}

.theme-body::-webkit-scrollbar-track {
  background: transparent;
}

.theme-body::-webkit-scrollbar-thumb {
  background: var(--color-border-mid);
  border-radius: 3px;
}

.step-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
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
</style>
