<script setup lang="ts">
import { Globe, Loader, Search, Shield, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import ProviderCard from './ProviderCard.vue'

const s = useSettingsStore()
const { tavily, duckduckgo, exa, brave, serper, webSearchProvider } = storeToRefs(s)

const autoTestTimers = new Map<string, ReturnType<typeof window.setTimeout>>()

function clearAutoTest(key: string) {
  const timer = autoTestTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    autoTestTimers.delete(key)
  }
}

function scheduleAutoTest(key: string, task: () => Promise<void>) {
  clearAutoTest(key)
  autoTestTimers.set(key, window.setTimeout(() => {
    autoTestTimers.delete(key)
    void task()
  }, 700))
}

function toggleProvider(provider: 'duckduckgo' | 'tavily' | 'exa' | 'brave' | 'serper') {
  webSearchProvider.value = provider
}

watch(() => tavily.value.apiKey, apiKey => {
  s.resetTavilyStatus()
  clearAutoTest('tavily')
  if (apiKey.trim())
    scheduleAutoTest('tavily', () => s.testTavily())
})

watch(() => exa.value.apiKey, apiKey => {
  s.resetExaStatus()
  clearAutoTest('exa')
  if (apiKey.trim())
    scheduleAutoTest('exa', () => s.testExa())
})

watch(() => brave.value.apiKey, apiKey => {
  s.resetBraveStatus()
  clearAutoTest('brave')
  if (apiKey.trim())
    scheduleAutoTest('brave', () => s.testBrave())
})

watch(() => serper.value.apiKey, apiKey => {
  s.resetSerperStatus()
  clearAutoTest('serper')
  if (apiKey.trim())
    scheduleAutoTest('serper', () => s.testSerper())
})
</script>

<template>
  <ProviderCard
    name="DuckDuckGo Search"
    url="html.duckduckgo.com — web_search tool"
    :status="duckduckgo.status"
    :status-message="duckduckgo.statusMessage"
    logo-class="duckduckgo-logo"
  >
    <template #logo>
      <Globe :size="18" :stroke-width="1.5" />
    </template>
    <template #actions>
      <button
        class="custom-toggle"
        :class="{ 'custom-toggle--on': webSearchProvider === 'duckduckgo' }"
        :aria-label="webSearchProvider === 'duckduckgo' ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
        @click="toggleProvider('duckduckgo')"
      >
        <span class="custom-toggle-thumb" />
      </button>
    </template>
    <template #fields>
      <span class="field-hint">Free, no API key required. Uses the DuckDuckGo HTML search endpoint via Rust backend.</span>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="duckduckgo.status === 'testing'" @click="s.testDuckDuckGo()">
        <Loader v-if="duckduckgo.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Test Connection
      </button>
    </template>
  </ProviderCard>

  <ProviderCard
    name="Tavily Search"
    url="api.tavily.com — web_search tool"
    :status="tavily.status"
    :status-message="tavily.statusMessage"
    logo-class="tavily-logo"
  >
    <template #logo>
      <Zap :size="18" :stroke-width="1.5" />
    </template>
    <template #actions>
      <button
        class="custom-toggle"
        :class="{ 'custom-toggle--on': webSearchProvider === 'tavily' }"
        :aria-label="webSearchProvider === 'tavily' ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
        @click="toggleProvider('tavily')"
      >
        <span class="custom-toggle-thumb" />
      </button>
    </template>
    <template #fields>
      <div class="tavily-key-field">
        <label for="tavily-api-key" class="field-label">API Key</label>
        <div class="key-input-row">
          <input
            id="tavily-api-key"
            v-model="tavily.apiKey"
            type="password"
            placeholder="tvly-..."
            spellcheck="false"
            autocomplete="off"
            class="key-input"
          >
        </div>
        <span class="field-hint">
          Get a free key at
          <a href="https://app.tavily.com" target="_blank" rel="noopener">app.tavily.com</a>
          — 1,000 requests/month free
        </span>
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="tavily.status === 'testing' || !tavily.apiKey.trim()" @click="s.testTavily()">
        <Loader v-if="tavily.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Test Connection
      </button>
    </template>
  </ProviderCard>

  <ProviderCard
    name="Exa Search"
    url="api.exa.ai — web_search tool"
    :status="exa.status"
    :status-message="exa.statusMessage"
    logo-class="exa-logo"
  >
    <template #logo>
      <Search :size="18" :stroke-width="1.5" />
    </template>
    <template #actions>
      <button
        class="custom-toggle"
        :class="{ 'custom-toggle--on': webSearchProvider === 'exa' }"
        :aria-label="webSearchProvider === 'exa' ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
        @click="toggleProvider('exa')"
      >
        <span class="custom-toggle-thumb" />
      </button>
    </template>
    <template #fields>
      <div class="tavily-key-field">
        <label for="exa-api-key" class="field-label">API Key</label>
        <div class="key-input-row">
          <input
            id="exa-api-key"
            v-model="exa.apiKey"
            type="password"
            placeholder="exa-..."
            spellcheck="false"
            autocomplete="off"
            class="key-input"
          >
        </div>
        <span class="field-hint">
          Get a free key at
          <a href="https://exa.ai" target="_blank" rel="noopener">exa.ai</a>
          — 1,000 requests/month free. Semantic search with fast response times.
        </span>
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="exa.status === 'testing' || !exa.apiKey.trim()" @click="s.testExa()">
        <Loader v-if="exa.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Test Connection
      </button>
    </template>
  </ProviderCard>

  <ProviderCard
    name="Brave Search"
    url="api.search.brave.com — web_search tool"
    :status="brave.status"
    :status-message="brave.statusMessage"
    logo-class="brave-logo"
  >
    <template #logo>
      <Shield :size="18" :stroke-width="1.5" />
    </template>
    <template #actions>
      <button
        class="custom-toggle"
        :class="{ 'custom-toggle--on': webSearchProvider === 'brave' }"
        :aria-label="webSearchProvider === 'brave' ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
        @click="toggleProvider('brave')"
      >
        <span class="custom-toggle-thumb" />
      </button>
    </template>
    <template #fields>
      <div class="tavily-key-field">
        <label for="brave-api-key" class="field-label">API Key</label>
        <div class="key-input-row">
          <input
            id="brave-api-key"
            v-model="brave.apiKey"
            type="password"
            placeholder="BSA..."
            spellcheck="false"
            autocomplete="off"
            class="key-input"
          >
        </div>
        <span class="field-hint">
          Get a free key at
          <a href="https://brave.com/search/api/" target="_blank" rel="noopener">brave.com/search/api</a>
          — $5 free credit/month. Independent search index with no tracking.
        </span>
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="brave.status === 'testing' || !brave.apiKey.trim()" @click="s.testBrave()">
        <Loader v-if="brave.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Test Connection
      </button>
    </template>
  </ProviderCard>

  <ProviderCard
    name="Serper (Google)"
    url="google.serper.dev — web_search tool"
    :status="serper.status"
    :status-message="serper.statusMessage"
    logo-class="serper-logo"
  >
    <template #logo>
      <Globe :size="18" :stroke-width="1.5" />
    </template>
    <template #actions>
      <button
        class="custom-toggle"
        :class="{ 'custom-toggle--on': webSearchProvider === 'serper' }"
        :aria-label="webSearchProvider === 'serper' ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
        @click="toggleProvider('serper')"
      >
        <span class="custom-toggle-thumb" />
      </button>
    </template>
    <template #fields>
      <div class="tavily-key-field">
        <label for="serper-api-key" class="field-label">API Key</label>
        <div class="key-input-row">
          <input
            id="serper-api-key"
            v-model="serper.apiKey"
            type="password"
            placeholder="..."
            spellcheck="false"
            autocomplete="off"
            class="key-input"
          >
        </div>
        <span class="field-hint">
          Get a free key at
          <a href="https://serper.dev" target="_blank" rel="noopener">serper.dev</a>
          — 2,500 free queries. Google SERP data with fast response times.
        </span>
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="serper.status === 'testing' || !serper.apiKey.trim()" @click="s.testSerper()">
        <Loader v-if="serper.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Test Connection
      </button>
    </template>
  </ProviderCard>
</template>

<style scoped>
.custom-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 38px;
  height: 22px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
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

.field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.key-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.key-input {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease;
}

.key-input:focus {
  border-color: var(--color-accent);
}

.field-hint {
  display: block;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  margin-top: 6px;
  line-height: 1.5;
}

.field-hint a {
  color: var(--color-accent);
  text-decoration: none;
}

.field-hint a:hover {
  text-decoration: underline;
}

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.test-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
