<script setup lang="ts">
import { Check, Loader, TriangleAlert } from 'lucide-vue-next'

defineProps<{
  name: string
  url: string
  status: 'idle' | 'testing' | 'ok' | 'error'
  statusMessage?: string
  logoClass?: string
}>()
</script>

<template>
  <div class="provider-card">
    <div class="provider-card-header">
      <div class="provider-info">
        <div class="provider-logo" :class="logoClass">
          <slot name="logo" />
        </div>
        <div class="provider-text">
          <span class="provider-name">{{ name }}</span>
          <span class="provider-url">{{ url }}</span>
        </div>
      </div>

      <div class="header-right">
        <slot name="header-right">
          <div v-if="status !== 'idle'" class="status-badge" :class="`status-badge--${status}`">
            <Loader v-if="status === 'testing'" :size="13" class="spin" />
            <Check v-else-if="status === 'ok'" :size="13" />
            <TriangleAlert v-else :size="13" />
            <span>{{ status === 'testing' ? 'Testing...' : statusMessage }}</span>
          </div>
        </slot>
      </div>
    </div>

    <div class="provider-content">
      <slot name="fields" />
    </div>

    <div class="card-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.provider-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px; /* Better breathing room between header, fields, and footer */
}

.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.provider-logo {
  display: grid;
  place-items: center;
  width: 38px; /* Larger hit-box for the logo */
  height: 38px;
  border-radius: 8px;
  /* Distinct box to prevent logos from blending into the background */
  background: var(--color-bg-elevated, color-mix(in srgb, var(--color-bg-surface) 60%, transparent));
  border: 1px solid var(--color-border-mid);
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.02),
    0 1px 2px rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.provider-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-name {
  display: block;
  font-size: 14.5px;
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

/* Restyled Badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px; /* Removed 99px pill shape to match modern layouts */
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  max-width: 260px;
}

.status-badge span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge--testing {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-mid);
}

.status-badge--ok {
  background: color-mix(in srgb, var(--color-success-muted) 30%, transparent);
  color: var(--color-success-text);
  border: 1px solid var(--color-success-muted);
}

.status-badge--error {
  background: color-mix(in srgb, var(--color-danger-muted) 30%, transparent);
  color: var(--color-danger-text);
  border: 1px solid var(--color-danger-muted);
}

.provider-content {
  display: flex;
  flex-direction: column;
  gap: 16px; /* standardizes spacing for injected fields */
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

/* Hides the footer entirely if the parent doesn't provide slot content */
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
