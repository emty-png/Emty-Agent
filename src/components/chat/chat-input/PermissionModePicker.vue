<script setup lang="ts">
import { ChevronDown, Hand, HandFist } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

defineProps<{
  isPlanMode?: boolean
  compact?: boolean
}>()

const settings = useSettingsStore()
const permOpen = ref(false)

function togglePerm() {
  permOpen.value = !permOpen.value
}

function selectPerm(mode: 'ask' | 'auto') {
  settings.agent.permissionMode = mode
  permOpen.value = false
}

function onPermKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && permOpen.value) {
    permOpen.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onPermKeydown))
onUnmounted(() => window.removeEventListener('keydown', onPermKeydown))
</script>

<template>
  <div class="relative flex items-center gap-2">
    <!-- Plan Mode Chip -->
    <div v-if="isPlanMode" class="inline-flex items-center px-2 py-1 bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] text-(--color-accent) rounded-(--radius-sm) text-[11px] font-bold uppercase tracking-[0.05em]">
      <span>Plan Mode</span>
    </div>

    <!-- Trigger Button -->
    <button
      class="flex items-center justify-center gap-1.5 h-[30px] border rounded-(--radius-md) text-[13px] font-semibold tracking-[0.01em] cursor-pointer shrink-0 transition-[background,border-color,border-radius,color] duration-[120ms] active:scale-[0.97]"
      :class="[
        compact ? 'px-2' : 'px-2.5',
        settings.agent.permissionMode === 'auto'
          ? (permOpen
            ? 'text-(--color-warning-text) bg-[color-mix(in_srgb,var(--color-warning-text)_8%,transparent)] border-[color-mix(in_srgb,var(--color-warning-text)_30%,transparent)] rounded-(--radius-lg)'
            : 'text-(--color-warning-text) bg-transparent border-transparent hover:bg-[color-mix(in_srgb,var(--color-warning-text)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--color-warning-text)_30%,transparent)] hover:rounded-(--radius-lg)')
          : (permOpen
            ? 'text-(--color-text-primary) bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg)'
            : 'text-(--color-text-primary) bg-transparent border-transparent hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)'),
      ]"
      aria-label="Permission mode"
      @click="togglePerm"
    >
      <component :is="settings.agent.permissionMode === 'auto' ? HandFist : Hand" :size="12" :stroke-width="2" />
      <span v-if="!compact">{{ settings.agent.permissionMode === 'auto' ? 'Yolo' : 'Ask' }}</span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        class="shrink-0 transition-transform duration-200"
        :class="[
          permOpen ? 'rotate-180' : '',
          settings.agent.permissionMode === 'auto' ? 'text-[color-mix(in_srgb,var(--color-warning-text)_70%,transparent)]' : 'text-(--color-text-tertiary)',
        ]"
      />
    </button>

    <!--
      POSITIONING WRAPPER
      This div guarantees it perfectly centers above the button statically.
      By keeping it separate from the animation below, CSS transforms NEVER conflict!
    -->
    <div class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10000]">
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-out origin-bottom"
        leave-active-class="transition-[opacity,transform] duration-100 ease-in origin-bottom"
        enter-from-class="opacity-0 translate-y-2 scale-96"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-2 scale-96"
      >
        <!-- The Animated Dropdown -->
        <div
          v-if="permOpen"
          class="w-[148px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] p-1 flex flex-col gap-0.5"
        >
          <!-- Ask Option (Includes Active Styling) -->
          <button
            class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
            :class="settings.agent.permissionMode === 'ask'
              ? 'bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:border-(--color-accent)'
              : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
            @click="selectPerm('ask')"
          >
            <Hand :size="13" :stroke-width="2" />
            <span>Ask Permission</span>
          </button>

          <!-- Auto Option (Includes Danger Active Styling) -->
          <button
            class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
            :class="settings.agent.permissionMode === 'auto'
              ? 'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] border-(--color-danger) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:border-(--color-danger)'
              : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
            @click="selectPerm('auto')"
          >
            <HandFist :size="13" :stroke-width="2" />
            <span>Yolo</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Invisible Backdrop to detect outside clicks -->
    <div v-if="permOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="permOpen = false" />
  </div>
</template>
