<script setup lang="ts">
import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const currentPermission = computed(() => chat.activeTab.pendingPermissions[0] ?? null)
const queueCount = computed(() => chat.activeTab.pendingPermissions.length)
</script>

<template>
  <div
    v-if="currentPermission"
    class="perm-overlay"
    role="dialog"
    aria-modal="false"
    aria-label="Tool permission required"
  >
    <div class="perm-header">
      <div class="perm-header-copy">
        <span class="perm-eyebrow">Tool permission required</span>
        <p class="perm-title">
          {{ currentPermission.actionTitle }}
        </p>
        <p class="perm-desc">
          {{ currentPermission.toolLabel }}
        </p>
        <p class="perm-tool-id">
          {{ currentPermission.toolName }}
        </p>
      </div>
      <div class="perm-badge-group">
        <div class="perm-badge">
          <ShieldAlert :size="14" />
          <span>Paused</span>
        </div>
        <div v-if="queueCount > 1" class="perm-queue-badge">
          +{{ queueCount - 1 }} more
        </div>
      </div>
    </div>

    <div class="perm-args">
      <p
        v-for="(detail, index) in currentPermission.actionDetails"
        :key="`${currentPermission.requestId}-${index}`"
        class="perm-detail"
      >
        {{ detail }}
      </p>
    </div>

    <div class="perm-actions">
      <button
        class="perm-btn perm-btn--deny"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'deny', currentPermission.requestId)"
      >
        <X :size="14" />
        <span>Deny</span>
      </button>
      <button
        class="perm-btn"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'allow-once', currentPermission.requestId)"
      >
        <Check :size="14" />
        <span>Allow Once</span>
      </button>
      <button
        class="perm-btn perm-btn--primary"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'allow-session', currentPermission.requestId)"
      >
        <ShieldCheck :size="14" />
        <span>Allow for this session</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.perm-overlay {
  width: 100%;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.perm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
}

.perm-header-copy {
  min-width: 0;
}

.perm-eyebrow {
  display: inline-block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.perm-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.perm-desc {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.perm-tool-id {
  margin: 8px 0 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.perm-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-warning) 16%, transparent);
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.perm-badge-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.perm-queue-badge {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.perm-args {
  margin: 0 16px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-state-hover);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.perm-detail {
  margin: 0;
}

.perm-actions {
  display: flex;
  gap: 8px;
  padding: 14px 16px 16px;
  flex-wrap: wrap;
}

.perm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding-inline: 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.perm-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.perm-btn--primary {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.perm-btn--primary:hover {
  background: color-mix(in srgb, var(--color-accent-muted) 90%, var(--color-bg-base) 10%);
}

.perm-btn--deny {
  color: var(--color-danger-text);
  border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-border-mid));
}

.perm-btn--deny:hover {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}
</style>
