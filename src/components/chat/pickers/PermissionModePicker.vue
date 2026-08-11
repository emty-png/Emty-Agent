<script setup lang="ts">
import { ChevronDown, Hand, HandFist, ShieldCheck } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

defineProps<{
  isPlanMode?: boolean
  compact?: boolean
}>()

const settings = useSettingsStore()
const chat = useChatStore()
const permOpen = ref(false)

// Per-tab override wins; falls back to global setting.
const permissionMode = computed<'ask' | 'auto' | 'yolo'>(
  () => chat.activeTab.permissionMode ?? settings.agent.permissionMode,
)

function togglePerm() {
  permOpen.value = !permOpen.value
}

function selectPerm(mode: 'ask' | 'auto' | 'yolo') {
  chat.activeTab.permissionMode = mode
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
    <div v-if="isPlanMode" class="inline-flex items-center px-2 py-1 bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] text-(--color-accent) rounded-(--radius-sm) text-[11px] font-bold uppercase tracking-[0.05em]">
      <span>Plan Mode</span>
    </div>

    <button
      class="flex items-center justify-center gap-1.5 h-[30px] border rounded-(--radius-md) text-[13px] font-semibold tracking-[0.01em] cursor-pointer shrink-0 transition-[background,border-color,border-radius,color] duration-[120ms] active:scale-[0.97]"
      :class="[
        compact ? 'px-2' : 'px-2.5',
        permissionMode === 'yolo'
          ? (permOpen
            ? 'text-(--color-warning-text) bg-[color-mix(in_srgb,var(--color-warning-text)_8%,transparent)] border-[color-mix(in_srgb,var(--color-warning-text)_30%,transparent)] rounded-(--radius-lg)'
            : 'text-(--color-warning-text) bg-transparent border-transparent hover:bg-[color-mix(in_srgb,var(--color-warning-text)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--color-warning-text)_30%,transparent)] hover:rounded-(--radius-lg)')
          : permissionMode === 'auto'
            ? (permOpen
              ? 'text-(--color-accent) bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] rounded-(--radius-lg)'
              : 'text-(--color-accent) bg-transparent border-transparent hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:rounded-(--radius-lg)')
            : (permOpen
              ? 'text-(--color-text-primary) bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg)'
              : 'text-(--color-text-primary) bg-transparent border-transparent hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)'),
      ]"
      aria-label="Permission mode"
      @click="togglePerm"
    >
      <component :is="permissionMode === 'yolo' ? HandFist : permissionMode === 'auto' ? ShieldCheck : Hand" :size="12" :stroke-width="2" />
      <span v-if="!compact">{{ permissionMode === 'yolo' ? 'Yolo' : permissionMode === 'auto' ? 'Auto' : 'Ask' }}</span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        class="shrink-0 transition-transform duration-200"
        :class="[
          permOpen ? 'rotate-180' : '',
          permissionMode === 'yolo' ? 'text-[color-mix(in_srgb,var(--color-warning-text)_70%,transparent)]' : permissionMode === 'auto' ? 'text-[color-mix(in_srgb,var(--color-accent)_70%,transparent)]' : 'text-(--color-text-tertiary)',
        ]"
      />
    </button>

    <!-- Separate from <Transition> so CSS centering transforms don't conflict with animation transforms -->
    <div class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10000]">
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
        enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
        enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
        leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
      >
        <div
          v-if="permOpen"
          class="w-[148px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] p-1 flex flex-col gap-0.5" role="menu"
        >
          <button
            class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
            :class="permissionMode === 'ask'
              ? 'bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:border-(--color-accent)'
              : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
            @click="selectPerm('ask')"
          >
            <Hand :size="13" :stroke-width="2" />
            <span>Ask Permission</span>
          </button>

          <button
            class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
            :class="permissionMode === 'auto'
              ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] border-(--color-accent) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] hover:border-(--color-accent)'
              : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
            @click="selectPerm('auto')"
          >
            <ShieldCheck :size="13" :stroke-width="2" />
            <span>Auto</span>
          </button>

          <button
            class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
            :class="permissionMode === 'yolo'
              ? 'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] border-(--color-danger) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:border-(--color-danger)'
              : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
            @click="selectPerm('yolo')"
          >
            <HandFist :size="13" :stroke-width="2" />
            <span>Yolo</span>
          </button>
        </div>
      </Transition>
    </div>

    <div v-if="permOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="permOpen = false" />
  </div>
</template>
