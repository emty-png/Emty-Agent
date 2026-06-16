<script setup lang="ts">
import { computed, ref } from 'vue'
import { ALL_COLOR_VARS, DEFAULT_RADIUS, KEY_COLOR_VARS, useThemeStore } from '@/stores/themes'

const store = useThemeStore()
const importText = ref('')
const importError = ref('')

const allThemes = computed(() => [
  ...store.themes.map(t => ({ ...t, isCustom: false })),
  ...store.customThemes.map(t => ({ ...t, isCustom: true })),
])

const defaults = computed(() => store.getThemeDefaultsForEditor())

function currentColor(varKey: string): string {
  const override = store.themeOverrides[store.activeTheme]?.colors?.[varKey]
  if (override)
    return override
  return defaults.value[varKey] || '#000000'
}

function currentRadius(varKey: string): number {
  const override = store.themeOverrides[store.activeTheme]?.radius?.[varKey]
  if (override !== undefined)
    return override
  return DEFAULT_RADIUS[varKey] ?? 6
}

function onColorInput(varKey: string, e: Event) {
  store.setColorOverride(varKey, (e.target as HTMLInputElement).value)
}

function onRadiusInput(varKey: string, e: Event) {
  store.setRadiusOverride(varKey, Number((e.target as HTMLInputElement).value))
}

function handleImport() {
  importError.value = ''
  const result = store.importTheme(importText.value)
  if (result.success) {
    importText.value = ''
  }
  else {
    importError.value = result.error || 'Import failed'
  }
}

function handleExport(id: string) {
  const json = store.exportTheme(id)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `theme-${id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function selectTheme(id: string) {
  store.setTheme(id)
}
</script>

<template>
  <div class="theme-switcher">
    <!-- Theme Grid -->
    <p class="section-label">
      Theme
    </p>

    <div class="theme-grid">
      <button
        v-for="theme in allThemes"
        :key="theme.id"
        class="theme-card"
        :class="{ active: store.activeTheme === theme.id }"
        :title="theme.name"
        @click="selectTheme(theme.id)"
      >
        <div class="theme-preview" :style="{ background: theme.bg }">
          <div class="preview-accent" :style="{ background: theme.accent }" />
          <div class="preview-lines">
            <div class="preview-line" />
            <div class="preview-line" />
          </div>
        </div>
        <span class="theme-name">{{ theme.name }}</span>
        <span v-if="store.activeTheme === theme.id" class="active-dot" />
        <div v-if="theme.isCustom" class="theme-card-actions">
          <button
            class="icon-btn"
            title="Export"
            @click.stop="handleExport(theme.id)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          </button>
          <button
            class="icon-btn icon-btn--danger"
            title="Delete"
            @click.stop="store.removeCustomTheme(theme.id)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </button>
    </div>

    <!-- Action Bar -->
    <div class="action-bar">
      <button class="action-btn" @click="handleExport(store.activeTheme)">
        Export
      </button>
    </div>

    <!-- Import Panel -->
    <div class="panel">
      <p class="panel-title">
        Import Theme
      </p>
      <p class="panel-desc">
        Paste a JSON theme file or a CSS <code>[data-theme='...']</code> block.
      </p>
      <textarea
        v-model="importText"
        class="import-textarea"
        placeholder="{ &quot;id&quot;: &quot;my-theme&quot;, &quot;name&quot;: &quot;My Theme&quot;, &quot;variables&quot;: { &quot;--color-bg-base&quot;: &quot;#0a0a0a&quot; } }"
        spellcheck="false"
      />
      <p v-if="importError" class="import-error">
        {{ importError }}
      </p>
      <div class="panel-actions">
        <button class="action-btn action-btn--primary" @click="handleImport">
          Import
        </button>
      </div>
    </div>

    <!-- Radius Editor -->
    <div class="panel">
      <p class="panel-title">
        Border Radius
      </p>
      <div class="radius-grid">
        <label v-for="(_, key) in DEFAULT_RADIUS" :key="key" class="radius-row">
          <span class="radius-label">{{ key.replace('--radius-', '') }}</span>
          <input
            type="range"
            :min="0"
            :max="key === '--radius-lg' ? 20 : 12"
            :value="currentRadius(key)"
            class="radius-slider"
            @input="onRadiusInput(key, $event)"
          >
          <span class="radius-value">{{ currentRadius(key) }}px</span>
        </label>
      </div>
      <button class="action-btn" @click="store.resetOverrides()">
        Reset to defaults
      </button>
    </div>

    <!-- Color Editor -->
    <div class="panel">
      <p class="panel-title">
        Edit Colors
      </p>

      <!-- Key colors -->
      <div class="color-grid">
        <label v-for="v in KEY_COLOR_VARS" :key="v.key" class="color-row">
          <span class="color-label">{{ v.label }}</span>
          <div class="color-input-wrap">
            <input
              type="color"
              :value="currentColor(v.key)"
              class="color-picker"
              @input="onColorInput(v.key, $event)"
            >
            <input
              type="text"
              :value="currentColor(v.key)"
              class="color-hex"
              spellcheck="false"
              @change="store.setColorOverride(v.key, ($event.target as HTMLInputElement).value)"
            >
          </div>
        </label>
      </div>

      <!-- Advanced: all variables grouped -->
      <div class="advanced-vars">
        <div v-for="group in ALL_COLOR_VARS" :key="group.group" class="var-group">
          <p class="var-group-title">
            {{ group.group }}
          </p>
          <div class="color-grid">
            <label v-for="v in group.vars" :key="v.key" class="color-row">
              <span class="color-label">{{ v.label }}</span>
              <div class="color-input-wrap">
                <input
                  type="color"
                  :value="currentColor(v.key)"
                  class="color-picker"
                  @input="onColorInput(v.key, $event)"
                >
                <input
                  type="text"
                  :value="currentColor(v.key)"
                  class="color-hex"
                  spellcheck="false"
                  @change="store.setColorOverride(v.key, ($event.target as HTMLInputElement).value)"
                >
              </div>
            </label>
          </div>
        </div>
      </div>

      <div class="panel-actions">
        <button class="action-btn" @click="store.resetOverrides()">
          Reset changes
        </button>
      </div>
    </div>

    <!-- Landing Art Toggle -->
    <label class="art-toggle">
      <span class="art-toggle-label">Landing illustration</span>
      <button
        class="model-toggle"
        :class="{ 'model-toggle--on': store.showLandingArt }"
        type="button"
        :aria-pressed="store.showLandingArt"
        @click="store.showLandingArt = !store.showLandingArt"
      ><span class="model-toggle-thumb" /></button>
    </label>
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

/* ── Theme Grid ────────────────────────────────────────────────── */
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
  background: var(--color-state-hover);
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
  border-radius: var(--radius-md);
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

.theme-card-actions {
  position: absolute;
  top: 4px;
  left: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.theme-card:hover .theme-card-actions {
  opacity: 1;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.12s;
}

.icon-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.icon-btn--danger:hover {
  background: color-mix(in srgb, var(--color-danger) 20%, transparent);
  color: var(--color-danger-text);
}

/* ── Action Bar ────────────────────────────────────────────────── */
.action-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-inline: 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.action-btn.active {
  background: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.action-btn--primary {
  background: var(--color-accent-dim);
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.action-btn--primary:hover {
  background: var(--color-accent);
}

/* ── Panels ────────────────────────────────────────────────────── */
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-surface);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.panel-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 0;
  line-height: 1.4;
}

.panel-desc code {
  font-size: 11px;
  color: var(--color-text-code);
  background: var(--color-bg-elevated);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
}

.panel-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

/* ── Radius Editor ─────────────────────────────────────────────── */
.radius-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radius-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.radius-label {
  width: 40px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.radius-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-border-mid);
  border-radius: 2px;
  outline: none;
}

.radius-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: 2px solid var(--color-bg-surface);
}

.radius-value {
  width: 32px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--color-text-tertiary);
  text-align: right;
}

/* ── Color Editor ──────────────────────────────────────────────── */
.color-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.color-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.color-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-picker {
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  padding: 0;
  cursor: pointer;
  background: none;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}

.color-hex {
  width: 80px;
  height: 24px;
  padding-inline: 6px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  outline: none;
}

.color-hex:focus {
  border-color: var(--color-accent-dim);
}

/* ── Advanced Variables ────────────────────────────────────────── */
.advanced-vars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.var-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 4px;
}

/* ── Import ────────────────────────────────────────────────────── */
.import-textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
  outline: none;
}

.import-textarea:focus {
  border-color: var(--color-accent-dim);
}

.import-error {
  font-size: 12px;
  color: var(--color-danger-text);
  margin: 0;
}

/* ── Landing Art Toggle ────────────────────────────────────────── */
.art-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-surface);
  cursor: pointer;
  transition: background 100ms ease;
}

.art-toggle:hover {
  background: var(--color-state-hover);
}

.art-toggle-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  user-select: none;
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
</style>
