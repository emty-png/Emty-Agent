<script setup lang="ts">
import { useThemeStore } from '@/stores/themes'

const store = useThemeStore()
</script>

<template>
  <div class="theme-switcher">
    <p class="section-label">
      Theme
    </p>

    <div class="theme-grid">
      <button
        v-for="theme in store.themes"
        :key="theme.id"
        class="theme-card"
        :class="{ active: store.activeTheme === theme.id }"
        :title="theme.name"
        @click="store.setTheme(theme.id)"
      >
        <!-- Theme Preview "Icon" -->
        <div class="theme-preview" :style="{ background: theme.bg }">
          <div class="preview-accent" :style="{ background: theme.accent }" />
          <div class="preview-lines">
            <div class="preview-line" />
            <div class="preview-line" />
          </div>
        </div>

        <!-- Label -->
        <span class="theme-name">{{ theme.name }}</span>

        <!-- Active checkmark -->
        <span v-if="store.activeTheme === theme.id" class="active-dot" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-switcher {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin: 0;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-card);
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.theme-card:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-mid);
}

.theme-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}

.theme-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 42px;
  height: 32px;
  padding: 6px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  position: relative;
  overflow: hidden;
  transition: transform 0.2s ease;
}

.theme-card:hover .theme-preview {
  transform: scale(1.05);
}

.preview-accent {
  width: 50%;
  height: 4px;
  border-radius: 2px;
}

.preview-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preview-line {
  width: 90%;
  height: 2px;
  background: var(--color-text-tertiary);
  opacity: 0.3;
  border-radius: 1px;
}

.theme-name {
  font-size: 10px;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-weight: 500;
}

.theme-card.active .theme-name {
  color: var(--color-accent-text);
}

.active-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
}
</style>
