<script setup lang="ts">
import type { ToolEvent } from '@/stores/chat'
import { Brain, ChevronDown, ChevronRight, FileCode, FileText, Folder, Search, Terminal, Wrench } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import MarkdownMessage from './MarkdownMessage.vue'
import ThinkingMarkdown from './ThinkingMarkdown.vue'
import ToolCallBadge from './ToolCallBadge.vue'

interface ProcessedGroup {
  type: 'text' | 'reasoning' | 'tools'
  text: string
  hasText: boolean
  events: ToolEvent[]
  key: string
  streaming: boolean
  wordCount: number
}

interface BodyChunk {
  type: 'text' | 'actions'
  groups: ProcessedGroup[]
}

const props = defineProps<{
  items: ProcessedGroup[]
  streaming: boolean
  isOpen: boolean
  statusLabel?: string
  copied?: boolean
  hasRestText?: boolean
}>()

const emit = defineEmits<{
  toggle: []
  copy: []
}>()

// ── Body chunks: split interleaved items into text/actions segments ──

const bodyChunks = computed<BodyChunk[]>(() => {
  const chunks: BodyChunk[] = []
  let currentChunk: BodyChunk | null = null

  for (const group of props.items) {
    const isWork = group.type === 'tools' || group.type === 'reasoning'
    const chunkType = isWork ? 'actions' : 'text'

    if (!currentChunk || currentChunk.type !== chunkType) {
      currentChunk = { type: chunkType, groups: [] }
      chunks.push(currentChunk)
    }
    currentChunk.groups.push(group)
  }

  return chunks
})

// ── Per-actions-chunk summary pills ──

function computeSummaryParts(groups: ProcessedGroup[]) {
  const counts = new Map<string, number>()
  for (const item of groups) {
    if (item.type === 'reasoning') {
      counts.set('thought', (counts.get('thought') || 0) + 1)
    }
    else if (item.type === 'tools') {
      for (const ev of item.events) {
        const rawName = ev.toolName?.toLowerCase() || 'unknown'
        let mappedName = rawName

        if (rawName === 'mcp' || rawName.startsWith('mcp_'))
          mappedName = 'mcp'
        else if (rawName.includes('read') || rawName.includes('view'))
          mappedName = 'read'
        else if (rawName.includes('search') || rawName.includes('grep'))
          mappedName = 'search'
        else if (rawName.includes('replace') || rawName.includes('write') || rawName.includes('edit'))
          mappedName = 'edit'
        else if (rawName.includes('run') || rawName.includes('git') || rawName.includes('command') || rawName.includes('shell'))
          mappedName = 'run'
        else if (rawName.includes('list') || rawName.includes('dir'))
          mappedName = 'list'

        counts.set(mappedName, (counts.get(mappedName) || 0) + 1)
      }
    }
  }

  const parts = []
  if (counts.has('thought'))
    parts.push({ label: `Thought ${counts.get('thought')} time(s)`, icon: Brain })
  if (counts.has('read'))
    parts.push({ label: `Read ${counts.get('read')} file(s)`, icon: FileText })
  if (counts.has('search'))
    parts.push({ label: `Searched ${counts.get('search')} pattern(s)`, icon: Search })
  if (counts.has('edit'))
    parts.push({ label: `Edited ${counts.get('edit')} file(s)`, icon: FileCode })
  if (counts.has('run'))
    parts.push({ label: `Ran ${counts.get('run')} command(s)`, icon: Terminal })
  if (counts.has('list'))
    parts.push({ label: `Listed ${counts.get('list')} dir(s)`, icon: Folder })
  if (counts.has('mcp'))
    parts.push({ label: `MCP tool ran ${counts.get('mcp')} time(s)`, icon: Wrench })

  for (const [name, count] of counts.entries()) {
    if (!['thought', 'read', 'search', 'edit', 'run', 'list', 'mcp'].includes(name)) {
      let labelName = name.replace(/_/g, ' ')
      labelName = labelName.charAt(0).toUpperCase() + labelName.slice(1)
      parts.push({ label: `${labelName} ran ${count} time(s)`, icon: Wrench })
    }
  }

  return parts
}

// ── Per-actions-chunk open/close state ──

const actionsOpenStates = ref<boolean[]>([])

// Ensure we have a state per actions chunk, streaming → open
watch(
  [bodyChunks, () => props.streaming],
  ([chunks, streaming]) => {
    const actionsChunks = (chunks as BodyChunk[]).filter(c => c.type === 'actions')
    const states: boolean[] = []
    for (let i = 0; i < actionsChunks.length; i++) {
      const prev = actionsOpenStates.value[i]
      states.push(prev !== undefined ? prev : !!streaming)
    }
    actionsOpenStates.value = states
  },
  { immediate: true },
)

function isActionsOpen(chunkIdx: number): boolean {
  return actionsOpenStates.value[chunkIdx] ?? false
}

function toggleActions(chunkIdx: number) {
  actionsOpenStates.value[chunkIdx] = !actionsOpenStates.value[chunkIdx]
}

// When outer "Worked" block is expanded, also open all actions
watch(() => props.isOpen, open => {
  if (open) {
    actionsOpenStates.value = actionsOpenStates.value.map(() => true)
  }
})

// ── Smart preview: last text + last actions when collapsed ──

const lastTextChunk = computed(() => {
  const textChunks = bodyChunks.value.filter(c => c.type === 'text')
  return textChunks.length > 0 ? textChunks[textChunks.length - 1]! : null
})

const lastActionsChunk = computed(() => {
  const actionsChunks = bodyChunks.value.filter(c => c.type === 'actions')
  return actionsChunks.length > 0 ? actionsChunks[actionsChunks.length - 1]! : null
})

const hasSmartPreview = computed(() => {
  if (props.streaming || props.isOpen)
    return false
  if (props.hasRestText)
    return false
  return !!(lastTextChunk.value || lastActionsChunk.value)
})

const previewSummaryParts = computed(() => {
  if (!lastActionsChunk.value)
    return []
  return computeSummaryParts(lastActionsChunk.value.groups)
})

const previewActionsOpen = ref(false)
</script>

<template>
  <div class="flex w-full flex-col">
    <!-- ── Outer header: "Working…" (live) or "Worked for Xs" (done) ── -->
    <div
      v-if="streaming"
      class="group/header pointer-events-none -ml-2 flex min-h-[30px] w-[calc(100%+8px)] cursor-default select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-[5px] text-left text-[var(--color-text-dim)]"
      aria-live="polite"
    >
      <span class="whitespace-nowrap text-[13px] font-normal text-[var(--color-accent-text)]">
        Working
        <span class="inline-block" aria-hidden="true">
          <span class="inline-block opacity-40 animate-[dot-pop_1.4s_ease-in-out_infinite] [animation-delay:0s] motion-reduce:animate-none motion-reduce:opacity-[0.85]">.</span><span class="inline-block opacity-40 animate-[dot-pop_1.4s_ease-in-out_infinite] [animation-delay:0.14s] motion-reduce:animate-none motion-reduce:opacity-[0.85]">.</span><span class="inline-block opacity-40 animate-[dot-pop_1.4s_ease-in-out_infinite] [animation-delay:0.28s] motion-reduce:animate-none motion-reduce:opacity-[0.85]">.</span>
        </span>
      </span>
    </div>

    <button
      v-else
      class="group/header -ml-2 flex min-h-[30px] w-[calc(100%+8px)] cursor-pointer select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-[5px] text-left text-[var(--color-text-dim)] transition-[color,background,border-color,transform] duration-150 ease-[ease] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)] active:scale-[0.98]"
      :aria-expanded="isOpen"
      @click="emit('toggle')"
    >
      <span class="whitespace-nowrap text-[13px] font-medium text-[var(--color-text-dim)]">{{ statusLabel || 'Worked' }}</span>
      <ChevronDown
        :size="13"
        class="shrink-0 text-inherit opacity-0 transition-[transform,opacity] duration-[350ms,150ms] ease-[cubic-bezier(0.34,1.56,0.64,1),ease] motion-reduce:transition-none group-hover/header:opacity-75"
        :class="isOpen ? 'rotate-180 !opacity-75' : ''"
        aria-hidden="true"
      />
    </button>

    <!-- ── Smart preview: visible when collapsed and not streaming ── -->
    <div v-if="hasSmartPreview" class="flex flex-col gap-2.5">
      <div v-if="lastTextChunk" class="max-h-[80px] overflow-hidden text-[14px] leading-[1.6] text-[var(--color-text)]">
        <MarkdownMessage
          v-for="group in lastTextChunk.groups.filter(g => g.type === 'text' && g.hasText)"
          :key="group.key"
          :content="group.text"
          :streaming="false"
        />
      </div>
      <div v-if="lastActionsChunk && previewSummaryParts.length > 0" class="flex flex-col gap-[2px]">
        <button
          class="group/header flex w-full min-h-[30px] cursor-pointer select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-[5px] text-left text-[var(--color-text-dim)] transition-[color,background,border-color,transform] duration-150 ease-[ease] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)] active:scale-[0.98]"
          :aria-expanded="previewActionsOpen"
          @click.stop="previewActionsOpen = !previewActionsOpen"
        >
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span
              v-for="(part, i) in previewSummaryParts"
              :key="i"
              class="flex items-center gap-1 whitespace-nowrap text-[11.5px] font-normal text-[var(--color-text-secondary)]"
            >
              <component :is="part.icon" :size="12" :stroke-width="1.75" class="text-inherit opacity-75" />
              {{ part.label }}
            </span>
          </div>
          <ChevronRight
            :size="12"
            class="shrink-0 text-inherit opacity-[0.45] transition-[transform,opacity] duration-[350ms,150ms] ease-[cubic-bezier(0.34,1.56,0.64,1),ease] motion-reduce:transition-none group-hover/header:opacity-75"
            :class="previewActionsOpen ? 'rotate-90 !opacity-75' : ''"
            aria-hidden="true"
          />
        </button>

        <div class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[340ms] ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[grid-template-rows] motion-reduce:transition-none" :class="previewActionsOpen ? 'grid-rows-[1fr]' : ''">
          <div class="min-h-0 -translate-y-[3px] overflow-hidden opacity-0 transition-[opacity,transform] duration-[200ms,340ms] ease-[ease,cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none" :class="previewActionsOpen ? 'translate-y-0 opacity-100 delay-[40ms,40ms] duration-[280ms,340ms]' : ''">
            <div class="relative ml-2 flex flex-col gap-1 border-l-[1.5px] border-[var(--color-border-subtle)] py-1 pl-[14px] transition-colors duration-300 ease-[ease]">
              <template v-for="(group, idx) in lastActionsChunk.groups" :key="group.key || idx">
                <div v-if="group.type === 'tools'" class="flex flex-col gap-2.5">
                  <ToolCallBadge v-for="ev in group.events" :key="ev.id" :event="ev" />
                </div>
                <div v-else-if="group.type === 'reasoning'" class="block text-[13px] leading-[1.6]">
                  <ThinkingMarkdown :content="group.text" :streaming="false" />
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Outer body (slides open when isOpen or streaming) ── -->
    <div class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[360ms] ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[grid-template-rows] motion-reduce:transition-none" :class="isOpen || streaming ? 'grid-rows-[1fr]' : ''">
      <div class="min-h-0 -translate-y-[3px] overflow-hidden opacity-0 transition-[opacity,transform] duration-[220ms,360ms] ease-[ease,cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none" :class="isOpen || streaming ? 'translate-y-0 opacity-100 delay-[40ms,40ms] duration-[300ms,360ms]' : ''">
        <div
          class="relative ml-2 flex flex-col gap-2.5 border-l-[1.5px] border-[var(--color-border-subtle)] pb-[6px] pl-[14px] pt-1 transition-colors duration-300 ease-[ease]"
          :class="streaming ? 'before:absolute before:-left-[1.75px] before:top-0 before:bottom-0 before:z-[1] before:w-[2px] before:rounded-[2px] before:bg-[var(--color-accent)] before:content-[\'\'] before:animate-[rail-pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite_alternate] motion-reduce:before:animate-none' : ''"
        >
          <!-- Iterate body chunks: text renders at body level, actions in sub-sections -->
          <template v-for="(chunk, chunkIdx) in bodyChunks" :key="chunkIdx">
            <!-- Text chunk: render directly at body level (normal color) -->
            <template v-if="chunk.type === 'text'">
              <MarkdownMessage
                v-for="group in chunk.groups"
                :key="group.key"
                :content="group.text"
                :streaming="group.streaming"
              />
            </template>

            <!-- Actions chunk: collapsible sub-section with summary pills -->
            <div v-else class="flex flex-col gap-[2px]">
              <!-- Sub-header: summary pills + chevron -->
              <div
                v-if="streaming"
                class="group/header pointer-events-none flex min-h-[30px] w-full cursor-default select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-[5px] text-left text-[var(--color-text-dim)]"
              >
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span
                    v-for="(part, i) in computeSummaryParts(chunk.groups)"
                    :key="i"
                    class="flex items-center gap-1 whitespace-nowrap text-[11.5px] font-normal text-[var(--color-text-secondary)]"
                  >
                    <component :is="part.icon" :size="12" :stroke-width="1.75" class="text-inherit opacity-75" />
                    {{ part.label }}
                  </span>
                </div>
              </div>

              <button
                v-else
                class="group/header flex w-full min-h-[30px] cursor-pointer select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-[5px] text-left text-[var(--color-text-dim)] transition-[color,background,border-color,transform] duration-150 ease-[ease] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)] active:scale-[0.98]"
                :aria-expanded="isActionsOpen(chunkIdx)"
                @click.stop="toggleActions(chunkIdx)"
              >
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span
                    v-for="(part, i) in computeSummaryParts(chunk.groups)"
                    :key="i"
                    class="flex items-center gap-1 whitespace-nowrap text-[11.5px] font-normal text-[var(--color-text-secondary)]"
                  >
                    <component :is="part.icon" :size="12" :stroke-width="1.75" class="text-inherit opacity-75" />
                    {{ part.label }}
                  </span>
                </div>
                <ChevronRight
                  :size="12"
                  class="shrink-0 text-inherit opacity-[0.45] transition-[transform,opacity] duration-[350ms,150ms] ease-[cubic-bezier(0.34,1.56,0.64,1),ease] motion-reduce:transition-none group-hover/header:opacity-75"
                  :class="isActionsOpen(chunkIdx) ? 'rotate-90 !opacity-75' : ''"
                  aria-hidden="true"
                />
              </button>

              <!-- Sub-body: tool badges + thinking blocks -->
              <div class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[340ms] ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[grid-template-rows] motion-reduce:transition-none" :class="isActionsOpen(chunkIdx) || streaming ? 'grid-rows-[1fr]' : ''">
                <div class="min-h-0 -translate-y-[3px] overflow-hidden opacity-0 transition-[opacity,transform] duration-[200ms,340ms] ease-[ease,cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none" :class="isActionsOpen(chunkIdx) || streaming ? 'translate-y-0 opacity-100 delay-[40ms,40ms] duration-[280ms,340ms]' : ''">
                  <div
                    class="relative ml-2 flex flex-col gap-1 border-l-[1.5px] border-[var(--color-border-subtle)] py-1 pl-[14px] transition-colors duration-300 ease-[ease]"
                    :class="streaming ? 'before:absolute before:-left-[1.75px] before:top-0 before:bottom-0 before:z-[1] before:w-[2px] before:rounded-[2px] before:bg-[var(--color-accent)] before:content-[\'\'] before:animate-[rail-pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite_alternate] motion-reduce:before:animate-none' : ''"
                  >
                    <template v-for="(group, idx) in chunk.groups" :key="group.key || idx">
                      <div v-if="group.type === 'tools'" class="flex flex-col gap-2.5">
                        <ToolCallBadge v-for="ev in group.events" :key="ev.id" :event="ev" />
                      </div>
                      <div v-else-if="group.type === 'reasoning'" class="block text-[13px] leading-[1.6]">
                        <ThinkingMarkdown :content="group.text" :streaming="streaming" />
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Unscoped global style block to ensure keyframes are available to arbitrary Tailwind values */
@keyframes dot-pop {
  0%,
  100% {
    opacity: 0.4;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes rail-pulse {
  0% {
    opacity: 0.08;
  }
  100% {
    opacity: 0.4;
  }
}
</style>
