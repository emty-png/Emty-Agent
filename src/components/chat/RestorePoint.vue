<script setup lang="ts">
import type { Checkpoint } from '@/stores/checkpoints'
import { History, RotateCcw } from 'lucide-vue-next'
import { onBeforeUnmount, ref } from 'vue'

defineProps<{
  checkpoint: Checkpoint
  disabled: boolean
}>()

const emit = defineEmits<{
  restore: [checkpointId: string]
}>()

const confirming = ref(false)
const restoring = ref(false)

let _confirmTimer: ReturnType<typeof setTimeout> | null = null
let _restoreTimer: ReturnType<typeof setTimeout> | null = null

function requestRestore(_id: string) {
  if (restoring.value)
    return
  confirming.value = true

  if (_confirmTimer)
    clearTimeout(_confirmTimer)
  // Auto-dismiss confirmation after 4 seconds
  _confirmTimer = setTimeout(() => { confirming.value = false }, 4000)
}

async function confirmRestore(id: string) {
  if (restoring.value)
    return
  restoring.value = true
  emit('restore', id)

  if (_restoreTimer)
    clearTimeout(_restoreTimer)
  // Reset state after a short delay (parent will handle actual restoration)
  _restoreTimer = setTimeout(() => {
    restoring.value = false
    confirming.value = false
  }, 1500)
}

function cancelConfirm() {
  confirming.value = false
  if (_confirmTimer)
    clearTimeout(_confirmTimer)
}

// Clean up timers on unmount to prevent ghost state updates
onBeforeUnmount(() => {
  if (_confirmTimer)
    clearTimeout(_confirmTimer)
  if (_restoreTimer)
    clearTimeout(_restoreTimer)
})
</script>

<template>
  <div
    class="restore-point"
    :class="{
      'restore-point--confirming': confirming,
      'restore-point--disabled': disabled,
    }"
  >
    <div class="restore-line-left" />

    <div class="restore-label">
      <History :size="12" :stroke-width="2" />
      <span class="restore-label-text">Checkpoint</span>
    </div>

    <div class="restore-line-right" />

    <!--
      Replaced Vue <Transition> with pure CSS.
      This prevents the component from blocking Vue's unmount lifecycle during tab switches.
    -->
    <div class="restore-wrapper">
      <!-- Default state: subtle Restore button -->
      <div class="restore-actions" :class="{ 'is-hidden': confirming }">
        <button
          class="restore-btn"
          :disabled="disabled"
          :title="disabled ? 'Cannot restore while streaming' : 'Restore to this checkpoint'"
          @click="requestRestore(checkpoint.id)"
        >
          <RotateCcw :size="11" :stroke-width="2.5" />
          <span>Restore</span>
        </button>
      </div>

      <!-- Confirmation state -->
      <div class="restore-confirm" :class="{ 'is-hidden': !confirming }">
        <span class="restore-confirm-text">Restore files &amp; remove messages after this point?</span>
        <button
          class="restore-confirm-yes"
          :disabled="restoring"
          @click="confirmRestore(checkpoint.id)"
        >
          {{ restoring ? 'Restoring…' : 'Yes, restore' }}
        </button>
        <button
          class="restore-confirm-no"
          :disabled="restoring"
          @click="cancelConfirm"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.restore-point {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  padding: 2px 0;
  user-select: none;
  opacity: 0.45;
  transition: opacity 200ms ease;
}

.restore-point:hover,
.restore-point--confirming {
  opacity: 1;
}

.restore-point--disabled {
  pointer-events: none;
  opacity: 0.25;
}

/* ── dotted lines ──────────────────────────────────────────────────────────── */
.restore-line-left,
.restore-line-right {
  flex: 1;
  height: 1px;
  border-top: 1px dashed var(--color-border-mid);
  opacity: 0.5;
}

/* ── center label ──────────────────────────────────────────────────────────── */
.restore-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  color: var(--color-text-dim);
  flex-shrink: 0;
}

.restore-label-text {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* ── css transition wrappers ───────────────────────────────────────────────── */
.restore-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-left: 6px;
}

.restore-actions,
.restore-confirm {
  display: flex;
  align-items: center;
  transition:
    opacity 150ms ease,
    transform 150ms ease,
    visibility 150ms;
  transform-origin: center right;
}

.restore-confirm {
  gap: 6px;
}

/* Instead of vue transitioning, we absolutely position the hidden element */
.is-hidden {
  opacity: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  transform: scale(0.96);
  visibility: hidden;
}

/* ── restore button ────────────────────────────────────────────────────────── */
.restore-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.02em;
  white-space: nowrap;
  transition:
    color 150ms ease,
    background 150ms ease,
    border-color 150ms ease;
}

.restore-btn:hover:not(:disabled) {
  color: var(--color-accent-text);
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
}

.restore-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

/* ── confirmation bar ──────────────────────────────────────────────────────── */
.restore-confirm-text {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.restore-confirm-yes {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
  border-radius: var(--radius-sm);
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.restore-confirm-yes:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
}

.restore-confirm-yes:disabled {
  opacity: 0.6;
  cursor: wait;
}

.restore-confirm-no {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 120ms ease,
    background 120ms ease;
}

.restore-confirm-no:hover:not(:disabled) {
  color: var(--color-text-secondary);
  background: var(--color-state-hover);
}
</style>
