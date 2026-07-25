<script setup lang="ts">
import type { SttProvider } from '@/stores/settings/voiceTypes'
import { Loader, Mic, Zap } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

defineEmits<{ next: [] }>()

const s = useSettingsStore()

interface SttDef {
  id: SttProvider
  name: string
  url: string
  keyPlaceholder: string
  hintHtml: string
  needsBaseUrl?: boolean
}

const sttProviders: SttDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'api.openai.com',
    keyPlaceholder: 'sk-...',
    hintHtml: 'Whisper / gpt-4o-transcribe. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noopener" style="color: var(--color-info-text)">platform.openai.com</a>.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    url: 'api.deepgram.com',
    keyPlaceholder: 'dg...',
    hintHtml: 'Nova-3 model. Get a key at <a href="https://console.deepgram.com/signup" target="_blank" rel="noopener" style="color: var(--color-info-text)">console.deepgram.com</a>. $200 free credit.',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    url: 'api.assemblyai.com',
    keyPlaceholder: '...',
    hintHtml: 'Universal-3.5 model. Get a key at <a href="https://www.assemblyai.com/dashboard" target="_blank" rel="noopener" style="color: var(--color-info-text)">assemblyai.com</a>.',
  },
  {
    id: 'google',
    name: 'Google Cloud',
    url: 'speech.googleapis.com',
    keyPlaceholder: 'AIza...',
    hintHtml: 'Speech-to-Text API. Get a key at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style="color: var(--color-info-text)">console.cloud.google.com</a>.',
  },
  {
    id: 'azure',
    name: 'Azure Speech',
    url: 'cognitiveservices.azure.com',
    keyPlaceholder: '...',
    hintHtml: 'Azure Cognitive Services Speech. Get a key at <a href="https://portal.azure.com" target="_blank" rel="noopener" style="color: var(--color-info-text)">portal.azure.com</a>.',
  },
  {
    id: 'custom',
    name: 'Custom',
    url: 'custom endpoint',
    keyPlaceholder: '...',
    needsBaseUrl: true,
    hintHtml: 'Any OpenAI-compatible speech-to-text endpoint.',
  },
]

const selectedProvider = ref<SttProvider>(s.sttProvider)
const showKey = ref(false)

const currentDef = computed(() => sttProviders.find(p => p.id === selectedProvider.value)!)

const config = computed(() => s.stt[selectedProvider.value])

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

watch(() => [config.value.apiKey, config.value.baseUrl] as const, ([apiKey]) => {
  s.resetSttStatus(selectedProvider.value)
  clearAutoTest(`stt-${selectedProvider.value}`)
  if (apiKey.trim() || selectedProvider.value === 'custom')
    scheduleAutoTest(`stt-${selectedProvider.value}`, () => s.testSttProvider(selectedProvider.value))
})

function selectProvider(id: SttProvider) {
  selectedProvider.value = id
  s.setSttProvider(id)
  showKey.value = false
}
</script>

<template>
  <div class="step-stt">
    <div class="step-header">
      <h2 class="step-title">
        Speech-to-Text
      </h2>
      <p class="step-desc">
        Configure voice input (optional)
      </p>
    </div>

    <div class="stt-body">
      <!-- Provider selector -->
      <div class="provider-grid">
        <button
          v-for="prov in sttProviders"
          :key="prov.id"
          class="provider-card"
          :class="{ active: selectedProvider === prov.id }"
          @click="selectProvider(prov.id)"
        >
          <Mic :size="16" :stroke-width="1.8" />
          <span class="provider-card-name">{{ prov.name }}</span>
        </button>
      </div>

      <!-- Config form for selected provider -->
      <div class="config-form">
        <div class="form-row">
          <label class="form-label">API Key <span v-if="!currentDef.needsBaseUrl" class="form-required">*</span></label>
          <div class="key-input-wrap">
            <input
              :type="showKey ? 'text' : 'password'"
              :value="config.apiKey"
              class="form-input"
              :placeholder="currentDef.keyPlaceholder"
              autocomplete="off"
              spellcheck="false"
              @input="s.stt[selectedProvider].apiKey = ($event.target as HTMLInputElement).value"
            >
            <button class="key-toggle" @click="showKey = !showKey">
              {{ showKey ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>

        <div v-if="currentDef.needsBaseUrl" class="form-row">
          <label class="form-label">Base URL <span class="form-required">*</span></label>
          <input
            type="text"
            :value="config.baseUrl"
            class="form-input"
            placeholder="https://your-endpoint.com/v1"
            autocomplete="off"
            @input="s.stt[selectedProvider].baseUrl = ($event.target as HTMLInputElement).value"
          >
        </div>

        <div class="form-row">
          <label class="form-label">Model</label>
          <input
            type="text"
            :value="config.model"
            class="form-input"
            autocomplete="off"
            @input="s.stt[selectedProvider].model = ($event.target as HTMLInputElement).value"
          >
        </div>

        <div class="form-row">
          <label class="form-label">Language</label>
          <input
            type="text"
            :value="config.language"
            class="form-input"
            placeholder="en"
            autocomplete="off"
            @input="s.stt[selectedProvider].language = ($event.target as HTMLInputElement).value"
          >
        </div>

        <div class="form-row">
          <span class="form-hint" v-html="currentDef.hintHtml" />
        </div>

        <!-- Status message -->
        <div v-if="config.statusMessage" class="status-msg" :class="`status-${config.status}`">
          {{ config.statusMessage }}
        </div>

        <!-- Test button -->
        <button
          class="test-btn"
          :disabled="config.status === 'testing' || (!config.apiKey.trim() && selectedProvider !== 'custom') || (selectedProvider === 'custom' && !config.baseUrl.trim())"
          @click="s.testSttProvider(selectedProvider)"
        >
          <Loader v-if="config.status === 'testing'" :size="14" class="spin" />
          <Zap v-else :size="14" :stroke-width="2" />
          Test Connection
        </button>
      </div>
    </div>

    <div class="step-actions">
      <button class="step-btn-secondary" @click="$emit('next')">
        Skip
      </button>
      <button class="step-btn" @click="$emit('next')">
        Next
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-stt {
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

.stt-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
}

.provider-card:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}

.provider-card.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
}

.provider-card-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-required {
  color: var(--color-danger-text);
}

.form-input {
  height: 34px;
  padding: 0 12px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: all 150ms ease;
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-bg-base) 2%, transparent);
}

.form-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.form-input::placeholder {
  color: var(--color-text-tertiary);
}

.key-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.key-input-wrap .form-input {
  flex: 1;
  padding-right: 60px;
}

.key-toggle {
  position: absolute;
  right: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.key-toggle:hover {
  background: var(--color-border-mid);
  color: var(--color-text-primary);
}

.form-hint {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}

.status-msg {
  font-size: 12.5px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
}

.status-msg.status-ok {
  color: var(--color-success-text);
  background: color-mix(in srgb, var(--color-success-muted) 20%, transparent);
}

.status-msg.status-error {
  color: var(--color-danger-text);
  background: color-mix(in srgb, var(--color-danger-muted) 20%, transparent);
}

.status-msg.status-testing {
  color: var(--color-text-secondary);
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
  align-self: flex-start;
}

.test-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.step-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
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

.step-btn-secondary {
  height: 36px;
  padding: 0 24px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
}

.step-btn-secondary:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-border-strong);
}

@media (max-width: 600px) {
  .provider-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
