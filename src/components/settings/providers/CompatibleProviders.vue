<script setup lang="ts">
import type { CompatibleProvider } from '@/stores/settings'
import {
  Loader,
  Plus,
  Puzzle,
  Trash2,
  X,
  Zap,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { ALL_PROVIDERS, getProviderIconUrl } from '@/utils/modelsdev'
import ProviderCard from './ProviderCard.vue'

const KNOWN_PRESET_IDS = new Set(ALL_PROVIDERS.map(p => p.id))

function isCustomProvider(p: CompatibleProvider): boolean {
  return !p.mdevId || !KNOWN_PRESET_IDS.has(p.mdevId)
}

const s = useSettingsStore()
const { compatibleProviders } = storeToRefs(s)

const visibleKeys = ref<Record<string, boolean>>({})
const failedIcons = ref(new Set<string>())
const newHeaderKeys = ref<Record<string, string>>({})
const newHeaderValues = ref<Record<string, string>>({})

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

function onIconError(providerId: string) {
  failedIcons.value = new Set([...failedIcons.value, providerId])
}

function compatProviderIconUrl(p: CompatibleProvider): string | null {
  if (!p.mdevId)
    return null
  return getProviderIconUrl(p.mdevId)
}

function onProviderInput(p: CompatibleProvider) {
  s.resetProviderStatus(p.id)
  resetProviderDiscovery(p.id)
  clearAutoTest(p.id)
  if (p.baseURL.trim())
    scheduleAutoTest(p.id, () => s.testProvider(p.id))
}

function updateProviderHeader(providerId: string, key: string, value: string) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p)
    return
  if (!p.headers)
    p.headers = {}
  p.headers[key] = value
  onProviderInput(p)
}

function removeProviderHeader(providerId: string, key: string) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p?.headers)
    return
  delete p.headers[key]
  if (Object.keys(p.headers).length === 0)
    p.headers = {}
  onProviderInput(p)
}

function addProviderHeader(providerId: string) {
  const key = newHeaderKeys.value[providerId]?.trim()
  if (!key)
    return
  const value = newHeaderValues.value[providerId] ?? ''
  updateProviderHeader(providerId, key, value)
  newHeaderKeys.value[providerId] = ''
  newHeaderValues.value[providerId] = ''
}

function updateProviderModel(providerId: string, index: number, field: 'id' | 'name', value: string) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p?.models?.[index])
    return
  p.models[index][field] = value
  onProviderInput(p)
}

function updateProviderModelContextLimit(providerId: string, index: number, value: string) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p?.models?.[index])
    return
  const num = value.trim() ? Number(value) : 0
  if (num > 0)
    p.models[index].contextLimit = num
  else
    delete p.models[index].contextLimit
  onProviderInput(p)
}

function removeProviderModel(providerId: string, index: number) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p?.models)
    return
  p.models.splice(index, 1)
  onProviderInput(p)
}

function addProviderModel(providerId: string) {
  const p = compatibleProviders.value.find(x => x.id === providerId)
  if (!p)
    return
  if (!p.models)
    p.models = []
  p.models.push({ id: '', name: '' })
}
</script>

<template>
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
      <!-- delete moved to footer -->
    </template>

    <template #fields>
      <div class="add-form-grid" style="margin-top: 8px;">
        <template v-if="isCustomProvider(p)">
          <div class="field-group">
            <label class="field-label">Provider ID</label>
            <input
              type="text"
              :value="p.id"
              class="field-input field-input--mono"
              disabled
            >
          </div>
          <div class="field-group">
            <label class="field-label">Display Name</label>
            <input
              type="text"
              :value="p.name"
              class="field-input"
              @input="s.updateProvider(p.id, { name: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
            >
          </div>
        </template>
        <div class="field-group">
          <label class="field-label">Base URL</label>
          <input
            type="text"
            :value="p.baseURL"
            class="field-input"
            @input="s.updateProvider(p.id, { baseURL: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
          >
        </div>
        <div class="field-group">
          <label class="field-label">API Key <span class="field-optional">optional</span></label>
          <div class="key-input-wrap">
            <input
              :type="visibleKeys[p.id] ? 'text' : 'password'"
              :value="p.apiKey"
              class="field-input"
              placeholder="Leave empty if you manage auth via headers"
              autocomplete="off"
              @input="s.updateProvider(p.id, { apiKey: ($event.target as HTMLInputElement).value }); onProviderInput(p)"
            >
            <button class="key-toggle" @click="visibleKeys[p.id] = !visibleKeys[p.id]">
              {{ visibleKeys[p.id] ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Edit: Models (custom providers only) -->
      <template v-if="isCustomProvider(p)">
        <div class="kv-section">
          <label class="field-label">Models <span class="field-optional">optional, auto-discovered from models.dev</span></label>
          <div v-for="(m, i) in (p.models ?? [])" :key="i" class="kv-row">
            <input
              :value="m.id"
              class="field-input field-input--mono"
              placeholder="model-id"
              @input="updateProviderModel(p.id, i, 'id', ($event.target as HTMLInputElement).value)"
            >
            <input
              :value="m.name"
              class="field-input"
              placeholder="Display Name"
              @input="updateProviderModel(p.id, i, 'name', ($event.target as HTMLInputElement).value)"
            >
            <input
              :value="m.contextLimit ?? ''"
              class="field-input field-input--mono field-input--narrow"
              placeholder="ctx"
              type="number"
              min="0"
              @input="updateProviderModelContextLimit(p.id, i, ($event.target as HTMLInputElement).value)"
            >
            <button class="kv-remove" @click="removeProviderModel(p.id, i)">
              <X :size="12" :stroke-width="2.5" />
            </button>
          </div>
          <button class="kv-add" @click="addProviderModel(p.id)">
            <Plus :size="12" :stroke-width="2.5" />
            Add Model
          </button>
        </div>

        <!-- Edit: Headers -->
        <div class="kv-section">
          <label class="field-label">Headers <span class="field-optional">optional</span></label>
          <div v-for="(val, key) in (p.headers ?? {})" :key="key" class="kv-row">
            <input
              :value="key"
              class="field-input field-input--mono"
              placeholder="Header-Name"
              disabled
            >
            <input
              :value="val"
              class="field-input"
              placeholder="value"
              @input="updateProviderHeader(p.id, key as string, ($event.target as HTMLInputElement).value)"
            >
            <button class="kv-remove" @click="removeProviderHeader(p.id, key as string)">
              <X :size="12" :stroke-width="2.5" />
            </button>
          </div>
          <div class="kv-row">
            <input
              v-model="newHeaderKeys[p.id]"
              class="field-input field-input--mono"
              placeholder="Header-Name"
            >
            <input
              v-model="newHeaderValues[p.id]"
              class="field-input"
              placeholder="value"
            >
            <button
              class="kv-add-inline"
              :disabled="!newHeaderKeys[p.id]?.trim()"
              @click="addProviderHeader(p.id)"
            >
              <Plus :size="12" :stroke-width="2.5" />
            </button>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="footer-actions">
        <button class="delete-btn" @click="s.removeProvider(p.id)">
          <Trash2 :size="14" :stroke-width="2" />
          Delete
        </button>
        <button
          class="test-btn"
          :disabled="p.status === 'testing' || !p.baseURL.trim()"
          @click="s.testProvider(p.id)"
        >
          <Loader v-if="p.status === 'testing'" :size="14" class="spin" />
          <Zap v-else :size="14" :stroke-width="2" />
          Save Provider
        </button>
      </div>
    </template>
  </ProviderCard>
</template>

<style scoped>
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
}

.compat-logo-fallback {
  color: var(--color-text-dim);
}

.add-form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
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

.field-input--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.field-input--narrow {
  flex: 0 0 80px;
  min-width: 0;
  text-align: center;
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

.kv-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.kv-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kv-row .field-input {
  flex: 1;
  min-width: 0;
  height: 32px;
}

.kv-remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}

.kv-remove:hover {
  background: color-mix(in srgb, var(--color-danger-muted) 30%, transparent);
  color: var(--color-danger-text);
  border-color: var(--color-danger-muted);
}

.kv-add {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
  align-self: flex-start;
}

.kv-add:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-text-secondary);
  border-color: var(--color-border-strong);
}

.kv-add-inline {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 150ms ease;
}

.kv-add-inline:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-text-secondary);
  border-color: var(--color-border-strong);
}

.kv-add-inline:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.delete-btn:hover {
  background: color-mix(in srgb, var(--color-danger-muted) 25%, transparent);
  color: var(--color-danger-text);
  border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
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

@media (max-width: 768px) {
  .add-form-grid {
    grid-template-columns: 1fr;
  }
  .kv-row {
    flex-wrap: wrap;
  }
  .kv-row .field-input {
    flex: 1 1 40%;
  }
}
</style>
