<script setup lang="ts">
import type { MDevPreset } from '@/utils/modelsdev'
import { Loader, X } from 'lucide-vue-next'
import { ref } from 'vue'

defineProps<{
  provider: MDevPreset
  iconUrl: string
  failedIcon: boolean
  formError: string
  submitting: boolean
}>()

const emit = defineEmits<{
  collapse: []
  submit: [apiKey: string]
}>()

const apiKey = ref('')
</script>

<template>
  <div class="browser-card-expanded">
    <div class="browser-card-header">
      <div class="browser-card-icon">
        <img
          v-if="!failedIcon"
          :src="iconUrl"
          :alt="provider.name"
        >
        <span v-else class="browser-card-fallback">{{ provider.name[0] }}</span>
      </div>
      <span class="browser-card-name">{{ provider.name }}</span>
      <button class="browser-card-collapse" aria-label="Collapse" @click="emit('collapse')">
        <X :size="14" :stroke-width="2" />
      </button>
    </div>
    <div class="browser-form">
      <label class="browser-form-label">
        <span class="browser-form-label-text">API Key</span>
        <input
          v-model="apiKey"
          class="browser-form-input"
          placeholder="sk-..."
          type="password"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
      <div class="browser-form-actions">
        <span v-if="formError" class="browser-form-error">{{ formError }}</span>
        <button
          class="browser-form-submit"
          :disabled="submitting"
          @click="emit('submit', apiKey)"
        >
          <Loader v-if="submitting" :size="14" class="spin" />
          <span v-else>Add Provider</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.browser-card-icon img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.browser-card-fallback {
  font-size: 14px;
  font-weight: 700;
  color: #333;
}

.browser-card-name {
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
