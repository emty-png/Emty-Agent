<script setup lang="ts">
import type { DiscoveredModel } from '@/stores/settings/types'
import { Brain, Code, Eye, Info, Loader, Search, Wrench, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const s = useSettingsStore()

const {
  openai,
  anthropic,
  google,
  compatibleProviders,
  discoveredModels,
} = storeToRefs(s)

const modelSearch = ref('')

const filteredModels = computed(() => {
  const q = modelSearch.value.toLowerCase().trim()
  return q
    ? discoveredModels.value.filter(model =>
        model.name.toLowerCase().includes(q)
        || model.id.toLowerCase().includes(q)
        || model.providerName.toLowerCase().includes(q),
      )
    : discoveredModels.value
})

const modelGroups = computed(() => {
  const groups = new Map<string, { providerName: string; models: typeof filteredModels.value }>()
  for (const model of filteredModels.value) {
    if (!groups.has(model.providerId))
      groups.set(model.providerId, { providerName: model.providerName, models: [] })
    groups.get(model.providerId)!.models.push(model)
  }
  return [...groups.entries()].map(([id, group]) => ({ providerId: id, ...group }))
})

async function refreshAllModels() {
  const tasks: Promise<void>[] = []
  if (openai.value.apiKey)
    tasks.push(s.testOpenAI())
  if (anthropic.value.apiKey)
    tasks.push(s.testAnthropic())
  if (google.value.apiKey)
    tasks.push(s.testGoogle())
  for (const provider of compatibleProviders.value) {
    if (provider.baseURL)
      tasks.push(s.testProvider(provider.id))
  }
  await Promise.allSettled(tasks)
}

function formatContext(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)
    return `${Math.round(n / 1000)}K`
  return String(n)
}

// For the tooltip specific formatting (e.g., 262,144)
function formatExact(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function formatPrice(price: number | null): string {
  if (price === null)
    return '?'
  if (price === 0)
    return 'Free'
  if (price >= 1)
    return `$${price.toFixed(2)}`
  if (price >= 0.1)
    return `$${price.toFixed(3)}`
  return `$${price.toFixed(4)}`
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    return value
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getCapabilitiesText(m: DiscoveredModel): string {
  const caps = []
  if (m.supportsThinking)
    caps.push('reasoning')
  if (m.supportsToolCalls)
    caps.push('tools')
  if (m.supportsAttachments)
    caps.push('vision')
  if (m.supportsStructuredOutput)
    caps.push('structured output')
  return caps.join(', ')
}

function shouldShowEffort(model: DiscoveredModel): boolean {
  if (!model.supportsThinking)
    return false

  const id = model.id.toLowerCase()
  if (model.providerId === 'anthropic') {
    const useAdaptive = /claude-opus-4-[7-9]|claude-opus-4-\d{2,}|claude-opus-4-6|claude-sonnet-4-6/.test(id)
    if (useAdaptive)
      return false
    return true
  }

  if (model.providerId === 'google') {
    return false
  }

  const pName = model.providerName.toLowerCase()
  const isOllama = model.providerId === 'compatible'
    && (model.mdevProviderId === 'ollama' || pName === 'ollama' || pName.includes('ollama'))
  if (isOllama && !id.includes('gpt-oss')) {
    return false
  }

  return true
}

function getEffortLabel(model: DiscoveredModel, lvl: 'low' | 'medium' | 'high'): string {
  if (model.providerId === 'anthropic') {
    return lvl === 'low' ? '2K' : lvl === 'medium' ? '10K' : '32K'
  }
  if (model.providerId === 'openai') {
    return lvl === 'low' ? 'Low' : lvl === 'medium' ? 'Medium' : 'High'
  }
  return lvl === 'low' ? 'Low' : lvl === 'medium' ? 'Med' : 'High'
}
</script>

<template>
  <section class="content-section">
    <div class="models-header">
      <h2 class="section-title">
        Models
      </h2>
      <button class="ghost-btn" @click="refreshAllModels">
        <Loader :size="13" :stroke-width="2" class="spin-on-active" />
        <span>Refresh</span>
      </button>
    </div>

    <div class="search-wrap">
      <Search :size="14" :stroke-width="2" class="search-icon" />
      <input v-model="modelSearch" class="search-input" placeholder="Search models...">
    </div>

    <div v-if="discoveredModels.length === 0" class="models-empty">
      <div class="empty-icon-wrap">
        <Zap :size="20" :stroke-width="1.5" />
      </div>
      <h3 class="empty-title">
        No models discovered
      </h3>
      <p class="empty-sub">
        Add a provider key in <strong>Providers</strong> and the text-output models will appear here automatically.
      </p>
    </div>

    <div v-else-if="modelGroups.length === 0" class="models-empty">
      <p class="empty-sub">
        No models match "{{ modelSearch }}"
      </p>
    </div>

    <div v-else class="model-groups-container">
      <div v-for="group in modelGroups" :key="group.providerId" class="model-group">
        <div class="model-group-header">
          <span class="group-name">{{ group.providerName }}</span>
          <span class="group-stats">{{ group.models.filter(m => m.enabled).length }}/{{ group.models.length }} enabled</span>
        </div>

        <div class="model-list">
          <div
            v-for="model in group.models"
            :key="model.uid"
            class="model-card"
            :class="{ 'model-card--disabled': !model.enabled }"
          >
            <!-- LEFT: Core Info & Icons -->
            <div class="model-main">
              <!-- Info Trigger & Custom Tooltip -->
              <div class="tt-trigger">
                <Info :size="14" class="info-icon" />
                <div class="tt-panel">
                  <div class="tt-header">
                    {{ model.name }}
                  </div>

                  <!-- Main Tooltip Content matching the image -->
                  <div v-if="model.inputModalities?.length" class="tt-line">
                    Allows: {{ model.inputModalities.join(', ') }}
                  </div>
                  <div v-if="getCapabilitiesText(model)" class="tt-line">
                    Allows {{ getCapabilitiesText(model) }}
                  </div>
                  <div v-if="model.contextLimit" class="tt-line">
                    Context limit {{ formatExact(model.contextLimit) }}
                  </div>

                  <!-- Extra Meta appended quietly below -->
                  <div v-if="model.family || model.costInput !== null || model.releaseDate" class="tt-meta-divider" />
                  <div class="tt-meta-grid">
                    <span v-if="model.family" class="tt-meta-label">Family:</span>
                    <span v-if="model.family" class="tt-meta-value">{{ model.family }}</span>

                    <span v-if="model.costInput !== null" class="tt-meta-label">Cost / 1M:</span>
                    <span v-if="model.costInput !== null" class="tt-meta-value">{{ formatPrice(model.costInput) }} in / {{ formatPrice(model.costOutput) }} out</span>

                    <span v-if="model.releaseDate" class="tt-meta-label">Released:</span>
                    <span v-if="model.releaseDate" class="tt-meta-value">{{ formatDate(model.releaseDate) }}</span>

                    <span v-if="model.mdevProviderId" class="tt-meta-label">Catalog:</span>
                    <span v-if="model.mdevProviderId" class="tt-meta-value">{{ model.mdevProviderId }}</span>
                  </div>
                </div>
              </div>

              <h3 class="model-name">
                {{ model.name }}
              </h3>
              <span class="model-id">{{ model.id }}</span>

              <!-- Capability icon pills with tooltips (like picker) -->
              <div class="picker-caps">
                <span v-if="model.supportsThinking" class="cap-icon-wrap" data-tooltip="Reasoning">
                  <Brain :size="13" :stroke-width="2" class="cap-icon cap-icon--thinking" />
                </span>
                <span v-if="model.supportsToolCalls" class="cap-icon-wrap" data-tooltip="Tools">
                  <Wrench :size="13" :stroke-width="2" class="cap-icon cap-icon--tools" />
                </span>
                <span v-if="model.supportsAttachments" class="cap-icon-wrap" data-tooltip="Vision">
                  <Eye :size="13" :stroke-width="2" class="cap-icon cap-icon--vision" />
                </span>
                <span v-if="model.supportsStructuredOutput" class="cap-icon-wrap" data-tooltip="Structured">
                  <Code :size="13" :stroke-width="2" class="cap-icon cap-icon--structured" />
                </span>
                <span v-if="model.contextLimit" class="cap-badge cap-badge--ctx">{{ formatContext(model.contextLimit) }} ctx</span>
                <span v-if="model.status" class="cap-badge cap-badge--status">{{ model.status }}</span>
              </div>
            </div>

            <!-- RIGHT: Controls -->
            <div class="model-controls">
              <div v-if="model.enabled && shouldShowEffort(model)" class="effort-seg">
                <button
                  v-for="lvl in (['low', 'medium', 'high'] as const)"
                  :key="lvl"
                  class="effort-btn"
                  :class="{ 'effort-btn--active': model.thinkingEffort === lvl }"
                  @click="s.setModelThinking(model.uid, lvl)"
                >
                  {{ getEffortLabel(model, lvl) }}
                </button>
              </div>
              <button
                class="custom-toggle"
                :class="{ 'custom-toggle--on': model.enabled }"
                :aria-label="model.enabled ? 'Disable model' : 'Enable model'"
                @click="s.toggleModel(model.uid)"
              >
                <span class="custom-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  -webkit-font-smoothing: antialiased;
  color: var(--color-text-primary, #f2f2f2);
}

.section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ghost-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-inline: 10px;
  border: 1px solid var(--color-border-mid, #2e2e2e);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary, #cccccc);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ghost-btn:hover {
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  color: var(--color-text-primary, #f2f2f2);
}

/* Search */
.search-wrap {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary, #8a8a8a);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 36px;
  padding-left: 36px;
  padding-right: 12px;
  background: var(--color-bg-elevated, #262626);
  border: 1px solid var(--color-border-subtle, #1a1a1a);
  border-radius: var(--radius-md);
  color: var(--color-text-primary, #f2f2f2);
  font-size: 13px;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.search-input::placeholder {
  color: var(--color-text-tertiary, #8a8a8a);
}

.search-input:focus {
  border-color: var(--color-accent, #00e5ff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent, #00e5ff) 15%, transparent);
}

/* Empty States */
.models-empty {
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: var(--color-bg-surface, #0a0a0a);
  border: 1px dashed var(--color-border-mid, #2e2e2e);
  border-radius: var(--radius-lg);
}

.empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  color: var(--color-text-tertiary, #8a8a8a);
  margin-bottom: 12px;
}

.empty-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #f2f2f2);
}
.empty-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary, #cccccc);
  max-width: 380px;
  line-height: 1.5;
}

/* Model Groups */
.model-groups-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-group {
  background: var(--color-bg-surface, #0a0a0a);
  border: 1px solid var(--color-border-subtle, #1a1a1a);
  border-radius: var(--radius-lg);
  /* Removed overflow: hidden so tooltips don't clip */
}

.model-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-subtle, #1a1a1a);
  background: color-mix(in srgb, var(--color-text-primary) 1.2%, transparent);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.group-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #8a8a8a);
}

.group-stats {
  font-size: 11px;
  color: var(--color-text-dim, #595959);
}

.model-list {
  display: flex;
  flex-direction: column;
}

/* Model Row */
.model-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-subtle, #1a1a1a);
  transition: background 0.12s ease;
}

.model-card:last-child {
  border-bottom: none;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.model-card:hover {
  background: color-mix(in srgb, var(--color-text-primary) 1.5%, transparent);
}
.model-card--disabled {
  opacity: 0.55;
  filter: grayscale(40%);
}

.model-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

/* Custom Tooltip Setup matching image */
.tt-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
}

.info-icon {
  color: var(--color-text-tertiary, #8a8a8a);
  transition: color 0.15s;
}

.tt-trigger:hover .info-icon {
  color: var(--color-text-primary, #f2f2f2);
}

.tt-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: -4px;
  width: max-content;
  max-width: 300px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  box-shadow: var(--color-shadow-lg);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.tt-trigger:hover .tt-panel {
  opacity: 1;
  transform: translateY(0);
}

.tt-header {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.tt-line {
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.tt-meta-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 0;
}

.tt-meta-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 8px;
  row-gap: 4px;
  font-size: 11px;
  line-height: 1.4;
}

.tt-meta-label {
  color: var(--color-text-dim);
}
.tt-meta-value {
  color: var(--color-text-tertiary);
}

/* Title & ID */
.model-name {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary, #f2f2f2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.model-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: var(--color-text-dim, #595959);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

/* Icons (Picker style) */
.picker-caps {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.cap-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  line-height: 1.4;
  white-space: nowrap;
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-mid);
}

.cap-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  cursor: default;
  transition: background 0.1s ease;
}

.cap-icon-wrap:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}

/* Picker-like CSS tooltips for icons */
.cap-icon-wrap::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  white-space: nowrap;
  background: var(--color-bg-elevated, #262626);
  border: 1px solid var(--color-border-mid, #2e2e2e);
  color: var(--color-text-primary, #f2f2f2);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  box-shadow: var(--color-shadow-md);
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 0.15s,
    transform 0.15s;
  z-index: 10;
}

.cap-icon-wrap:hover::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.cap-icon {
  display: block;
}
.cap-icon--thinking {
  color: color-mix(in srgb, var(--color-accent) 70%, var(--color-text-primary));
}
.cap-icon--tools {
  color: color-mix(in srgb, var(--color-success) 70%, var(--color-text-primary));
}
.cap-icon--vision {
  color: color-mix(in srgb, var(--color-info) 70%, var(--color-text-primary));
}
.cap-icon--structured {
  color: color-mix(in srgb, var(--color-warning) 70%, var(--color-text-primary));
}

/* Controls (Right) */
.model-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.effort-seg {
  display: flex;
  border: 1px solid var(--color-border-mid, #2e2e2e);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.effort-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary, #8a8a8a);
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}

.effort-btn:not(:last-child) {
  border-right: 1px solid var(--color-border-mid, #2e2e2e);
}
.effort-btn:hover {
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  color: var(--color-text-secondary, #cccccc);
}
.effort-btn--active {
  background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  color: var(--color-accent-text);
  font-weight: 600;
}

.custom-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 38px;
  height: 22px;
  border-radius: 99px;
  border: 1px solid var(--color-border-mid, #2e2e2e);
  background: var(--color-bg-elevated, #262626);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0;
  flex-shrink: 0;
}

.custom-toggle--on {
  background: var(--color-success);
  border-color: var(--color-success);
}

.custom-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-text-dim);
  transition:
    transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.18s;
  box-shadow: var(--color-shadow-sm);
}

.custom-toggle--on .custom-toggle-thumb {
  transform: translateX(16px);
  background: var(--color-text-primary);
}

@media (max-width: 640px) {
  .model-card {
    flex-wrap: wrap;
  }
  .model-controls {
    margin-left: auto;
    width: 100%;
    justify-content: flex-end;
  }
  .model-id {
    display: none;
  }
}
</style>
