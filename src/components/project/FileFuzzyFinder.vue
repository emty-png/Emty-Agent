<script setup lang="ts">
import { File, FileCode, FileText } from 'lucide-vue-next'
import { ref, watchEffect } from 'vue'
import { useProjectStore } from '@/stores/project'
import { highlightParts } from '@/utils/highlightParts'
import { getDeviconForFile } from '@/utils/icons'

const props = defineProps<{
  query: string
  selectedIdx: number
  filteredFiles: string[]
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  select: [filePath: string]
  hover: [idx: number]
  close: []
}>()

const project = useProjectStore()

// ── auto-scroll selected item into view ───────────────────────────────────────
const listRef = ref<HTMLElement | null>(null)

watchEffect(() => {
  const idx = props.selectedIdx
  const child = listRef.value?.children[idx] as HTMLElement | undefined
  child?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
})

// ── extract filename + relative parent for display ────────────────────────────
function splitPath(fullPath: string) {
  const normalized = fullPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const name = parts.pop() ?? fullPath
  const parent = parts.join('/')
  return { name, parent }
}

function getRelativeParent(fullPath: string): string {
  const root = (project.projectPath ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  const normalized = fullPath.replace(/\\/g, '/')
  const rootDir = root.split('/').pop() ?? ''
  if (normalized.startsWith(`${root}/`)) {
    const rel = normalized.slice(root.length + 1)
    const lastSlash = rel.lastIndexOf('/')
    if (lastSlash === -1)
      return rootDir
    return `${rootDir}/${rel.slice(0, lastSlash)}`
  }
  const parent = splitPath(fullPath).parent
  return parent ? `.../${parent.split('/').pop()}` : ''
}

function getIcon(name: string) {
  const devicon = getDeviconForFile(name)
  if (devicon)
    return { type: 'devicon' as const, class: devicon }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext))
    return { type: 'lucide' as const, component: FileCode }
  if (['md', 'mdx', 'txt', 'rst'].includes(ext))
    return { type: 'lucide' as const, component: FileText }
  return { type: 'lucide' as const, component: File }
}

const inputRef = ref<HTMLInputElement | null>(null)
</script>

<template>
  <div
    class="fixed inset-0 z-[2000] flex items-start justify-center pt-[18vh]"
    @click.self="emit('close')"
    @keydown="() => {}"
  >
    <div role="dialog" aria-modal="true" aria-label="Find file" class="w-[420px] max-h-[380px] rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden">
      <!-- search input -->
      <div class="px-3 pt-3 pb-2.5 shrink-0">
        <input
          ref="inputRef"
          :value="query"
          class="w-full h-[32px] rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-base)] px-[10px] text-[12.5px] text-[var(--color-text-primary)] outline-none box-border [transition:border-color_150ms_ease,box-shadow_150ms_ease] placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent-dim)] focus:shadow-[0_0_0_2px_var(--color-accent-muted)]"
          placeholder="Type to search files..."
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown.escape.prevent="emit('close')"
        >
      </div>

      <!-- results -->
      <div v-if="filteredFiles.length === 0" class="flex items-center justify-center h-[52px] px-4 border-t border-[var(--color-border-subtle)]">
        <span class="text-[12px] text-[var(--color-text-tertiary)]">No matching files</span>
      </div>

      <div
        v-else
        ref="listRef"
        class="flex flex-col overflow-y-auto min-h-0 border-t border-[var(--color-border-subtle)]"
        role="listbox"
        aria-label="File results"
      >
        <button
          v-for="(filePath, idx) in filteredFiles"
          :key="filePath"
          class="flex items-center gap-[8px] w-full h-[32px] min-h-[32px] px-[12px] border-none cursor-pointer text-left transition-[background] duration-[80ms] ease-[ease]"
          :class="idx === selectedIdx
            ? 'bg-[var(--color-accent-muted)]'
            : 'bg-transparent hover:bg-[var(--color-state-hover)]'"
          role="option"
          :aria-selected="idx === selectedIdx"
          @click="emit('select', filePath)"
          @mouseenter="emit('hover', idx)"
        >
          <!-- devicon icon -->
          <template v-if="getIcon(splitPath(filePath).name).type === 'devicon'">
            <i
              class="flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden text-[12px]" :class="[getIcon(splitPath(filePath).name).class]"
              :style="{ color: idx === selectedIdx ? 'var(--color-accent-text)' : 'var(--color-text-tertiary)' }"
            />
          </template>
          <!-- lucide fallback icon -->
          <template v-else>
            <component
              :is="getIcon(splitPath(filePath).name).component"
              :size="13"
              :stroke-width="1.6"
              class="shrink-0"
              :style="{ color: idx === selectedIdx ? 'var(--color-accent-text)' : 'var(--color-text-tertiary)' }"
            />
          </template>

          <div class="min-w-0 flex-1 overflow-hidden">
            <span class="text-[12px] whitespace-nowrap overflow-hidden text-ellipsis" :class="idx === selectedIdx ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'">
              <template v-for="(part, pi) in highlightParts(splitPath(filePath).name, query)" :key="pi">
                <span v-if="part.match" class="text-[var(--color-accent-text)] font-semibold">{{ part.text }}</span>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span class="text-[10px] whitespace-nowrap overflow-hidden text-ellipsis" :class="idx === selectedIdx ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-dim)]'">
              {{ getRelativeParent(filePath) }}
            </span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
