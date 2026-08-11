<script setup lang="ts">
import type { Checkpoint } from '@/stores/checkpoints'
import { History, RotateCcw } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
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
  _confirmTimer = setTimeout(() => { confirming.value = false }, 4000)
}

async function confirmRestore(id: string) {
  if (restoring.value)
    return
  restoring.value = true
  emit('restore', id)

  if (_restoreTimer)
    clearTimeout(_restoreTimer)
  // Brief delay before resetting so the UI can show confirmation; parent handles actual restore.
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

const rootClasses = computed(() => {
  const base = 'flex items-center gap-0 w-full min-w-0 py-0.5 select-none transition-opacity duration-200 ease-[ease] hover:opacity-100'
  if (props.disabled)
    return `${base} pointer-events-none opacity-25`
  if (confirming.value)
    return `${base} opacity-100`
  return `${base} opacity-45`
})

const restoreLineClasses = 'flex-1 min-w-0 h-px border-t border-dashed border-(--color-border-mid) opacity-50'
const restoreLabelClasses = 'flex items-center gap-[5px] px-2.5 text-(--color-text-dim) shrink min-w-0'
const restoreLabelTextClasses = 'text-[11px] font-semibold tracking-[0.04em] uppercase overflow-hidden text-ellipsis'
const restoreWrapperClasses = 'relative flex items-center justify-end pl-1.5 min-w-0 overflow-hidden'

function getWrapperStateClasses(hidden: boolean): string {
  const base = '[transition:opacity_150ms_ease,transform_150ms_ease,visibility_150ms] [transform-origin:center_right]'
  return hidden ? `${base} opacity-0 pointer-events-none absolute top-0 right-0 scale-[0.96] invisible` : base
}

function getActionsClasses(hidden: boolean): string {
  return `flex items-center ${getWrapperStateClasses(hidden)}`
}

function getConfirmClasses(hidden: boolean): string {
  return `flex items-center gap-1.5 flex-wrap min-w-0 ${getWrapperStateClasses(hidden)}`
}

const restoreBtnClasses = 'flex items-center gap-1 h-[22px] px-2 border border-transparent rounded-(--radius-sm) bg-transparent text-(--color-text-dim) text-[11px] font-semibold font-[inherit] cursor-pointer tracking-[0.02em] whitespace-nowrap transition-[color,background,border-color] duration-150 ease-[ease] enabled:hover:text-(--color-accent-text) enabled:hover:bg-(--color-accent-muted) enabled:hover:border-(--color-accent-dim) disabled:cursor-not-allowed disabled:opacity-40'

const restoreConfirmTextClasses = 'text-[11px] text-(--color-text-secondary) whitespace-normal min-w-0'

const restoreConfirmYesClasses = 'flex items-center h-[22px] px-2.5 border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] rounded-(--radius-sm) bg-(--color-accent-muted) text-(--color-accent-text) text-[11px] font-bold font-[inherit] cursor-pointer whitespace-nowrap transition-[background,border-color] duration-[120ms] ease-[ease] enabled:hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] enabled:hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)] disabled:opacity-60 disabled:cursor-wait'

const restoreConfirmNoClasses = 'flex items-center h-[22px] px-2 border border-transparent rounded-(--radius-sm) bg-transparent text-(--color-text-tertiary) text-[11px] font-medium font-[inherit] cursor-pointer whitespace-nowrap transition-[color,background] duration-[120ms] ease-[ease] enabled:hover:text-(--color-text-secondary) enabled:hover:bg-(--color-state-hover)'
</script>

<template>
  <div :class="rootClasses">
    <div :class="restoreLineClasses" />

    <div :class="restoreLabelClasses">
      <History :size="12" :stroke-width="2" />
      <span :class="restoreLabelTextClasses">Checkpoint</span>
    </div>

    <div :class="restoreLineClasses" />

    <!-- Pure CSS (not Vue <Transition>) to avoid blocking unmount lifecycle during tab switches. -->
    <div :class="restoreWrapperClasses">
      <div :class="getActionsClasses(confirming)">
        <button
          :class="restoreBtnClasses"
          :disabled="disabled"
          :title="disabled ? 'Cannot restore while streaming' : 'Restore to this checkpoint'"
          @click="requestRestore(checkpoint.id)"
        >
          <RotateCcw :size="11" :stroke-width="2.5" />
          <span>Restore</span>
        </button>
      </div>

      <div :class="getConfirmClasses(!confirming)">
        <span :class="restoreConfirmTextClasses">Restore files &amp; remove messages after this point?</span>
        <button
          :class="restoreConfirmYesClasses"
          :disabled="restoring"
          @click="confirmRestore(checkpoint.id)"
        >
          {{ restoring ? 'Restoring…' : 'Yes, restore' }}
        </button>
        <button
          :class="restoreConfirmNoClasses"
          :disabled="restoring"
          @click="cancelConfirm"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
