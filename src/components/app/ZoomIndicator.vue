<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useZoom } from '@/composables/ui/useZoom'

const { zoomLevel, setZoom } = useZoom()

const visible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const percent = computed(() => Math.round(zoomLevel.value * 100))

watch(zoomLevel, () => {
  visible.value = true
  if (hideTimer)
    clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { visible.value = false }, 1500)
})

function zoomIn() {
  setZoom(+(zoomLevel.value + 0.1).toFixed(2))
}

function zoomOut() {
  setZoom(+(zoomLevel.value - 0.1).toFixed(2))
}
</script>

<template>
  <Transition
    enter-active-class="transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
    enter-from-class="opacity-0 [transform:translateY(-12px)_scale(0.9)]"
    enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
    leave-active-class="transition-[opacity,transform] duration-250 ease-[cubic-bezier(0.7,0,0.84,0)]"
    leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
    leave-to-class="opacity-0 [transform:translateY(-12px)_scale(0.9)]"
  >
    <div
      v-if="visible"
      class="fixed top-3 left-1/2 -translate-x-1/2 z-[10030] flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--color-border-mid)] bg-[var(--color-bg-surface)] px-1 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.25)]"
    >
      <button
        class="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-transparent bg-transparent text-[var(--color-text-secondary)] cursor-pointer transition-[background,border-color,color] duration-100 hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)] active:scale-95"
        :disabled="zoomLevel <= 0.5"
        @click="zoomOut"
      >
        <Minus :size="13" :stroke-width="2.5" />
      </button>

      <span class="min-w-[48px] text-center text-[12px] font-semibold tabular-nums text-[var(--color-text-primary)] select-none">
        {{ percent }}%
      </span>

      <button
        class="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-transparent bg-transparent text-[var(--color-text-secondary)] cursor-pointer transition-[background,border-color,color] duration-100 hover:bg-[var(--color-state-hover)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)] active:scale-95"
        :disabled="zoomLevel >= 2.0"
        @click="zoomIn"
      >
        <Plus :size="13" :stroke-width="2.5" />
      </button>
    </div>
  </Transition>
</template>
