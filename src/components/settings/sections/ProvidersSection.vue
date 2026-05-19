<script setup lang="ts">
import type { CompatibleProvider } from '@/stores/settings'
import {
  Loader,
  Plus,
  Puzzle,
  Trash2,
  Zap,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onUnmounted, ref, watch } from 'vue'
import { PROVIDER_PRESETS, useSettingsStore } from '@/stores/settings'
import { PRESET_MDEV_IDS, providerIconUrl } from '@/utils/modelsdev'
import ProviderCard from '../ProviderCard.vue'

const s = useSettingsStore()
const {
  openai,
  anthropic,
  google,
  tavily,
  compatibleProviders,
} = storeToRefs(s)

//  add provider form
const showAddForm = ref(false)
const newName = ref('')
const newBaseURL = ref('')
const newApiKey = ref('')
const addError = ref('')

function submitAdd() {
  if (!newName.value.trim()) {
    addError.value = 'Name is required'
    return
  }
  if (!newBaseURL.value.trim()) {
    addError.value = 'Base URL is required'
    return
  }
  const name = newName.value.trim()
  const mdevId = PRESET_MDEV_IDS[name] ?? name.toLowerCase().replace(/\s+/g, '')
  const providerId = s.addProvider({ name, baseURL: newBaseURL.value.trim(), apiKey: newApiKey.value.trim(), mdevId })
  newName.value = ''
  newBaseURL.value = ''
  newApiKey.value = ''
  addError.value = ''
  showAddForm.value = false
  scheduleAutoTest(providerId, () => s.testProvider(providerId))
}

function cancelAdd() {
  showAddForm.value = false
  newName.value = ''
  newBaseURL.value = ''
  newApiKey.value = ''
  addError.value = ''
}

// key visibility
const showOpenAIKey = ref(false)
const showAnthropicKey = ref(false)
const showGoogleKey = ref(false)
const showTavilyKey = ref(false)
const visibleKeys = ref<Record<string, boolean>>({})
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

watch(() => tavily.value.apiKey, apiKey => {
  s.resetTavilyStatus()
  clearAutoTest('tavily')
  if (apiKey.trim())
    scheduleAutoTest('tavily', () => s.testTavily())
})

// preset quick-add
function applyPreset(preset: (typeof PROVIDER_PRESETS)[0]) {
  newName.value = preset.name
  newBaseURL.value = preset.baseURL
  newApiKey.value = ''
  addError.value = ''
  showAddForm.value = true
}

// provider icon helpers
const _localIcons = import.meta.glob<string>(
  '/src/assets/providers/*.svg',
  { eager: true, query: '?url', import: 'default' },
)

function localIconUrl(mdevId: string): string | null {
  const key = `/src/assets/providers/${mdevId}.svg`
  const url = _localIcons[key] ?? null
  if (url === 'data:image/svg+xml,')
    return null
  return url
}

const failedIcons = ref(new Set<string>())

function onIconError(providerId: string) {
  failedIcons.value = new Set([...failedIcons.value, providerId])
}

function compatProviderIconUrl(p: CompatibleProvider): string | null {
  if (!p.mdevId)
    return null
  return localIconUrl(p.mdevId) ?? providerIconUrl(p.mdevId)
}

function onProviderInput(p: CompatibleProvider) {
  s.resetProviderStatus(p.id)
  resetProviderDiscovery(p.id)
  clearAutoTest(p.id)
  if (p.baseURL.trim())
    scheduleAutoTest(p.id, () => s.testProvider(p.id))
}

onUnmounted(() => {
  for (const key of autoTestTimers.keys())
    clearAutoTest(key)
})
</script>

<template>
  <section class="content-section">
    <h2 class="section-title">
      Providers
    </h2>

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

    <!-- Tavily Search -->
    <ProviderCard
      name="Tavily Search"
      url="api.tavily.com web_search tool"
      :status="tavily.status"
      :status-message="tavily.statusMessage"
      logo-class="tavily-logo"
    >
      <template #logo>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </template>
      <template #fields>
        <div class="field-group">
          <label class="field-label">API Key <span class="field-optional">from app.tavily.com</span></label>
          <div class="key-input-wrap">
            <input
              v-model="tavily.apiKey"
              :type="showTavilyKey ? 'text' : 'password'"
              class="field-input"
              placeholder="tvly-"
              autocomplete="off"
              spellcheck="false"
            >
            <button class="key-toggle" @click="showTavilyKey = !showTavilyKey">
              {{ showTavilyKey ? 'Hide' : 'Show' }}
            </button>
          </div>
          <span class="field-hint">
            Free tier available at
            <a class="field-link" href="https://app.tavily.com" target="_blank">app.tavily.com</a>
            1 000 free searches/month
          </span>
        </div>
      </template>
      <template #footer>
        <button class="test-btn" :disabled="tavily.status === 'testing' || !tavily.apiKey.trim()" @click="s.testTavily()">
          <Loader v-if="tavily.status === 'testing'" :size="14" class="spin" />
          <Zap v-else :size="14" :stroke-width="2" />
          Save Provider
        </button>
      </template>
    </ProviderCard>

    <!-- OpenAI-Compatible providers -->
    <div class="subsection-header">
      <span class="subsection-title">OpenAI-Compatible Providers</span>
      <button class="add-btn" @click="showAddForm = true">
        <Plus :size="14" :stroke-width="2.5" />
        Add provider
      </button>
    </div>

    <!-- presets grid -->
    <Transition name="slide-down">
      <div v-if="!showAddForm" class="presets-grid">
        <button
          v-for="preset in PROVIDER_PRESETS"
          :key="preset.name"
          class="preset-chip"
          :title="preset.description"
          @click="applyPreset(preset)"
        >
          <span class="preset-name">{{ preset.name }}</span>
          <span v-if="!preset.requiresKey" class="preset-local">local</span>
        </button>
      </div>
    </Transition>

    <!-- add form -->
    <Transition name="slide-down">
      <div v-if="showAddForm" class="add-form">
        <h3 class="add-form-title">
          New Provider
        </h3>

        <div class="add-form-grid">
          <div class="field-group">
            <label class="field-label">Name</label>
            <input v-model="newName" class="field-input" placeholder="e.g. Groq, Ollama, Mistral" @keydown.enter="submitAdd">
          </div>
          <div class="field-group">
            <label class="field-label">Base URL</label>
            <input v-model="newBaseURL" class="field-input" placeholder="https://api.groq.com/openai/v1" @keydown.enter="submitAdd">
          </div>
          <div class="field-group" style="grid-column: 1 / -1">
            <label class="field-label">API Key <span class="field-optional">optional for local providers</span></label>
            <input v-model="newApiKey" type="password" class="field-input" placeholder="API key" autocomplete="off" @keydown.enter="submitAdd">
          </div>
        </div>

        <p v-if="addError" class="add-error">
          {{ addError }}
        </p>

        <div class="add-form-actions">
          <button class="ghost-btn" @click="cancelAdd">
            Cancel
          </button>
          <button class="primary-btn" @click="submitAdd">
            Add Provider
          </button>
        </div>
      </div>
    </Transition>

    <!-- existing compatible providers -->
    <ProviderCard
      v-for="p in compatibleProviders"
      :key="p.id"
      :name="p.name"
      :url="p.baseURL"
      :status="p.status"
      :status-message="p.statusMessage"
      logo-class="compat-logo"
    >
      <template #logo>
        <template v-if="compatProviderIconUrl(p) && !failedIcons.has(p.id)">
          <img
            :src="compatProviderIconUrl(p)!"
            class="provider-mdev-icon"
            :alt="p.name"
            @error="onIconError(p.id)"
          >
        </template>
        <Puzzle v-else :size="20" :stroke-width="1.8" class="compat-logo-fallback" />
      </template>

      <template #actions>
        <button class="icon-danger-btn" aria-label="Remove provider" @click="s.removeProvider(p.id)">
          <Trash2 :size="14" :stroke-width="2" />
        </button>
      </template>

      <template #fields>
        <div class="add-form-grid" style="margin-top: 8px;">
          <div class="field-group">
            <label class="field-label">Name</label>
            <input
              type="text"
              :value="p.name"
              class="field-input"
              @input="s.updateProvider(p.id, { name: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
            >
          </div>
          <div class="field-group">
            <label class="field-label">Base URL</label>
            <input
              type="text"
              :value="p.baseURL"
              class="field-input"
              @input="s.updateProvider(p.id, { baseURL: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
            >
          </div>
          <div class="field-group" style="grid-column: 1 / -1">
            <label class="field-label">API Key</label>
            <div class="key-input-wrap">
              <input
                :type="visibleKeys[p.id] ? 'text' : 'password'"
                :value="p.apiKey"
                class="field-input"
                placeholder="Leave empty for local providers"
                autocomplete="off"
                @input="s.updateProvider(p.id, { apiKey: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
              >
              <button class="key-toggle" @click="visibleKeys[p.id] = !visibleKeys[p.id]">
                {{ visibleKeys[p.id] ? 'Hide' : 'Show' }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <button
          class="test-btn"
          :disabled="p.status === 'testing' || !p.baseURL.trim()"
          @click="s.testProvider(p.id)"
        >
          <Loader v-if="p.status === 'testing'" :size="14" class="spin" />
          <Zap v-else :size="14" :stroke-width="2" />
          Save Provider
        </button>
      </template>
    </ProviderCard>

    <!-- empty state -->
    <div v-if="compatibleProviders.length === 0 && !showAddForm" class="compat-empty">
      <p>No custom providers added yet.</p>
      <p class="compat-examples">
        Works with Groq, Mistral, Together AI, Ollama, LM Studio, Deepseek, Perplexity or any OpenAI-compatible endpoint.
      </p>
    </div>
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}

/* Built-in logo backgrounds */
.openai-logo {
  background: var(--color-openai-muted);
  color: var(--color-openai);
  border: 1px solid var(--color-openai-muted);
}

.anthropic-logo {
  background: var(--color-anthropic-muted);
  color: var(--color-anthropic);
  border: 1px solid var(--color-anthropic-muted);
}

.google-logo {
  background: var(--color-google-muted);
  border: 1px solid var(--color-google-muted);
}

.tavily-logo {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info-text);
  border: 1px solid color-mix(in srgb, var(--color-info) 25%, transparent);
}

/* Universal safe box for 3rd party brand logos */
.compat-logo {
  background: var(--color-bg-base);
  border: 1px solid color-mix(in srgb, var(--color-bg-base) 10%, transparent);
  box-shadow: var(--color-shadow-sm);
}

.provider-mdev-icon {
  display: block;
  width: 22px;
  height: 22px;
  object-fit: contain;
  /* Original filter removed so brand colors stay true and visible on the white box */
}

.compat-logo-fallback {
  color: var(--color-text-dim);
}

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
  padding-right: 60px; /* Space for the show/hide toggle */
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

.subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.subsection-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.add-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
}

.presets-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.preset-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.preset-chip:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}

.preset-local {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-success-text);
  background: color-mix(in srgb, var(--color-success-muted) 30%, transparent);
  border: 1px solid var(--color-success-muted);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

.add-form {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--color-shadow-md);
}

.add-form-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 20px;
  margin-top: 0;
}

.add-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.add-error {
  font-size: 13px;
  color: var(--color-danger-text);
  margin-top: 12px;
}

.add-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

.ghost-btn {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.ghost-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.primary-btn {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-btn-primary-bg);
  color: var(--color-btn-primary-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.primary-btn:hover {
  background: var(--color-accent-bright);
  border-color: var(--color-accent-bright);
}

.icon-danger-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}

.icon-danger-btn:hover {
  background: color-mix(in srgb, var(--color-danger-muted) 30%, transparent);
  color: var(--color-danger-text);
  border-color: var(--color-danger-muted);
}

.compat-empty {
  padding: 20px 16px;
  text-align: center;
  background: var(--color-bg-surface);
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-lg);
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.compat-examples {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition:
    max-height 250ms ease,
    opacity 200ms ease;
  overflow: hidden;
  max-height: 500px;
}

.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .add-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
