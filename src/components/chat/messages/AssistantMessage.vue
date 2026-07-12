<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import type { AgentStatus } from '@/stores/chat/types'
import { AlertTriangle } from 'lucide-vue-next'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { isStreamingStatus } from '@/stores/chat/agentStatus'
import ActionGroupBlock from './ActionGroupBlock.vue'
import MarkdownMessage from './MarkdownMessage.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallBadge from './ToolCallBadge.vue'
import TypingIndicator from './TypingIndicator.vue'

const props = defineProps<{
  msg: Message
  agentStatus?: AgentStatus
}>()

const isStreaming = computed(() => props.agentStatus ? isStreamingStatus(props.agentStatus) : false)

// ── Zero-Allocation Word Counter ──────────────────────────────────────────────

function countWords(text: string): number {
  let count = 0
  let isWord = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 32 && code !== 160) {
      if (!isWord) {
        count++
        isWord = true
      }
    }
    else {
      isWord = false
    }
  }
  return count
}

// ── Pre-computing Layout & Streaming States ───────────────────────────────────

interface ProcessedGroup {
  type: 'text' | 'reasoning' | 'tools'
  text: string
  hasText: boolean
  events: ToolEvent[]
  key: string
  streaming: boolean
  wordCount: number
}

const layout = computed(() => {
  const msg = props.msg
  const groups: ProcessedGroup[] = []

  const pushText = (text: string, key: string, type: 'text' | 'reasoning') => {
    groups.push({
      type,
      text,
      hasText: /\S/.test(text),
      events: [],
      key,
      streaming: false,
      // Only count words when not streaming — word count is shown in the
      // collapsed summary header which is hidden while streaming anyway.
      wordCount: (type === 'reasoning' && !isStreaming.value) ? countWords(text) : 0,
    })
  }

  const parseText = (text: string, baseKey: string) => {
    // Fast path: skip the expensive regex entirely if no think tag present.
    // indexOf is O(n) but far cheaper than regex compilation + execution.
    if (!text.includes('<think') && !text.includes('<thought')) {
      pushText(text, `${baseKey}-text`, 'text')
      return
    }
    const thinkRegex = /<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/gi

    let lastIndex = 0
    let match = thinkRegex.exec(text)
    let matchIdx = 0

    while (match !== null) {
      if (match.index > lastIndex) {
        pushText(text.substring(lastIndex, match.index), `${baseKey}-t-${matchIdx}`, 'text')
      }
      pushText(match[1]!, `${baseKey}-r-${matchIdx}`, 'reasoning')
      lastIndex = thinkRegex.lastIndex
      matchIdx++
      match = thinkRegex.exec(text)
    }
    if (lastIndex < text.length) {
      pushText(text.substring(lastIndex), `${baseKey}-t-end`, 'text')
    }
  }

  if (msg.parts && msg.parts.length > 0) {
    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i]!
      if (part.type === 'text') {
        parseText(part.text, `part-${i}`)
      }
      else if (part.type === 'reasoning') {
        pushText(part.text, `part-${i}-reasoning`, 'reasoning')
      }
      else if (part.type === 'tool') {
        const event = msg.toolEvents?.find(e => e.id === part.toolCallId)
        if (event) {
          const last = groups[groups.length - 1]
          if (last?.type === 'tools') {
            last.events.push(event)
          }
          else {
            groups.push({
              type: 'tools',
              text: '',
              hasText: false,
              events: [event],
              key: `part-${i}-tools`,
              streaming: false,
              wordCount: 0,
            })
          }
        }
      }
    }
  }
  else {
    if (msg.toolEvents && msg.toolEvents.length > 0) {
      groups.push({
        type: 'tools',
        text: '',
        hasText: false,
        events: msg.toolEvents,
        key: 'fb-tools',
        streaming: false,
        wordCount: 0,
      })
    }
    if (msg.content)
      parseText(msg.content, 'fb-content')
  }

  let lastWork = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    const part = groups[i]
    if (part && (part.type === 'tools' || part.type === 'reasoning')) {
      lastWork = i
      break
    }
  }

  if (isStreaming.value && groups.length > 0) {
    groups[groups.length - 1]!.streaming = true
  }

  if (lastWork === -1) {
    return { work: [] as ProcessedGroup[], rest: groups }
  }

  return {
    work: groups.slice(0, lastWork + 1),
    rest: groups.slice(lastWork + 1),
  }
})

const hasRestText = computed(() => {
  return layout.value.rest.some(g => g.type === 'text' && g.hasText)
})

const hasVisibleWork = computed(() => {
  if (!layout.value.work || layout.value.work.length === 0)
    return false
  return layout.value.work.some(g => {
    if (g.type === 'tools')
      return g.events && g.events.length > 0
    if (g.type === 'text' || g.type === 'reasoning')
      return g.hasText
    return false
  })
})

const showTypingIndicator = computed(() => {
  return (
    isStreaming.value
    && (!props.msg.parts
      || props.msg.parts.length === 0
      || (props.msg.parts.length === 1
        && props.msg.parts[0]!.type === 'text'
        && !props.msg.parts[0]!.text))
  )
})

const displayError = computed(() => {
  if (!props.msg.error)
    return null
  return typeof props.msg.error === 'string'
    ? props.msg.error
    : String(
        typeof props.msg.error === 'object' && props.msg.error !== null && 'message' in props.msg.error
          ? (props.msg.error as { message: unknown }).message
          : props.msg.error,
      )
})

// ── View States & Timeouts ────────────────────────────────────────────────────

const openBlocks = reactive<Record<string, boolean>>({})

const streamStart = ref<number | null>(isStreaming.value ? Date.now() : null)
const elapsedSec = ref<number | null>(props.msg.elapsedSec ?? null)

const isWorkCollapsed = ref(!isStreaming.value)
const autoOpenState = ref(isStreaming.value)

let collapseTimeout: number | undefined
let copyTimeout: number | undefined

watch(
  () => isStreaming.value,
  (streaming, was) => {
    if (streaming && !was) {
      streamStart.value = Date.now()
      elapsedSec.value = null
      isWorkCollapsed.value = false
      autoOpenState.value = true
      clearTimeout(collapseTimeout)
    }
    else if (!streaming && was) {
      elapsedSec.value = streamStart.value
        ? Math.max(1, Math.round((Date.now() - streamStart.value) / 1000))
        : null

      // Only collapse work when streaming completed normally.
      // If there's an error (user cancel, abort, or runtime error),
      // keep the last work visible so the user can inspect it.
      if (!props.msg.error) {
        collapseTimeout = window.setTimeout(() => {
          isWorkCollapsed.value = true
          autoOpenState.value = false
          for (const key in openBlocks) {
            delete openBlocks[key]
          }
        }, 600) // Slightly longer to let the final animation settle gracefully
      }
    }
  },
)

onUnmounted(() => {
  clearTimeout(collapseTimeout)
  clearTimeout(copyTimeout)
})

const workLabel = computed(() => {
  if (isStreaming.value)
    return 'Working'
  if (elapsedSec.value !== null)
    return `Worked for ${elapsedSec.value}s`
  return 'Worked'
})

function isBlockOpen(key: string): boolean {
  return openBlocks[key] ?? autoOpenState.value
}

function toggleBlock(key: string) {
  openBlocks[key] = !isBlockOpen(key)
}

const copiedKey = ref<string | null>(null)

async function copyThinking(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    clearTimeout(copyTimeout)
    copyTimeout = window.setTimeout(() => {
      copiedKey.value = null
    }, 2000)
  }
  catch {}
}

async function copyAction() {
  try {
    const parts = layout.value.work.filter(g => g.type === 'reasoning' && g.hasText).map(g => g.text)
    if (parts.length === 0)
      return
    const text = parts.join('\n\n')
    await navigator.clipboard.writeText(text)
    copiedKey.value = 'action'
    clearTimeout(copyTimeout)
    copyTimeout = window.setTimeout(() => {
      copiedKey.value = null
    }, 2000)
  }
  catch {}
}
</script>

<template>
  <div class="flex max-w-full flex-col items-start gap-2.5 py-2">
    <div
      v-if="displayError"
      class="mx-auto mb-2.5 flex w-[calc(100%-24px)] max-w-full items-center gap-2.5 whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-border-bright))] bg-[var(--color-bg-card)] px-3.5 py-2.5 text-[13px] text-[var(--color-danger-text)] transition-[border-color,box-shadow] duration-[120ms] ease-[ease] hover:border-[color-mix(in_srgb,var(--color-danger)_55%,var(--color-border-bright))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-danger)_20%,transparent)]"
    >
      <AlertTriangle :size="14" :stroke-width="2" class="shrink-0 text-[var(--color-danger)]" />
      <span class="flex-1 min-w-0 font-[var(--font-mono)]">{{ displayError }}</span>
    </div>

    <ActionGroupBlock
      v-if="(hasVisibleWork || isStreaming) && layout.work.length > 0"
      :items="layout.work"
      :streaming="isStreaming"
      :is-open="!isWorkCollapsed"
      :status-label="workLabel"
      :copied="copiedKey !== null"
      :has-rest-text="hasRestText"
      @toggle="isWorkCollapsed = !isWorkCollapsed"
      @copy="copyAction"
    />

    <!-- ── 2. Rest Block ── -->
    <template v-for="group in layout.rest" :key="group.key">
      <div v-if="group.type === 'tools'" class="flex w-full flex-col gap-2.5">
        <ToolCallBadge v-for="event in group.events" :key="event.id" :event="event" />
      </div>

      <MarkdownMessage
        v-else-if="group.type === 'text' && (group.hasText || group.streaming)"
        :content="group.text"
        :streaming="group.streaming"
      />

      <ThinkingBlock
        v-else-if="group.type === 'reasoning' && (group.hasText || group.streaming)"
        :text="group.text"
        :word-count="group.wordCount"
        :streaming="group.streaming"
        :is-open="isBlockOpen(group.key)"
        :copied="copiedKey === group.key"
        @toggle="toggleBlock(group.key)"
        @copy="copyThinking(group.key, group.text)"
      />
    </template>

    <TypingIndicator :is-streaming="showTypingIndicator" />
  </div>
</template>
