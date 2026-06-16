<script setup lang="ts">
import { Loader, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import ProviderCard from './ProviderCard.vue'

const s = useSettingsStore()
const { openai, anthropic, google } = storeToRefs(s)

const showOpenAIKey = ref(false)
const showAnthropicKey = ref(false)
const showGoogleKey = ref(false)

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

function resetProviderDiscovery(providerId: string) {
  s.removeProviderModels(providerId)
}

watch(() => [openai.value.apiKey, openai.value.baseURL] as const, ([apiKey]) => {
  s.resetOpenAIStatus()
  resetProviderDiscovery('openai')
  clearAutoTest('openai')
  if (apiKey.trim())
    scheduleAutoTest('openai', () => s.testOpenAI())
})

watch(() => [anthropic.value.apiKey, anthropic.value.baseURL] as const, ([apiKey]) => {
  s.resetAnthropicStatus()
  resetProviderDiscovery('anthropic')
  clearAutoTest('anthropic')
  if (apiKey.trim())
    scheduleAutoTest('anthropic', () => s.testAnthropic())
})

watch(() => google.value.apiKey, apiKey => {
  s.resetGoogleStatus()
  resetProviderDiscovery('google')
  clearAutoTest('google')
  if (apiKey.trim())
    scheduleAutoTest('google', () => s.testGoogle())
})
</script>

<template>
  <!-- OpenAI -->
  <ProviderCard
    name="OpenAI"
    url="api.openai.com"
    :status="openai.status"
    :status-message="openai.statusMessage"
    logo-class="openai-logo"
  >
    <template #logo>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
    </template>
    <template #fields>
      <div class="field-group">
        <label class="field-label">API Key</label>
        <div class="key-input-wrap">
          <input
            v-model="openai.apiKey"
            :type="showOpenAIKey ? 'text' : 'password'"
            class="field-input"
            placeholder="sk-"
            autocomplete="off"
            spellcheck="false"
          >
          <button
            class="key-toggle"
            :aria-label="showOpenAIKey ? 'Hide key' : 'Show key'"
            @click="showOpenAIKey = !showOpenAIKey"
          >
            {{ showOpenAIKey ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Organization ID <span class="field-optional">optional</span></label>
        <input
          v-model="openai.organizationId"
          type="text"
          class="field-input"
          placeholder="org-"
          autocomplete="off"
        >
      </div>
      <div class="field-group">
        <label class="field-label">Base URL <span class="field-optional">override for Azure / proxies</span></label>
        <input
          v-model="openai.baseURL"
          type="text"
          class="field-input"
          placeholder="https://api.openai.com/v1"
          autocomplete="off"
        >
      </div>
    </template>
    <template #footer>
      <button
        class="test-btn"
        :disabled="openai.status === 'testing' || !openai.apiKey.trim()"
        @click="s.testOpenAI()"
      >
        <Loader v-if="openai.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Save Provider
      </button>
    </template>
  </ProviderCard>

  <!-- Anthropic -->
  <ProviderCard
    name="Anthropic"
    url="api.anthropic.com"
    :status="anthropic.status"
    :status-message="anthropic.statusMessage"
    logo-class="anthropic-logo"
  >
    <template #logo>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.498-3.818h6.404l-1.474-3.64H6.95l2.82-7.214 1.403 5.072z" /></svg>
    </template>
    <template #fields>
      <div class="field-group">
        <label class="field-label">API Key</label>
        <div class="key-input-wrap">
          <input
            v-model="anthropic.apiKey"
            :type="showAnthropicKey ? 'text' : 'password'"
            class="field-input"
            placeholder="sk-ant-"
            autocomplete="off"
            spellcheck="false"
          >
          <button class="key-toggle" @click="showAnthropicKey = !showAnthropicKey">
            {{ showAnthropicKey ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Base URL <span class="field-optional">override for proxies / Bedrock</span></label>
        <input v-model="anthropic.baseURL" type="text" class="field-input" placeholder="https://api.anthropic.com/v1" autocomplete="off">
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="anthropic.status === 'testing' || !anthropic.apiKey.trim()" @click="s.testAnthropic()">
        <Loader v-if="anthropic.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Save Provider
      </button>
    </template>
  </ProviderCard>

  <!-- Google Gemini -->
  <ProviderCard
    name="Google Gemini"
    url="generativelanguage.googleapis.com"
    :status="google.status"
    :status-message="google.statusMessage"
    logo-class="google-logo"
  >
    <template #logo>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="var(--color-google-blue)" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="var(--color-google-green)" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="var(--color-google-yellow)" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="var(--color-google-red)" />
      </svg>
    </template>
    <template #fields>
      <div class="field-group">
        <label class="field-label">API Key <span class="field-optional">from Google AI Studio</span></label>
        <div class="key-input-wrap">
          <input
            v-model="google.apiKey"
            :type="showGoogleKey ? 'text' : 'password'"
            class="field-input"
            placeholder="AIza"
            autocomplete="off"
            spellcheck="false"
          >
          <button class="key-toggle" @click="showGoogleKey = !showGoogleKey">
            {{ showGoogleKey ? 'Hide' : 'Show' }}
          </button>
        </div>
        <span class="field-hint">Get a free key at <a class="field-link" href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a></span>
      </div>
    </template>
    <template #footer>
      <button class="test-btn" :disabled="google.status === 'testing' || !google.apiKey.trim()" @click="s.testGoogle()">
        <Loader v-if="google.status === 'testing'" :size="14" class="spin" />
        <Zap v-else :size="14" :stroke-width="2" />
        Save Provider
      </button>
    </template>
  </ProviderCard>
</template>

<style scoped>
.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.field-optional {
  font-weight: 400;
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-left: 6px;
}

.field-input {
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

.field-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.field-input::placeholder {
  color: var(--color-text-tertiary);
}

.key-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.key-input-wrap .field-input {
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

.field-hint {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.field-link {
  color: var(--color-info-text);
  text-decoration: none;
  transition: color 120ms ease;
}

.field-link:hover {
  color: var(--color-info);
  text-decoration: underline;
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
  cursor: pointer;
  white-space: nowrap;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
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
</style>
