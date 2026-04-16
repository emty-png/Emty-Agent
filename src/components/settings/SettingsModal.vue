<script setup lang="ts">
import type { CompatibleProvider } from '@/stores/settings'
import {
  Brain,
  Check,
  ChevronRight,
  Loader,
  Plus,
  Puzzle,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { PROVIDER_PRESETS, useSettingsStore } from '@/stores/settings'
import { PRESET_MDEV_IDS, providerIconUrl } from '@/utils/modelsdev'

// ── props / emits ─────────────────────────────────────────────────────────────
const emit = defineEmits<{ close: [] }>()

const s = useSettingsStore()
const { openai, anthropic, google, compatibleProviders } = storeToRefs(s)

// ── navigation ────────────────────────────────────────────────────────────────
type Section = 'general' | 'providers' | 'models'
const activeSection = ref<Section>('providers')

const NAV: { id: Section; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'providers', label: 'Providers', icon: Puzzle },
  { id: 'models', label: 'Models', icon: Zap },
]

// ── add provider form ─────────────────────────────────────────────────────────
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
  s.addProvider({ name, baseURL: newBaseURL.value.trim(), apiKey: newApiKey.value.trim(), mdevId })
  newName.value = ''
  newBaseURL.value = ''
  newApiKey.value = ''
  addError.value = ''
  showAddForm.value = false
}

function cancelAdd() {
  showAddForm.value = false
  newName.value = ''
  newBaseURL.value = ''
  newApiKey.value = ''
  addError.value = ''
}

// ── openai key visibility ─────────────────────────────────────────────────────
const showOpenAIKey = ref(false)

// reset statuses when keys change so stale ✓/✗ don't linger
watch(() => openai.value.apiKey, () => s.resetOpenAIStatus())
watch(() => openai.value.baseURL, () => s.resetOpenAIStatus())
watch(() => anthropic.value.apiKey, () => s.resetAnthropicStatus())
watch(() => anthropic.value.baseURL, () => s.resetAnthropicStatus())
watch(() => google.value.apiKey, () => s.resetGoogleStatus())

// ── models section ───────────────────────────────────────────────────────────
const { discoveredModels } = storeToRefs(s)
const modelSearch = ref('')
const filteredModels = computed(() => {
  const q = modelSearch.value.toLowerCase()
  return q
    ? discoveredModels.value.filter(m => m.name.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q))
    : discoveredModels.value
})
const modelGroups = computed(() => {
  const groups = new Map<string, { providerName: string; models: typeof filteredModels.value }>()
  for (const m of filteredModels.value) {
    if (!groups.has(m.providerId))
      groups.set(m.providerId, { providerName: m.providerName, models: [] })
    groups.get(m.providerId)!.models.push(m)
  }
  return [...groups.entries()].map(([id, g]) => ({ providerId: id, ...g }))
})
async function refreshAllModels() {
  const tasks: Promise<void>[] = []
  if (openai.value.apiKey)
    tasks.push(s.testOpenAI())
  if (anthropic.value.apiKey)
    tasks.push(s.testAnthropic())
  if (google.value.apiKey)
    tasks.push(s.testGoogle())
  for (const p of compatibleProviders.value) {
    if (p.baseURL)
      tasks.push(s.testProvider(p.id))
  }
  await Promise.allSettled(tasks)
}

// preset quick-add
function applyPreset(preset: (typeof PROVIDER_PRESETS)[0]) {
  newName.value = preset.name
  newBaseURL.value = preset.baseURL
  newApiKey.value = ''
  addError.value = ''
  showAddForm.value = true
}

// per-provider key visibility map
const visibleKeys = ref<Record<string, boolean>>({})
const showAnthropicKey = ref(false)
const showGoogleKey = ref(false)

// ── provider icon helpers ─────────────────────────────────────────────────────
// Eagerly import every SVG from src/assets/providers/ as a resolved URL.
// Keys are absolute paths like '/src/assets/providers/groq.svg'.
const _localIcons = import.meta.glob<string>(
  '/src/assets/providers/*.svg',
  { eager: true, query: '?url', import: 'default' },
)

/** Returns the local asset URL for a mdevId, or null if not bundled. */
function localIconUrl(mdevId: string): string | null {
  const key = `/src/assets/providers/${mdevId}.svg`
  const url = _localIcons[key] ?? null
  // Vite's ?url glob returns 'data:image/svg+xml,' for 0-byte files.
  // We treat that as null so we can fall back to the CDN.
  if (url === 'data:image/svg+xml,')
    return null
  return url
}

// Track which provider icons failed to load so we can show the Puzzle fallback.
const failedIcons = ref(new Set<string>())

function onIconError(providerId: string) {
  failedIcons.value = new Set([...failedIcons.value, providerId])
}

function compatProviderIconUrl(p: CompatibleProvider): string | null {
  if (!p.mdevId)
    return null
  return localIconUrl(p.mdevId) ?? providerIconUrl(p.mdevId)
}

// ── helpers ───────────────────────────────────────────────────────────────────

// provider-level: watch for field changes → reset status
function onProviderInput(p: CompatibleProvider) {
  s.resetProviderStatus(p.id)
}

// close on Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}
</script>

<template>
  <Teleport to="body">
    <!-- backdrop -->
    <div class="settings-backdrop" @click.self="emit('close')" @keydown="onKeydown">
      <!-- modal -->
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <!-- ── modal header ───────────────────────────────────────────── -->
        <div class="modal-header">
          <span class="modal-title">Settings</span>
          <button class="modal-close" aria-label="Close settings" @click="emit('close')">
            <X :size="14" :stroke-width="2" />
          </button>
        </div>

        <!-- ── body: sidebar + content ───────────────────────────────── -->
        <div class="modal-body">
          <!-- left nav -->
          <nav class="settings-nav">
            <button
              v-for="item in NAV"
              :key="item.id"
              class="nav-item"
              :class="{ 'nav-item--active': activeSection === item.id }"
              @click="activeSection = item.id"
            >
              <component :is="item.icon" :size="14" :stroke-width="1.8" class="nav-icon" />
              <span>{{ item.label }}</span>
              <ChevronRight
                :size="12"
                :stroke-width="2"
                class="nav-arrow"
                :class="{ 'nav-arrow--active': activeSection === item.id }"
              />
            </button>
          </nav>

          <!-- right content -->
          <div class="settings-content">
            <!-- ════════════════════════════════════
                 GENERAL (placeholder)
                 ════════════════════════════════════ -->
            <section v-if="activeSection === 'general'" class="content-section">
              <h2 class="section-title">
                General
              </h2>
              <div class="placeholder-card">
                <span class="placeholder-text">General settings coming soon</span>
              </div>
            </section>

            <!-- ════════════════════════════════════
                 PROVIDERS
                 ════════════════════════════════════ -->
            <section v-else-if="activeSection === 'providers'" class="content-section">
              <h2 class="section-title">
                Providers
              </h2>

              <!-- ── OpenAI ────────────────────────────────────────── -->
              <div class="provider-card">
                <div class="provider-card-header">
                  <div class="provider-info">
                    <span class="provider-logo openai-logo">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
                    </span>
                    <div>
                      <span class="provider-name">OpenAI</span>
                      <span class="provider-url">api.openai.com</span>
                    </div>
                  </div>

                  <!-- connection badge -->
                  <div
                    v-if="openai.status !== 'idle'"
                    class="status-badge"
                    :class="`status-badge--${openai.status}`"
                  >
                    <Loader v-if="openai.status === 'testing'" :size="11" class="spin" />
                    <Check v-else-if="openai.status === 'ok'" :size="11" />
                    <TriangleAlert v-else :size="11" />
                    <span>{{ openai.status === 'testing' ? 'Testing…' : openai.statusMessage }}</span>
                  </div>
                </div>

                <!-- api key -->
                <div class="field-group">
                  <label class="field-label">API Key</label>
                  <div class="key-input-wrap">
                    <input
                      v-model="openai.apiKey"
                      :type="showOpenAIKey ? 'text' : 'password'"
                      class="field-input"
                      placeholder="sk-…"
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

                <!-- org id (optional) -->
                <div class="field-group">
                  <label class="field-label">Organization ID <span class="field-optional">optional</span></label>
                  <input
                    v-model="openai.organizationId"
                    type="text"
                    class="field-input"
                    placeholder="org-…"
                    autocomplete="off"
                  >
                </div>

                <!-- base url override -->
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

                <div class="card-footer">
                  <button
                    class="test-btn"
                    :disabled="openai.status === 'testing' || !openai.apiKey.trim()"
                    @click="s.testOpenAI()"
                  >
                    <Loader v-if="openai.status === 'testing'" :size="12" class="spin" />
                    <Zap v-else :size="12" :stroke-width="2" />
                    Test connection
                  </button>
                </div>
              </div>

              <!-- ── Anthropic ─────────────────────────────────── -->
              <div class="provider-card">
                <div class="provider-card-header">
                  <div class="provider-info">
                    <span class="provider-logo anthropic-logo">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.498-3.818h6.404l-1.474-3.64H6.95l2.82-7.214 1.403 5.072z" /></svg>
                    </span>
                    <div>
                      <span class="provider-name">Anthropic</span>
                      <span class="provider-url">api.anthropic.com</span>
                    </div>
                  </div>
                  <div v-if="anthropic.status !== 'idle'" class="status-badge" :class="`status-badge--${anthropic.status}`">
                    <Loader v-if="anthropic.status === 'testing'" :size="11" class="spin" />
                    <Check v-else-if="anthropic.status === 'ok'" :size="11" />
                    <TriangleAlert v-else :size="11" />
                    <span>{{ anthropic.status === 'testing' ? 'Testing…' : anthropic.statusMessage }}</span>
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label">API Key</label>
                  <div class="key-input-wrap">
                    <input
                      v-model="anthropic.apiKey"
                      :type="showAnthropicKey ? 'text' : 'password'"
                      class="field-input"
                      placeholder="sk-ant-…"
                      autocomplete="off"
                      spellcheck="false"
                    >
                    <button class="key-toggle" @click="showAnthropicKey = !showAnthropicKey">
                      {{ showAnthropicKey ? 'Hide' : 'Show' }}
                    </button>
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label">Base URL <span class="field-optional">override for proxies / Bedrock / Vertex</span></label>
                  <input v-model="anthropic.baseURL" type="text" class="field-input" placeholder="https://api.anthropic.com/v1" autocomplete="off">
                </div>

                <div class="card-footer">
                  <button class="test-btn" :disabled="anthropic.status === 'testing' || !anthropic.apiKey.trim()" @click="s.testAnthropic()">
                    <Loader v-if="anthropic.status === 'testing'" :size="12" class="spin" />
                    <Zap v-else :size="12" :stroke-width="2" />
                    Test connection
                  </button>
                </div>
              </div>

              <!-- ── Google Gemini ──────────────────────────────── -->
              <div class="provider-card">
                <div class="provider-card-header">
                  <div class="provider-info">
                    <span class="provider-logo google-logo">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                    </span>
                    <div>
                      <span class="provider-name">Google Gemini</span>
                      <span class="provider-url">generativelanguage.googleapis.com</span>
                    </div>
                  </div>
                  <div v-if="google.status !== 'idle'" class="status-badge" :class="`status-badge--${google.status}`">
                    <Loader v-if="google.status === 'testing'" :size="11" class="spin" />
                    <Check v-else-if="google.status === 'ok'" :size="11" />
                    <TriangleAlert v-else :size="11" />
                    <span>{{ google.status === 'testing' ? 'Testing…' : google.statusMessage }}</span>
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label">API Key <span class="field-optional">from Google AI Studio</span></label>
                  <div class="key-input-wrap">
                    <input
                      v-model="google.apiKey"
                      :type="showGoogleKey ? 'text' : 'password'"
                      class="field-input"
                      placeholder="AIza…"
                      autocomplete="off"
                      spellcheck="false"
                    >
                    <button class="key-toggle" @click="showGoogleKey = !showGoogleKey">
                      {{ showGoogleKey ? 'Hide' : 'Show' }}
                    </button>
                  </div>
                  <span class="field-hint">Get a free key at <a class="field-link" href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a></span>
                </div>

                <div class="card-footer">
                  <button class="test-btn" :disabled="google.status === 'testing' || !google.apiKey.trim()" @click="s.testGoogle()">
                    <Loader v-if="google.status === 'testing'" :size="12" class="spin" />
                    <Zap v-else :size="12" :stroke-width="2" />
                    Test connection
                  </button>
                </div>
              </div>

              <!-- ── OpenAI-Compatible providers ────────────────── -->
              <div class="subsection-header">
                <span class="subsection-title">OpenAI-Compatible Providers</span>
                <button class="add-btn" @click="showAddForm = true">
                  <Plus :size="12" :stroke-width="2" />
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
              <div
                v-for="p in compatibleProviders"
                :key="p.id"
                class="provider-card provider-card--compatible"
              >
                <div class="provider-card-header">
                  <div class="provider-info">
                    <!-- ── provider icon: local asset → CDN fallback → Puzzle ── -->
                    <span class="provider-logo compat-logo">
                      <template v-if="compatProviderIconUrl(p) && !failedIcons.has(p.id)">
                        <img
                          :src="compatProviderIconUrl(p)!"
                          width="18"
                          height="18"
                          class="provider-mdev-icon"
                          :alt="p.name"
                          @error="onIconError(p.id)"
                        >
                      </template>
                      <Puzzle v-else :size="12" :stroke-width="1.8" />
                    </span>
                    <div>
                      <span class="provider-name">{{ p.name }}</span>
                      <span class="provider-url">{{ p.baseURL }}</span>
                    </div>
                  </div>

                  <div style="display:flex; align-items:center; gap:8px;">
                    <div v-if="p.status !== 'idle'" class="status-badge" :class="`status-badge--${p.status}`">
                      <Loader v-if="p.status === 'testing'" :size="11" class="spin" />
                      <Check v-else-if="p.status === 'ok'" :size="11" />
                      <TriangleAlert v-else :size="11" />
                      <span>{{ p.status === 'testing' ? 'Testing…' : p.statusMessage }}</span>
                    </div>
                    <button class="icon-danger-btn" aria-label="Remove provider" @click="s.removeProvider(p.id)">
                      <Trash2 :size="13" :stroke-width="1.7" />
                    </button>
                  </div>
                </div>

                <div class="add-form-grid" style="margin-top: 12px;">
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

                <div class="card-footer">
                  <button
                    class="test-btn"
                    :disabled="p.status === 'testing' || !p.baseURL.trim()"
                    @click="s.testProvider(p.id)"
                  >
                    <Loader v-if="p.status === 'testing'" :size="12" class="spin" />
                    <Zap v-else :size="12" :stroke-width="2" />
                    Test connection
                  </button>
                </div>
              </div>

              <!-- empty state -->
              <div v-if="compatibleProviders.length === 0 && !showAddForm" class="compat-empty">
                <p>No custom providers added yet.</p>
                <p class="compat-examples">
                  Works with Groq, Mistral, Together AI, Ollama, LM Studio, Deepseek, Perplexity — any OpenAI-compatible endpoint.
                </p>
              </div>
            </section>

            <!-- ════════════════════════════════════
                 MODELS
                 ════════════════════════════════════ -->
            <section v-else-if="activeSection === 'models'" class="content-section">
              <div class="models-header">
                <h2 class="section-title" style="margin-bottom:0">
                  Models
                </h2>
                <button class="ghost-btn" style="display:flex;align-items:center;gap:6px;" @click="refreshAllModels">
                  <Loader :size="12" :stroke-width="2" />
                  Refresh all
                </button>
              </div>

              <!-- search -->
              <div class="search-wrap">
                <Search :size="13" :stroke-width="1.8" class="search-icon" />
                <input v-model="modelSearch" class="search-input" placeholder="Search models…">
              </div>

              <!-- empty: no providers connected -->
              <div v-if="discoveredModels.length === 0" class="models-empty">
                <Zap :size="24" :stroke-width="1.3" style="opacity:0.3; margin-bottom:8px" />
                <p class="models-empty-title">
                  No models discovered yet
                </p>
                <p class="models-empty-sub">
                  Go to <strong>Providers</strong>, add your API keys and click <strong>Test connection</strong> — models will appear here automatically.
                </p>
              </div>

              <!-- no search results -->
              <div v-else-if="modelGroups.length === 0" class="models-empty">
                <p style="color:var(--color-text-tertiary);font-size:13px;">
                  No models match "{{ modelSearch }}"
                </p>
              </div>

              <!-- model groups -->
              <template v-else>
                <div
                  v-for="group in modelGroups"
                  :key="group.providerId"
                  class="model-group"
                >
                  <div class="model-group-header">
                    <span class="model-group-name">{{ group.providerName }}</span>
                    <span class="model-group-count">{{ group.models.filter(m => m.enabled).length }}/{{ group.models.length }} enabled</span>
                  </div>

                  <div class="model-group-body">
                    <div
                      v-for="m in group.models"
                      :key="m.uid"
                      class="model-row"
                      :class="{ 'model-row--disabled': !m.enabled }"
                    >
                      <div class="model-row-left">
                        <span class="model-row-name">{{ m.name }}</span>
                        <!-- detected thinking badge -->
                        <span v-if="m.supportsThinking" class="model-thinking-badge">
                          thinking
                        </span>
                        <!-- user-forced thinking badge -->
                        <span v-else-if="m.thinkingForced" class="model-thinking-badge model-thinking-badge--forced">
                          think ✦
                        </span>
                      </div>

                      <div class="model-row-right">
                        <!-- force-think toggle: only for models NOT auto-detected as reasoning -->
                        <button
                          v-if="m.enabled && !m.supportsThinking"
                          class="force-think-btn"
                          :class="{ 'force-think-btn--on': m.thinkingForced }"
                          :title="m.thinkingForced ? 'Disable thinking' : 'Force enable thinking'"
                          @click="s.forceModelThinking(m.uid, !m.thinkingForced)"
                        >
                          <Brain :size="12" :stroke-width="m.thinkingForced ? 2.2 : 1.6" />
                        </button>

                        <!-- thinking effort: show when enabled and thinking is active (detected OR forced) -->
                        <div v-if="m.enabled && (m.supportsThinking || m.thinkingForced)" class="effort-seg">
                          <button
                            v-for="lvl in (['low', 'medium', 'high'] as const)"
                            :key="lvl"
                            class="effort-btn"
                            :class="{ 'effort-btn--active': m.thinkingEffort === lvl }"
                            @click="s.setModelThinking(m.uid, lvl)"
                          >
                            {{ lvl[0]!.toUpperCase() }}
                          </button>
                        </div>

                        <!-- enable toggle -->
                        <button
                          class="model-toggle"
                          :class="{ 'model-toggle--on': m.enabled }"
                          :aria-label="m.enabled ? 'Disable model' : 'Enable model'"
                          @click="s.toggleModel(m.uid)"
                        >
                          <span class="model-toggle-thumb" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── backdrop ────────────────────────────────────────────────────────────────── */
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  backdrop-filter: blur(2px);
}

/* ── modal shell ─────────────────────────────────────────────────────────────── */
.settings-modal {
  display: flex;
  flex-direction: column;
  width: 820px;
  max-width: 100%;
  height: 560px;
  max-height: calc(100vh - 48px);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  overflow: hidden;
  animation: modal-in 160ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ── header ──────────────────────────────────────────────────────────────────── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  min-height: 44px;
  padding-inline: 20px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.modal-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.modal-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* ── body ────────────────────────────────────────────────────────────────────── */
.modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── left nav ────────────────────────────────────────────────────────────────── */
.settings-nav {
  display: flex;
  flex-direction: column;
  width: 188px;
  min-width: 188px;
  padding: 12px 8px;
  gap: 1px;
  border-right: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding-inline: 10px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
  position: relative;
}

.nav-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.nav-item--active {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}

.nav-item--active:hover {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-arrow {
  margin-left: auto;
  color: var(--color-text-tertiary);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.nav-item:hover .nav-arrow,
.nav-arrow--active {
  opacity: 1;
  transform: translateX(0);
}

/* ── right content ───────────────────────────────────────────────────────────── */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 32px;
}

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

/* ── provider card ───────────────────────────────────────────────────────────── */
.provider-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.provider-logo {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  flex-shrink: 0;
}

.openai-logo {
  background: #10a37f18;
  color: #10a37f;
  border: 1px solid #10a37f30;
}

.compat-logo {
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-mid);
}

/* models.dev icon — rendered inside the compat-logo box */
.provider-mdev-icon {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
  /* SVGs from models.dev are often dark; invert on dark backgrounds */
  filter: brightness(0) invert(0.75);
}

.anthropic-logo {
  background: #cc785218;
  color: #cc7852;
  border: 1px solid #cc785230;
}

.google-logo {
  background: #4285f418;
  border: 1px solid #4285f430;
}

/* ── field hint / link ───────────────────────────────────────────────────────── */
.field-hint {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.field-link {
  color: var(--color-steel-text);
  text-decoration: none;
  transition: color 120ms ease;
}

.field-link:hover {
  color: var(--color-steel);
  text-decoration: underline;
}

.provider-name {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.provider-url {
  display: block;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.2;
  margin-top: 1px;
}

/* ── status badge ────────────────────────────────────────────────────────────── */
.status-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding-inline: 8px;
  border-radius: 99px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-badge span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge--testing {
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-mid);
}

.status-badge--ok {
  background: #5e946818;
  color: var(--color-sage-text);
  border: 1px solid #5e946830;
}

.status-badge--error {
  background: #a8505018;
  color: var(--color-rose-text);
  border: 1px solid #a8505030;
}

/* ── fields ──────────────────────────────────────────────────────────────────── */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

.field-optional {
  font-weight: 400;
  color: var(--color-text-tertiary);
  margin-left: 4px;
}

.field-input {
  height: 34px;
  padding-inline: 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 7px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 130ms ease;
}

.field-input:focus {
  border-color: var(--color-ember-dim);
}

.field-input::placeholder {
  color: var(--color-text-tertiary);
}

/* ── key input with show/hide ─────────────────────────────────────────────────── */
.key-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.key-input-wrap .field-input {
  flex: 1;
  padding-right: 52px;
}

.key-toggle {
  position: absolute;
  right: 8px;
  height: 22px;
  padding-inline: 6px;
  border: none;
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease;
}

.key-toggle:hover {
  background: var(--color-border-mid);
  color: var(--color-text-secondary);
}

/* ── card footer ─────────────────────────────────────────────────────────────── */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 4px;
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding-inline: 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: 7px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.test-btn:hover:not(:disabled) {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
  border-color: var(--color-ember-dim);
}

.test-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── subsection header ───────────────────────────────────────────────────────── */
.subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.subsection-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding-inline: 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.add-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* ── add form ────────────────────────────────────────────────────────────────── */
.add-form {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-ember-dim);
  border-radius: 10px;
  padding: 16px;
}

.add-form-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 14px;
}

.add-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.add-error {
  font-size: 12px;
  color: var(--color-rose-text);
  margin-top: 6px;
}

.add-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}

/* ── buttons ─────────────────────────────────────────────────────────────────── */
.ghost-btn {
  height: 30px;
  padding-inline: 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease;
}

.ghost-btn:hover {
  background: var(--color-bg-hover);
}

.primary-btn {
  height: 30px;
  padding-inline: 16px;
  border: 1px solid var(--color-ember-dim);
  border-radius: 7px;
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.primary-btn:hover {
  background: #e0783030;
  border-color: var(--color-ember-base);
}

/* ── danger icon btn ─────────────────────────────────────────────────────────── */
.icon-danger-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.icon-danger-btn:hover {
  background: #a8505020;
  color: var(--color-rose-text);
}

/* ── compatible empty ────────────────────────────────────────────────────────── */
.compat-empty {
  padding: 16px;
  background: var(--color-bg-surface);
  border: 1px dashed var(--color-border-mid);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

.compat-examples {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  opacity: 0.7;
}

/* ── placeholder ─────────────────────────────────────────────────────────────── */
.placeholder-card {
  padding: 32px;
  background: var(--color-bg-surface);
  border: 1px dashed var(--color-border-mid);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-text {
  font-size: 13px;
  color: var(--color-text-tertiary);
}

/* ── presets grid ────────────────────────────────────────────────────────────── */
.presets-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.preset-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-inline: 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.preset-chip:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}

.preset-local {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-sage-text);
  background: #5e946818;
  border: 1px solid #5e946828;
  border-radius: 3px;
  padding: 1px 4px;
}

/* ── models section ──────────────────────────────────────────────────────────── */
.models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.search-wrap {
  position: relative;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 34px;
  padding-left: 32px;
  padding-right: 12px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 140ms ease;
  box-sizing: border-box;
}
.search-input::placeholder {
  color: var(--color-text-tertiary);
}
.search-input:focus {
  border-color: var(--color-border-bright);
}

.models-empty {
  padding: 32px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--color-text-tertiary);
  background: var(--color-bg-surface);
  border: 1px dashed var(--color-border-mid);
  border-radius: 10px;
  gap: 4px;
}

.models-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.models-empty-sub {
  font-size: 12.5px;
  max-width: 320px;
  line-height: 1.6;
  margin-top: 4px;
}
.models-empty-sub strong {
  color: var(--color-text-secondary);
}

/* ── model group ─────────────────────────────────────────────────────────────── */
.model-group {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  overflow: hidden;
}

.model-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.model-group-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.model-group-count {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.model-group-body {
  display: flex;
  flex-direction: column;
}

/* ── model row ───────────────────────────────────────────────────────────────── */
.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  transition: background 100ms ease;
  min-height: 44px;
}

.model-row:last-child {
  border-bottom: none;
}

.model-row:hover {
  background: var(--color-bg-hover);
}

.model-row--disabled {
  opacity: 0.45;
}

.model-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.model-row-name {
  font-size: 13px;
  font-weight: 450;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── thinking badges ─────────────────────────────────────────────────────────── */
.model-thinking-badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ember-text);
  background: var(--color-ember-glow);
  border: 1px solid var(--color-ember-dim);
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
}

/* forced thinking badge — steel tint to distinguish from auto-detected */
.model-thinking-badge--forced {
  color: var(--color-steel-text);
  background: #6aaec810;
  border-color: #6aaec830;
}

.model-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* ── force-thinking button ───────────────────────────────────────────────────── */
.force-think-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 22px;
  border: 1px solid var(--color-border-mid);
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease,
    border-color 110ms ease;
}

.force-think-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.force-think-btn--on {
  background: #6aaec810;
  color: var(--color-steel-text);
  border-color: #6aaec830;
}

.force-think-btn--on:hover {
  background: #6aaec820;
  border-color: #6aaec850;
}

/* ── thinking effort segmented control ───────────────────────────────────────── */
.effort-seg {
  display: flex;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 5px;
  overflow: hidden;
}

.effort-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease;
}

.effort-btn + .effort-btn {
  border-left: 1px solid var(--color-border-mid);
}

.effort-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.effort-btn--active {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}

/* ── model toggle ────────────────────────────────────────────────────────────── */
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
  background: var(--color-ember-dim);
  border-color: var(--color-ember-base);
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

/* ── add form transition ─────────────────────────────────────────────────────── */
.slide-down-enter-active,
.slide-down-leave-active {
  transition:
    max-height 200ms ease,
    opacity 180ms ease;
  overflow: hidden;
  max-height: 400px;
}

.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}

/* ── spinner ─────────────────────────────────────────────────────────────────── */
.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
