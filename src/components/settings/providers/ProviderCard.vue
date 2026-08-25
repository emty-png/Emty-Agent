<script setup lang="ts">
import { ChevronDown, ChevronUp, Loader } from 'lucide-vue-next'
import { ref } from 'vue'

defineProps<{
  name: string
  url: string
  status: 'idle' | 'testing' | 'ok' | 'error'
  statusMessage?: string
  logoClass?: string
}>()

const isExpanded = ref(false)
</script>

<template>
  <div class="provider-card" :class="{ 'is-expanded': isExpanded }">
    <div class="provider-card-header">
      <div class="provider-info">
        <div class="provider-logo" :class="logoClass">
          <slot name="logo" />
        </div>
        <div class="provider-text">
          <span class="provider-name">{{ name }}</span>
          <!-- Only show the URL if expanded to match the cleaner mockup -->
          <span v-if="isExpanded" class="provider-url" :title="url">{{ url }}</span>
        </div>
      </div>

      <div class="header-right">
        <slot name="actions" />

        <button
          class="configure-btn"
          :class="{
            'configure-btn--ok': status === 'ok',
            'configure-btn--error': status === 'error',
            'configure-btn--testing': status === 'testing',
          }"
          :title="statusMessage"
          @click="isExpanded = !isExpanded"
        >
          <Loader v-if="status === 'testing'" :size="14" class="spin" />
          Configure
          <ChevronUp v-if="isExpanded" :size="14" />
          <ChevronDown v-else :size="14" />
        </button>
      </div>
    </div>

    <div v-show="isExpanded" class="provider-content-wrapper">
      <div class="provider-content">
        <slot name="fields" />
      </div>

      <div class="card-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.provider-card {
  width: 100%;
  box-sizing: border-box;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: all 200ms ease;
}

.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  min-height: 44px;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.provider-logo {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: #ffffff;
  border: 1px solid var(--color-border-mid);
  flex-shrink: 0;
  overflow: hidden;
}

.provider-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.provider-name {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.provider-url {
  display: block;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.status-icon--testing {
  color: var(--color-text-secondary);
}

.status-icon--ok {
  color: var(--color-success-text);
  background: color-mix(in srgb, var(--color-success-muted) 30%, transparent);
}

.status-icon--error {
  color: var(--color-danger-text);
  background: color-mix(in srgb, var(--color-danger-muted) 30%, transparent);
}

.configure-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.configure-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
}

.configure-btn--ok {
  background: color-mix(in srgb, var(--color-success) 14%, var(--color-bg-elevated));
  border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
  color: var(--color-success-text);
}
.configure-btn--ok:hover {
  background: color-mix(in srgb, var(--color-success) 22%, var(--color-bg-elevated));
  border-color: var(--color-success);
}

.configure-btn--error {
  background: color-mix(in srgb, var(--color-danger) 10%, var(--color-bg-elevated));
  border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
  color: var(--color-danger-text);
}
.configure-btn--error:hover {
  background: color-mix(in srgb, var(--color-danger) 18%, var(--color-bg-elevated));
  border-color: var(--color-danger);
}

.configure-btn--testing {
  border-color: var(--color-warning);
  color: var(--color-warning-text);
}

.provider-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.provider-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

.card-footer:empty {
  display: none;
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
