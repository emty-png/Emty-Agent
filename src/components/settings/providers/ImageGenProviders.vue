<script setup lang="ts">
import type { ImageGenProvider } from '@/stores/settings/types'
import { Globe, Loader, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import ProviderCard from './ProviderCard.vue'

const s = useSettingsStore()
const { imageGenProvider, imageGen } = storeToRefs(s)

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

function toggleProvider(provider: ImageGenProvider) {
  imageGenProvider.value = provider
}

interface ProviderDef {
  id: ImageGenProvider
  name: string
  url: string
  logoClass: string
  keyPlaceholder: string
  hintHtml: string
  needsBaseURL?: boolean
}

const providers: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'api.openai.com',
    logoClass: 'openai-logo',
    keyPlaceholder: 'sk-...',
    hintHtml: 'DALL-E 3 and GPT-Image-1. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a>.',
  },
  {
    id: 'google',
    name: 'Google',
    url: 'generativelanguage.googleapis.com',
    logoClass: 'google-logo',
    keyPlaceholder: 'AIza...',
    hintHtml: 'Imagen 4 models. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.',
  },
  {
    id: 'stability',
    name: 'Stability AI',
    url: 'api.stability.ai',
    logoClass: 'stability-logo',
    keyPlaceholder: 'sk-...',
    hintHtml: 'Stable Diffusion and SDXL models. Get a key at <a href="https://platform.stability.ai" target="_blank" rel="noopener">platform.stability.ai</a>.',
  },
  {
    id: 'fal',
    name: 'fal.ai',
    url: 'fal.run',
    logoClass: 'fal-logo',
    keyPlaceholder: 'fal-...',
    hintHtml: 'Flux, Stable Diffusion, and custom models. Get a key at <a href="https://fal.ai" target="_blank" rel="noopener">fal.ai</a>.',
  },
  {
    id: 'replicate',
    name: 'Replicate',
    url: 'api.replicate.com',
    logoClass: 'replicate-logo',
    keyPlaceholder: 'r8_...',
    hintHtml: 'Flux and SDXL models. Get a key at <a href="https://replicate.com" target="_blank" rel="noopener">replicate.com</a>.',
  },
  {
    id: 'together',
    name: 'Together AI',
    url: 'api.together.xyz',
    logoClass: 'together-logo',
    keyPlaceholder: '...',
    hintHtml: 'Flux and SDXL models. Get a key at <a href="https://together.ai" target="_blank" rel="noopener">together.ai</a>.',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    url: 'api.fireworks.ai',
    logoClass: 'fireworks-logo',
    keyPlaceholder: 'fw-...',
    hintHtml: 'Flux and Stable Diffusion models. Get a key at <a href="https://fireworks.ai" target="_blank" rel="noopener">fireworks.ai</a>.',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    url: 'custom endpoint',
    logoClass: 'custom-logo',
    keyPlaceholder: '...',
    needsBaseURL: true,
    hintHtml: 'Any OpenAI-compatible image generation endpoint.',
  },
]

watch(() => imageGen.value.openai.apiKey, apiKey => {
  s.resetImageGenStatus('openai')
  clearAutoTest('openai')
  if (apiKey.trim())
    scheduleAutoTest('openai', () => s.testImageGenProvider('openai'))
})

watch(() => imageGen.value.google.apiKey, apiKey => {
  s.resetImageGenStatus('google')
  clearAutoTest('google')
  if (apiKey.trim())
    scheduleAutoTest('google', () => s.testImageGenProvider('google'))
})

watch(() => imageGen.value.stability.apiKey, apiKey => {
  s.resetImageGenStatus('stability')
  clearAutoTest('stability')
  if (apiKey.trim())
    scheduleAutoTest('stability', () => s.testImageGenProvider('stability'))
})

watch(() => imageGen.value.fal.apiKey, apiKey => {
  s.resetImageGenStatus('fal')
  clearAutoTest('fal')
  if (apiKey.trim())
    scheduleAutoTest('fal', () => s.testImageGenProvider('fal'))
})

watch(() => imageGen.value.replicate.apiKey, apiKey => {
  s.resetImageGenStatus('replicate')
  clearAutoTest('replicate')
  if (apiKey.trim())
    scheduleAutoTest('replicate', () => s.testImageGenProvider('replicate'))
})

watch(() => imageGen.value.together.apiKey, apiKey => {
  s.resetImageGenStatus('together')
  clearAutoTest('together')
  if (apiKey.trim())
    scheduleAutoTest('together', () => s.testImageGenProvider('together'))
})

watch(() => imageGen.value.fireworks.apiKey, apiKey => {
  s.resetImageGenStatus('fireworks')
  clearAutoTest('fireworks')
  if (apiKey.trim())
    scheduleAutoTest('fireworks', () => s.testImageGenProvider('fireworks'))
})
</script>

<template>
  <div v-for="prov in providers" :key="prov.id">
    <ProviderCard
      :name="prov.name"
      :url="prov.url"
      :status="imageGen[prov.id].status"
      :status-message="imageGen[prov.id].statusMessage"
      :logo-class="prov.logoClass"
    >
      <template #logo>
        <Globe :size="18" :stroke-width="1.5" />
      </template>
      <template #actions>
        <button
          class="custom-toggle"
          :class="{ 'custom-toggle--on': imageGenProvider === prov.id }"
          :aria-label="imageGenProvider === prov.id ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
          @click="toggleProvider(prov.id)"
        >
          <span class="custom-toggle-thumb" />
        </button>
      </template>
      <template #fields>
        <div class="field-group">
          <label :for="`imggen-${prov.id}-key`" class="field-label">API Key</label>
          <div class="key-input-row">
            <input
              :id="`imggen-${prov.id}-key`"
              v-model="imageGen[prov.id].apiKey"
              type="password"
              :placeholder="prov.keyPlaceholder"
              spellcheck="false"
              autocomplete="off"
              class="key-input"
            >
          </div>
          <span class="field-hint" v-html="prov.hintHtml" />
        </div>

        <div v-if="prov.needsBaseURL" class="field-group">
          <label :for="`imggen-${prov.id}-url`" class="field-label">Base URL</label>
          <div class="key-input-row">
            <input
              :id="`imggen-${prov.id}-url`"
              v-model="imageGen[prov.id].baseURL"
              type="text"
              placeholder="https://api.example.com/v1"
              spellcheck="false"
              autocomplete="off"
              class="key-input"
            >
          </div>
        </div>

        <div v-if="imageGen[prov.id].discoveredModels.length > 0" class="field-group">
          <label :for="`imggen-${prov.id}-model`" class="field-label">Model</label>
          <select
            :id="`imggen-${prov.id}-model`"
            v-model="imageGen[prov.id].model"
            class="key-input model-select"
          >
            <option v-for="m in imageGen[prov.id].discoveredModels" :key="m.id" :value="m.id">
              {{ m.name }}
            </option>
          </select>
        </div>

        <div v-else-if="imageGen[prov.id].status === 'ok'" class="field-group">
          <label :for="`imggen-${prov.id}-model`" class="field-label">Model</label>
          <input
            :id="`imggen-${prov.id}-model`"
            v-model="imageGen[prov.id].model"
            type="text"
            placeholder="Enter model ID"
            spellcheck="false"
            autocomplete="off"
            class="key-input"
          >
        </div>
      </template>
      <template #footer>
        <button
          class="test-btn"
          :disabled="imageGen[prov.id].status === 'testing' || !imageGen[prov.id].apiKey.trim()"
          @click="s.testImageGenProvider(prov.id)"
        >
          <Loader v-if="imageGen[prov.id].status === 'testing'" :size="14" class="spin" />
          <Zap v-else :size="14" :stroke-width="2" />
          Test Connection
        </button>
      </template>
    </ProviderCard>
  </div>
</template>

<style scoped>
.field-group {
  display: flex;
  flex-direction: column;
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

.model-select {
  appearance: auto;
  font-family: inherit;
}

.field-hint {
  display: block;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  margin-top: 6px;
  line-height: 1.5;
}

.field-hint :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}

.field-hint :deep(a:hover) {
  text-decoration: underline;
}

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
