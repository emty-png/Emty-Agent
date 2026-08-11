<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { Bug, ExternalLink, Github, X } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{
  close: []
  dismiss: []
}>()

const settings = useSettingsStore()
const neverShowAgain = ref(false)

const GITHUB_URL = 'https://github.com/emty-png/Emty-Agent'

async function openGitHub() {
  await openUrl(GITHUB_URL)
}

function applyNeverShow() {
  if (neverShowAgain.value)
    settings.dismissedBetaCloseNotice = true
}

function handleClose() {
  applyNeverShow()
  emit('close')
}

function handleDismiss() {
  applyNeverShow()
  emit('dismiss')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    handleDismiss()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-[opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-[opacity] duration-150 ease-[cubic-bezier(0.7,0,0.84,0)]"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        class="fixed inset-0 z-[99999] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] p-6"
        @click.self="handleDismiss"
        @keydown="onKeydown"
      >
        <Transition
          enter-active-class="transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          enter-from-class="opacity-0 [transform:scale(0.95)_translateY(8px)]"
          enter-to-class="opacity-100 [transform:scale(1)_translateY(0)]"
          leave-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.7,0,0.84,0)]"
          leave-from-class="opacity-100 [transform:scale(1)_translateY(0)]"
          leave-to-class="opacity-0 [transform:scale(0.95)_translateY(8px)]"
        >
          <div
            class="w-[380px] bg-(--color-bg-card) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_16px_48px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Beta feedback request"
          >
            <!-- header -->
            <div class="flex items-center justify-between px-5 pt-5 pb-1">
              <div class="flex items-center gap-2.5">
                <div class="flex items-center justify-center w-8 h-8 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]">
                  <Bug :size="16" :stroke-width="2" class="text-(--color-accent-text)" />
                </div>
                <h3 class="m-0 text-[14px] font-semibold text-(--color-text-primary) tracking-[0.01em]">
                  Emty Agent is in Beta
                </h3>
              </div>
              <button
                class="flex items-center justify-center w-7 h-7 border-none rounded-(--radius-md) bg-transparent text-(--color-text-tertiary) cursor-pointer transition-colors duration-120 hover:bg-(--color-state-hover) hover:text-(--color-text-primary)"
                aria-label="Close dialog"
                @click="handleDismiss"
              >
                <X :size="14" :stroke-width="2" />
              </button>
            </div>

            <!-- body -->
            <div class="px-5 pt-3 pb-4">
              <p class="m-0 text-[13px] leading-[1.6] text-(--color-text-secondary)">
                Found a bug, glitch, or anything that feels off? We'd love to hear about it.
              </p>
              <p class="mt-2.5 m-0 text-[13px] leading-[1.6] text-(--color-text-secondary)">
                No issue is too small &mdash; even a typo or odd colour helps us improve.
                Every report makes Emty Agent better for everyone.
              </p>

              <!-- GitHub link button -->
              <button
                class="flex items-center gap-2 w-full mt-4 h-[36px] px-3.5 border border-(--color-border-mid) rounded-(--radius-md) bg-(--color-state-hover) text-(--color-text-primary) text-[13px] font-medium cursor-pointer transition-[background,border-color,border-radius] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] hover:rounded-(--radius-lg) active:scale-[0.97]"
                @click="openGitHub"
              >
                <Github :size="14" :stroke-width="2" class="shrink-0 text-(--color-text-secondary)" />
                <span class="flex-1 text-left">Report an Issue on GitHub</span>
                <ExternalLink :size="13" :stroke-width="2" class="shrink-0 text-(--color-text-tertiary)" />
              </button>
            </div>

            <!-- footer -->
            <div class="flex items-center justify-between px-5 py-3.5 border-t border-(--color-border-mid) bg-[color-mix(in_srgb,var(--color-bg-base)_30%,var(--color-bg-card))]">
              <label class="flex items-center gap-2 cursor-pointer select-none group">
                <div class="relative flex items-center justify-center w-[18px] h-[18px]">
                  <input
                    v-model="neverShowAgain"
                    type="checkbox"
                    class="absolute inset-0 cursor-pointer z-10 opacity-0 w-full h-full"
                  >
                  <div class="w-[18px] h-[18px] rounded-[5px] border border-(--color-border-bright) bg-(--color-bg-card) transition-[background,border-color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]" :class="neverShowAgain ? 'bg-(--color-accent) border-(--color-accent)' : ''">
                    <svg v-show="neverShowAgain" class="w-full h-full text-white p-[3px]" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </div>
                </div>
                <span class="text-[12px] text-(--color-text-tertiary) group-hover:text-(--color-text-secondary) transition-colors duration-120">Don't show again</span>
              </label>

              <div class="flex items-center gap-2">
                <button
                  class="flex items-center justify-center h-[30px] px-3.5 border border-(--color-border-mid) rounded-(--radius-md) bg-transparent text-(--color-text-secondary) text-[13px] font-medium cursor-pointer transition-[background,border-color,border-radius,color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg) hover:text-(--color-text-primary) active:scale-[0.97]"
                  @click="handleDismiss"
                >
                  Keep Open
                </button>
                <button
                  class="flex items-center justify-center h-[30px] px-3.5 border border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-(--color-accent-text) text-[13px] font-semibold cursor-pointer transition-[background,border-color,border-radius] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] hover:border-(--color-accent) hover:rounded-(--radius-lg) active:scale-[0.97]"
                  @click="handleClose"
                >
                  Close App
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
