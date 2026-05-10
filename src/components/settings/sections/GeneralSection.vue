<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const s = useSettingsStore()
const { contextCaching, autoContext } = storeToRefs(s)
</script>

<template>
  <section class="content-section">
    <h2 class="section-title">
      General
    </h2>

    <!-- Core Settings Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Core Settings
        </h3>
      </div>
      <div class="settings-list">
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Auto project context</span>
            <span class="settings-item-desc">Load AGENTS.md and DESIGN.md from project root automatically</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': autoContext.enabled }"
            type="button"
            :aria-pressed="autoContext.enabled"
            @click="autoContext.enabled = !autoContext.enabled"
          ><span class="model-toggle-thumb" /></button>
        </label>
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Context caching</span>
            <span class="settings-item-desc">Cache reusable prompt segments to reduce latency and cost</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': contextCaching.enabled }"
            type="button"
            :aria-pressed="contextCaching.enabled"
            @click="contextCaching.enabled = !contextCaching.enabled"
          ><span class="model-toggle-thumb" /></button>
        </label>
      </div>
    </div>

    <!-- Cache Settings Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Cache Configuration
        </h3>
      </div>
      <div class="settings-list">
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Anthropic cache TTL</span>
            <span class="settings-item-desc">How long Claude prompt cache breakpoints are retained</span>
          </div>
          <select v-model="contextCaching.anthropicTtl" class="settings-select">
            <option value="5m">
              5 minutes
            </option>
            <option value="1h">
              1 hour
            </option>
          </select>
        </div>
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">OpenAI cache retention</span>
            <span class="settings-item-desc">Extended 24h only applies to models that support it</span>
          </div>
          <select v-model="contextCaching.openaiPromptCacheRetention" class="settings-select">
            <option value="in_memory">
              In-memory
            </option>
            <option value="24h">
              Extended 24h
            </option>
          </select>
        </div>
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Gemini cached content</span>
            <span class="settings-item-desc">Paste an existing cached-content name to reuse it on requests</span>
          </div>
          <input
            v-model="contextCaching.googleCachedContent"
            type="text"
            class="settings-input"
            placeholder="cachedContents/"
            autocomplete="off"
            spellcheck="false"
          >
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Scoped styles will be inherited from the parent or copied if needed.
   For now, we will copy the exact scoped styles required for this section
   to maintain encapsulation as requested (Option A). */

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

.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

.settings-card-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.settings-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

.settings-list {
  display: flex;
  flex-direction: column;
}

.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 100ms ease;
}

.settings-item:last-child {
  border-bottom: none;
}

.settings-item:hover {
  background: var(--color-bg-hover);
}

.settings-item--field {
  cursor: default;
}

.settings-item--field:hover {
  background: transparent;
}

.settings-item-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.settings-item-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
}

.settings-item-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.settings-select {
  height: 32px;
  padding-inline: 12px 8px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  transition: border-color 130ms ease;
  flex-shrink: 0;
  min-width: 140px;
}

.settings-select:focus {
  border-color: var(--color-accent-dim);
}

.settings-input {
  height: 32px;
  padding-inline: 12px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 130ms ease;
  flex-shrink: 0;
  width: 180px;
}

.settings-input::placeholder {
  color: var(--color-text-dim);
}

.settings-input:focus {
  border-color: var(--color-accent-dim);
}

.model-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 34px;
  height: 20px;
  border-radius: 99px;
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
  flex-shrink: 0;
}

.model-toggle--on {
  background: var(--color-accent-dim);
  border-color: var(--color-accent);
}

.model-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  transition:
    transform 140ms cubic-bezier(0.4, 0, 0.2, 1),
    background 140ms ease;
}

.model-toggle--on .model-toggle-thumb {
  transform: translateX(14px);
  background: #fff;
}
</style>
