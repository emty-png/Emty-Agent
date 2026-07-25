<script setup lang="ts">
import { Check, ChevronDown, ChevronUp, Loader, X } from 'lucide-vue-next'
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
          <span v-if="isExpanded" class="provider-url">{{ url }}</span>
        </div>
      </div>

      <div class="header-right">
        <slot name="actions" />

        <div v-if="status !== 'idle'" class="status-icon" :class="`status-icon--${status}`" :title="statusMessage">
          <Loader v-if="status === 'testing'" :size="16" class="spin" />
          <Check v-else-if="status === 'ok'" :size="16" />
          <X v-else :size="16" />
        </div>

        <button class="configure-btn" @click="isExpanded = !isExpanded">
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
  min-height: 44px; /* Reaches exactly 70px total card height in collapsed state (12px top/bottom padding + 44px header + 2px borders) */
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 14px;
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
