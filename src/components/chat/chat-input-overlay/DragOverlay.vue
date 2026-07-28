<script setup lang="ts">
import type { DragPreview } from '@/composables/ui/useDragDrop'
import { FileText, Upload } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  previews: DragPreview[]
  reading?: boolean
}>()

const visiblePreviews = computed(() => props.previews.slice(0, 6))
const remainingCount = computed(() => Math.max(0, props.previews.length - 6))
const fileCount = computed(() => props.previews.length)

const statusText = computed(() => {
  if (props.reading)
    return 'Reading files…'
  if (fileCount.value === 1)
    return 'Drop to attach'
  return `Drop to attach ${fileCount.value} files`
})

function extFromName(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'tiff', 'heic', 'heif'])
const CODE_EXTS = new Set(['ts', 'js', 'jsx', 'tsx', 'vue', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'cpp', 'c', 'h', 'hpp', 'sh', 'bash', 'zsh', 'ps1'])
const DOC_EXTS = new Set(['md', 'mdx', 'txt', 'log', 'cfg', 'ini', 'env', 'toml', 'yaml', 'yml', 'json', 'xml', 'csv', 'sql'])

function fileCategory(name: string): 'image' | 'code' | 'doc' | 'file' {
  const ext = extFromName(name)
  if (IMAGE_EXTS.has(ext))
    return 'image'
  if (CODE_EXTS.has(ext))
    return 'code'
  if (DOC_EXTS.has(ext))
    return 'doc'
  return 'file'
}

const categoryColors: Record<'image' | 'code' | 'doc' | 'file', { bg: string; border: string; icon: string }> = {
  image: {
    bg: 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]',
    border: 'border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]',
    icon: 'text-[var(--color-accent-bright)]',
  },
  code: {
    bg: 'bg-[color-mix(in_srgb,#a78bfa_10%,transparent)]',
    border: 'border-[color-mix(in_srgb,#a78bfa_30%,transparent)]',
    icon: 'text-[#a78bfa]',
  },
  doc: {
    bg: 'bg-[color-mix(in_srgb,#60a5fa_10%,transparent)]',
    border: 'border-[color-mix(in_srgb,#60a5fa_30%,transparent)]',
    icon: 'text-[#60a5fa]',
  },
  file: {
    bg: 'bg-[var(--color-state-hover)]',
    border: 'border-[var(--color-border-subtle)]',
    icon: 'text-[var(--color-text-tertiary)]',
  },
}
</script>

<template>
  <div class="drag-overlay-root relative w-full rounded-(--radius-lg) mb-2 overflow-hidden">
    <!-- Outer glow ring -->
    <div class="absolute -inset-px rounded-[inherit] opacity-60 drag-glow-ring pointer-events-none" />

    <!-- Main card -->
    <div class="relative flex flex-col items-center gap-4 px-6 py-6 rounded-(--radius-lg) border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] drag-glass">
      <!-- Drop zone indicator -->
      <div class="relative flex items-center justify-center w-16 h-16 rounded-2xl drag-icon-ring">
        <template v-if="reading">
          <svg viewBox="0 0 28 28" width="22" height="22" class="animate-spin">
            <defs>
              <linearGradient id="gs-drag" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.1" />
                <stop offset="50%" style="stop-color: var(--color-accent-bright); stop-opacity: 0.5" />
                <stop offset="100%" style="stop-color: var(--color-accent-bright); stop-opacity: 1" />
              </linearGradient>
            </defs>
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--color-border-subtle)" stroke-width="2.5" />
            <circle cx="14" cy="14" r="11" fill="none" stroke="url(#gs-drag)" stroke-width="2.5" stroke-linecap="round" />
          </svg>
        </template>
        <Upload v-else :size="22" class="text-[var(--color-accent-bright)] drag-icon-breathe" :stroke-width="2" />
      </div>

      <!-- File previews -->
      <div v-if="visiblePreviews.length > 0" class="flex items-stretch gap-2 flex-wrap justify-center">
        <TransitionGroup
          enter-active-class="transition-[opacity,transform] duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-1 scale-[0.96]"
          enter-to-class="opacity-100 translate-y-0 scale-100"
        >
          <div
            v-for="(file, idx) in visiblePreviews"
            :key="file.id"
            class="drag-file-card group flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-[border-color,box-shadow] duration-150"
            :class="[
              categoryColors[fileCategory(file.name)].bg,
              categoryColors[fileCategory(file.name)].border,
            ]"
            :style="{ transitionDelay: `${idx * 40}ms` }"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              :class="categoryColors[fileCategory(file.name)].bg"
            >
              <FileText
                :size="15"
                :class="categoryColors[fileCategory(file.name)].icon"
                :stroke-width="1.6"
              />
            </div>
            <div class="flex flex-col min-w-0 max-w-[130px]">
              <span class="text-[11.5px] font-semibold text-[var(--color-text-primary)] truncate leading-tight">{{ file.name }}</span>
              <span class="text-[10px] text-[var(--color-text-tertiary)] leading-tight mt-0.5">{{ extFromName(file.name).toUpperCase() || 'FILE' }}</span>
            </div>
          </div>
        </TransitionGroup>

        <div
          v-if="remainingCount > 0"
          class="flex items-center justify-center px-3 rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] drag-badge-pop"
        >
          <span class="text-[12px] font-bold text-[var(--color-accent-bright)]">+{{ remainingCount }}</span>
        </div>
      </div>

      <!-- Status -->
      <div class="flex flex-col items-center gap-1">
        <span class="text-[13px] font-semibold text-[var(--color-text-primary)] tracking-wide">{{ statusText }}</span>
        <span v-if="!reading" class="text-[11px] text-[var(--color-text-tertiary)]">Release to add files to your message</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Glass card */
.drag-glass {
  background: color-mix(in srgb, var(--color-bg-card) 88%, transparent);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
}

/* Outer glow ring that pulses */
.drag-glow-ring {
  background: conic-gradient(
    from 0deg,
    transparent 0%,
    color-mix(in srgb, var(--color-accent) 25%, transparent) 25%,
    transparent 50%,
    color-mix(in srgb, var(--color-accent) 25%, transparent) 75%,
    transparent 100%
  );
  animation: ringSpin 4s linear infinite;
  filter: blur(1px);
}

@keyframes ringSpin {
  to {
    transform: rotate(360deg);
  }
}

/* Icon ring */
.drag-icon-ring {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  border: 1.5px dashed color-mix(in srgb, var(--color-accent) 35%, transparent);
  animation: iconRingPulse 2.5s ease-in-out infinite;
}

@keyframes iconRingPulse {
  0%,
  100% {
    border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 0%, transparent);
  }
  50% {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    box-shadow: 0 0 24px -4px color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
}

/* Breathing icon animation */
.drag-icon-breathe {
  animation: iconBreathe 2.5s ease-in-out infinite;
}

@keyframes iconBreathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

/* Badge pop-in */
.drag-badge-pop {
  animation: badgePop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes badgePop {
  0% {
    opacity: 0;
    transform: scale(0.7);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/* File card hover glow */
.drag-file-card:hover {
  box-shadow: 0 0 12px -2px color-mix(in srgb, var(--color-accent) 12%, transparent);
}
</style>
