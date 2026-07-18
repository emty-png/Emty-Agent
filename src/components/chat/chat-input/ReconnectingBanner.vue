<script setup lang="ts">
import type { AgentStatus } from '@/stores/chat/types'
import { computed, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  agentStatus?: AgentStatus
}>()

const reconnectingState = computed(() => {
  if (props.agentStatus?.type === 'reconnecting') {
    return props.agentStatus
  }
  return null
})

// Countdown timer
const countdown = ref(0)
let countdownInterval: ReturnType<typeof setInterval> | null = null

watch(reconnectingState, state => {
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }

  if (state) {
    countdown.value = Math.ceil(state.nextRetryMs / 1000)
    countdownInterval = setInterval(() => {
      if (countdown.value > 0) {
        countdown.value--
      }
      else {
        clearInterval(countdownInterval!)
        countdownInterval = null
      }
    }, 1000)
  }
  else {
    countdown.value = 0
  }
}, { immediate: true })

onUnmounted(() => {
  if (countdownInterval) {
    clearInterval(countdownInterval)
  }
})
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    leave-active-class="transition-all duration-150 ease-in"
    enter-from-class="opacity-0 -translate-y-1"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <div
      v-if="reconnectingState"
      class="flex items-center justify-center gap-2 py-1.5 px-3 text-[12px] font-[var(--font-mono)] text-[var(--color-warning-text)] bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/20"
    >
      <svg
        class="animate-spin shrink-0"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
      <span>
        Reconnecting... attempt {{ reconnectingState.attempt }}/{{ reconnectingState.maxAttempts }}
        <template v-if="countdown > 0">
          (retry in {{ countdown }}s)
        </template>
      </span>
    </div>
  </Transition>
</template>
