<script setup lang="ts">
import { Check, ChevronDown, Copy } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  text: string
  wordCount: number
  streaming: boolean
  isOpen: boolean
  copied: boolean
}>()

const emit = defineEmits<{
  toggle: []
  copy: []
}>()

function formatTokenCount(count: number): string {
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1000)
    return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`
  return String(count)
}

const label = computed(() => {
  if (props.streaming)
    return null
  if (props.wordCount > 0)
    return `Thought for ~${formatTokenCount(props.wordCount)} words`
  return 'Thought for a moment'
})
</script>

<template>
  <div class="flex w-full flex-col">
    <button
      class="group/header -ml-[10px] inline-flex w-fit cursor-pointer select-none items-center justify-start gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-[10px] py-[6px] text-[var(--color-text-dim)] transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)] active:scale-[0.97]"
      @click="emit('toggle')"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="action-marker" aria-hidden="true" />
        <span
          v-if="streaming"
          class="whitespace-nowrap text-[13px] font-normal text-[var(--color-accent-text)]"
        >
          Thinking
          <span class="inline-block">
            <span class="inline-block translate-y-0 opacity-30 animate-[dot-bounce_1.4s_infinite] [animation-delay:0s]">.</span>
            <span class="inline-block translate-y-0 opacity-30 animate-[dot-bounce_1.4s_infinite] [animation-delay:0.15s]">.</span>
            <span class="inline-block translate-y-0 opacity-30 animate-[dot-bounce_1.4s_infinite] [animation-delay:0.3s]">.</span>
          </span>
        </span>
        <span v-else class="whitespace-nowrap text-[13px] font-normal text-current">{{ label }}</span>
      </div>

      <div
        class="flex items-center gap-1 transition-opacity duration-200 ease-[ease] group-hover/header:opacity-100"
        :class="isOpen ? 'opacity-100' : 'opacity-0'"
      >
        <button
          v-if="!streaming"
          class="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-current transition-all duration-150 ease-[ease] hover:scale-105 hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          :title="copied ? 'Copied!' : 'Copy reasoning'"
          @click.stop="emit('copy')"
        >
          <Check v-if="copied" :size="12" />
          <Copy v-else :size="12" />
        </button>
        <ChevronDown
          :size="14"
          class="shrink-0 text-current transition-transform duration-[400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          :class="isOpen ? 'rotate-180' : ''"
        />
      </div>
    </button>

    <div
      class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[400ms] ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[grid-template-rows]"
      :class="isOpen ? 'grid-rows-[1fr]' : ''"
    >
      <div
        class="min-h-0 -translate-y-1 overflow-hidden opacity-0 transition-[opacity,transform] duration-[250ms,400ms] ease-[ease,cubic-bezier(0.25,1,0.5,1)]"
        :class="isOpen ? 'translate-y-0 opacity-100 delay-[50ms,50ms] duration-[400ms,400ms]' : ''"
      >
        <div
          class="relative ml-[8.25px] flex flex-col border-l-[1.5px] border-[var(--color-border-subtle)] pb-[6px] pl-[14px] pt-[6px] transition-colors duration-300 ease-[ease]"
          :class="streaming ? 'before:absolute before:-left-[1.75px] before:bottom-0 before:top-0 before:z-[2] before:w-[2px] before:rounded-[2px] before:bg-[var(--color-accent)] before:opacity-[0.32] before:shadow-[0_0_10px_var(--color-accent)] before:content-[\'\']' : ''"
        >
          <div class="whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-[var(--color-text-tertiary)] antialiased [text-rendering:optimizeLegibility]">
            {{ text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/*
  Unscoped global style block to ensure keyframes are available to
  arbitrary Tailwind animation values. Unused classes (.matrix-sweep)
  from the original were removed.
*/
@keyframes dot-bounce {
  0%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-1.5px);
  }
}
</style>
