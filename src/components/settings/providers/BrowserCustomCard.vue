<script setup lang="ts">
import { Loader, Plus, X } from 'lucide-vue-next'
import { ref } from 'vue'

export interface CustomProviderData {
  name: string
  id: string
  baseURL: string
  apiKey: string
  headers: Record<string, string>
  models: Array<{ id: string; name: string; contextLimit?: number }>
}

const emit = defineEmits<{
  submit: [data: CustomProviderData]
}>()

// form state
const expanded = ref(false)
const formName = ref('')
const formId = ref('')
const formBaseURL = ref('')
const formApiKey = ref('')
const formError = ref('')
const submitting = ref(false)
const idManuallyEdited = ref(false)
const formModels = ref<Array<{ id: string; name: string; contextLimit: string }>>([])
const formHeaders = ref<Array<{ key: string; value: string }>>([])

function expand() {
  expanded.value = true
  formName.value = ''
  formId.value = ''
  formBaseURL.value = ''
  formApiKey.value = ''
  formError.value = ''
  idManuallyEdited.value = false
  formModels.value = []
  formHeaders.value = []
}

function collapse() {
  expanded.value = false
  formError.value = ''
}

function onNameInput() {
  if (!idManuallyEdited.value)
    formId.value = formName.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function onIdInput() {
  idManuallyEdited.value = true
}

function addModelRow() {
  formModels.value.push({ id: '', name: '', contextLimit: '' })
}

function removeModelRow(i: number) {
  formModels.value.splice(i, 1)
}

function addHeaderRow() {
  formHeaders.value.push({ key: '', value: '' })
}

function removeHeaderRow(i: number) {
  formHeaders.value.splice(i, 1)
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function submit() {
  formError.value = ''

  if (!formName.value.trim()) {
    formError.value = 'Name is required'
    return
  }
  if (!formBaseURL.value.trim()) {
    formError.value = 'Base URL is required'
    return
  }

  const name = formName.value.trim()
  const id = formId.value.trim() || slugifyName(name)

  if (!/^[a-z0-9_-]+$/.test(id)) {
    formError.value = 'ID must be lowercase letters, numbers, hyphens, or underscores'
    return
  }

  submitting.value = true
  try {
    const headers = formHeaders.value
      .filter(h => h.key.trim())
      .reduce<Record<string, string>>((acc, h) => { acc[h.key.trim()] = h.value.trim(); return acc }, {})
    const models = formModels.value
      .filter(m => m.id.trim())
      .map(m => ({
        id: m.id.trim(),
        name: m.name.trim() || m.id.trim(),
        ...(m.contextLimit.trim() ? { contextLimit: Number(m.contextLimit) } : {}),
      }))

    emit('submit', {
      name,
      id,
      baseURL: formBaseURL.value.trim(),
      apiKey: formApiKey.value.trim(),
      headers,
      models,
    })

    expanded.value = false
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- collapsed -->
  <button
    v-if="!expanded"
    class="browser-card browser-card--custom"
    @click="expand"
  >
    <div class="browser-card-icon browser-card-icon--custom">
      <Plus :size="20" :stroke-width="1.8" />
    </div>
    <span class="browser-card-name">Custom</span>
  </button>

  <!-- expanded -->
  <div v-else class="browser-card-expanded">
    <div class="browser-card-header">
      <div class="browser-card-icon browser-card-icon--custom">
        <Plus :size="20" :stroke-width="1.8" />
      </div>
      <span class="browser-card-name browser-card-name--expanded">Custom Provider</span>
      <button class="browser-card-collapse" aria-label="Collapse" @click="collapse">
        <X :size="14" :stroke-width="2" />
      </button>
    </div>
    <div class="browser-form">
      <label class="browser-form-label">
        <span class="browser-form-label-text">Name</span>
        <input
          v-model="formName"
          class="browser-form-input"
          placeholder="My Provider"
          autocomplete="off"
          spellcheck="false"
          @input="onNameInput"
        >
      </label>
      <label class="browser-form-label">
        <span class="browser-form-label-text">Provider ID</span>
        <input
          v-model="formId"
          class="browser-form-input browser-form-input--mono"
          placeholder="myprovider"
          autocomplete="off"
          spellcheck="false"
          @input="onIdInput"
        >
        <span class="browser-form-hint">Lowercase letters, numbers, hyphens, or underscores</span>
      </label>
      <label class="browser-form-label">
        <span class="browser-form-label-text">Base URL</span>
        <input
          v-model="formBaseURL"
          class="browser-form-input"
          placeholder="https://api.example.com/v1"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
      <label class="browser-form-label">
        <span class="browser-form-label-text">API Key</span>
        <input
          v-model="formApiKey"
          class="browser-form-input"
          placeholder="sk-..."
          type="password"
          autocomplete="off"
          spellcheck="false"
        >
      </label>

      <!-- Models -->
      <div class="browser-form-section">
        <label class="field-label">Models <span class="field-optional">optional, auto-discovered from models.dev</span></label>
        <div v-for="(m, i) in formModels" :key="i" class="kv-row">
          <input v-model="m.id" class="browser-form-input browser-form-input--mono" placeholder="model-id">
          <input v-model="m.name" class="browser-form-input" placeholder="Display name (optional)">
          <input v-model="m.contextLimit" class="browser-form-input browser-form-input--mono" placeholder="ctx">
          <button class="kv-remove" @click="removeModelRow(i)">
            <X :size="12" :stroke-width="2" />
          </button>
        </div>
        <button class="kv-add" @click="addModelRow">
          <Plus :size="12" :stroke-width="2.5" />
          Add model
        </button>
      </div>

      <!-- Headers -->
      <div class="browser-form-section">
        <label class="field-label">Headers <span class="field-optional">optional, sent with every request</span></label>
        <div v-for="(h, i) in formHeaders" :key="i" class="kv-row">
          <input v-model="h.key" class="browser-form-input browser-form-input--mono" placeholder="Header-Name">
          <input v-model="h.value" class="browser-form-input" placeholder="Value">
          <button class="kv-remove" @click="removeHeaderRow(i)">
            <X :size="12" :stroke-width="2" />
          </button>
        </div>
        <button class="kv-add" @click="addHeaderRow">
          <Plus :size="12" :stroke-width="2.5" />
          Add header
        </button>
      </div>

      <div class="browser-form-actions">
        <span v-if="formError" class="browser-form-error">{{ formError }}</span>
        <button
          class="browser-form-submit"
          :disabled="submitting"
          @click="submit"
        >
          <Loader v-if="submitting" :size="14" class="spin" />
          <span v-else>Add Provider</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 10px 14px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  cursor: pointer;
  transition: all 150ms ease;
  box-sizing: border-box;
}

.browser-card:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
}

.browser-card-icon {
  width: 32px;
  height: 32px;
  background: #ffffff;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  overflow: hidden;
}

.browser-card-icon--custom {
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
}

.browser-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-card-expanded {
  width: 100%;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  padding: 14px 16px;
  box-sizing: border-box;
}

.browser-card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}

.browser-card-name--expanded {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browser-card-collapse {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.browser-card-collapse:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.browser-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.browser-form-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.browser-form-label-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.browser-form-input {
  height: 34px;
  padding: 0 10px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 150ms ease;
}

.browser-form-input:focus {
  border-color: var(--color-accent-dim);
}

.browser-form-input::placeholder {
  color: var(--color-text-tertiary);
}

.browser-form-input--mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.browser-form-hint {
  font-size: 11px;
  color: var(--color-text-dim);
}

.browser-form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-optional {
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.kv-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.kv-row .browser-form-input {
  flex: 1;
  min-width: 0;
  height: 30px;
}

.kv-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.kv-remove:hover {
  background: var(--color-bg-hover);
  color: var(--color-danger-text);
}

.kv-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 120ms ease;
  align-self: flex-start;
}

.kv-add:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
  color: var(--color-text-secondary);
}

.browser-form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}

.browser-form-error {
  font-size: 12px;
  color: var(--color-danger-text);
  flex: 1;
}

.browser-form-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-bg-base);
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 150ms ease;
}

.browser-form-submit:hover {
  opacity: 0.9;
}

.browser-form-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
