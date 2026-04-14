<script setup lang="ts">
import type { CompatibleProvider } from '@/stores/settings'
import {
  Check,
  ChevronRight,
  Loader,
  Plus,
  Puzzle,
  Settings,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// ── props / emits ─────────────────────────────────────────────────────────────
const emit = defineEmits<{ close: [] }>()

const s = useSettingsStore()
const { openai, compatibleProviders } = storeToRefs(s)

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
  s.addProvider({
    name: newName.value.trim(),
    baseURL: newBaseURL.value.trim(),
    apiKey: newApiKey.value.trim(),
  })
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

// per-provider key visibility map
const visibleKeys = ref<Record<string, boolean>>({})

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

              <!-- ── OpenAI-Compatible providers ────────────────── -->
              <div class="subsection-header">
                <span class="subsection-title">OpenAI-Compatible Providers</span>
                <button class="add-btn" @click="showAddForm = true">
                  <Plus :size="12" :stroke-width="2" />
                  Add provider
                </button>
              </div>

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
                    <span class="provider-logo compat-logo">
                      <Puzzle :size="12" :stroke-width="1.8" />
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
                 MODELS (placeholder)
                 ════════════════════════════════════ -->
            <section v-else-if="activeSection === 'models'" class="content-section">
              <h2 class="section-title">
                Models
              </h2>
              <div class="placeholder-card">
                <span class="placeholder-text">Model configuration coming soon</span>
              </div>
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
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
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
}

.provider-logo {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.openai-logo {
  background: #10a37f18;
  color: #10a37f;
  border: 1px solid #10a37f30;
}

.compat-logo {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
  border: 1px solid var(--color-ember-dim);
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
  border-radius: var(--radius-pill);
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
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  transition: border-color 120ms ease;
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
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-text {
  font-size: 13px;
  color: var(--color-text-tertiary);
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
