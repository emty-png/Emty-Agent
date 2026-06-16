<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import { AlertTriangle, Check, ChevronDown, Copy } from 'lucide-vue-next'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import MarkdownMessage from './MarkdownMessage.vue'
import ToolCallBadge from './ToolCallBadge.vue'
import TypingIndicator from './TypingIndicator.vue'

const props = defineProps<{
  msg: Message
  isStreaming: boolean
}>()

// ── Formats ───────────────────────────────────────────────────────────────────

function formatTokenCount(count: number): string {
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1000)
    return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`
  return String(count)
}

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

function getThinkingLabel(wordCount: number): string {
  return `Thought for ${wordCount > 0 ? `~${formatTokenCount(wordCount)} words` : 'a moment'}`
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
      wordCount: (type === 'reasoning' && !props.isStreaming) ? countWords(text) : 0,
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

  if (props.isStreaming && groups.length > 0) {
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
    props.isStreaming
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

const streamStart = ref<number | null>(props.isStreaming ? Date.now() : null)
const elapsedSec = ref<number | null>(null)

const isWorkCollapsed = ref(!props.isStreaming)
const autoOpenState = ref(props.isStreaming)

let collapseTimeout: number | undefined
let copyTimeout: number | undefined

watch(
  () => props.isStreaming,
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
  if (props.isStreaming)
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
</script>

<template>
  <div class="assistant-row">
    <div v-if="displayError" class="assistant-error">
      <AlertTriangle :size="14" :stroke-width="2" class="assistant-error-icon" />
      <span class="assistant-error-text">{{ displayError }}</span>
    </div>

    <!-- ── 1. Grouped Work Block ── -->
    <div v-if="(hasVisibleWork || isStreaming) && layout.work.length > 0" class="work-block">
      <!-- Master Header -->
      <button
        v-if="!isStreaming"
        class="thinking-header work-header"
        @click="isWorkCollapsed = !isWorkCollapsed"
      >
        <div class="thinking-header-left">
          <div class="matrix-sweep">
            <div v-for="i in 16" :key="i" class="m-dot" />
          </div>
          <span class="thinking-status">{{ workLabel }}</span>
        </div>
        <div class="thinking-header-right">
          <ChevronDown
            :size="14"
            class="thinking-chevron"
            :class="{ 'thinking-chevron--open': !isWorkCollapsed }"
          />
        </div>
      </button>

      <div v-else class="thinking-header work-header work-header--live">
        <div class="thinking-header-left">
          <div class="matrix-sweep">
            <div v-for="i in 16" :key="i" class="m-dot" />
          </div>
          <span class="thinking-status thinking-status--live">
            Working
            <span class="thinking-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        </div>
      </div>

      <!-- Master Body -->
      <div class="work-body" :class="{ 'work-body--open': !isWorkCollapsed || isStreaming }">
        <div class="work-body-inner">
          <div class="work-body-content" :class="{ 'work-body-content--streaming': isStreaming }">
            <template v-for="group in layout.work" :key="group.key">
              <div v-if="group.type === 'tools'" class="tool-events">
                <ToolCallBadge v-for="event in group.events" :key="event.id" :event="event" />
              </div>

              <MarkdownMessage
                v-else-if="group.type === 'text' && (group.hasText || group.streaming)"
                :content="group.text"
                :streaming="group.streaming"
              />

              <div
                v-else-if="group.type === 'reasoning' && (group.hasText || group.streaming)"
                class="thinking-block"
                :class="{
                  'thinking-block--streaming': group.streaming,
                  'thinking-block--open': isBlockOpen(group.key),
                }"
              >
                <button class="thinking-header" @click="toggleBlock(group.key)">
                  <div class="thinking-header-left">
                    <div class="matrix-sweep">
                      <div v-for="i in 16" :key="i" class="m-dot" />
                    </div>
                    <span v-if="group.streaming" class="thinking-status thinking-status--live">
                      Thinking
                      <span class="thinking-dots">
                        <span>.</span>
                        <span>.</span>
                        <span>.</span>
                      </span>
                    </span>
                    <span v-else class="thinking-status">
                      {{ getThinkingLabel(group.wordCount) }}
                    </span>
                  </div>
                  <div class="thinking-header-right">
                    <button
                      v-if="!isStreaming"
                      class="thinking-action"
                      :title="copiedKey === group.key ? 'Copied!' : 'Copy reasoning'"
                      @click.stop="copyThinking(group.key, group.text)"
                    >
                      <Check v-if="copiedKey === group.key" :size="12" />
                      <Copy v-else :size="12" />
                    </button>
                    <ChevronDown
                      :size="14"
                      class="thinking-chevron"
                      :class="{ 'thinking-chevron--open': isBlockOpen(group.key) }"
                    />
                  </div>
                </button>

                <div
                  class="thinking-body"
                  :class="{ 'thinking-body--open': isBlockOpen(group.key) }"
                >
                  <div class="thinking-body-inner">
                    <div
                      class="thinking-body-content"
                      :class="{ 'thinking-body-content--streaming': group.streaming }"
                    >
                      <div class="thinking-text">
                        {{ group.text }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 2. Rest Block ── -->
    <template v-for="group in layout.rest" :key="group.key">
      <div v-if="group.type === 'tools'" class="tool-events">
        <ToolCallBadge v-for="event in group.events" :key="event.id" :event="event" />
      </div>

      <MarkdownMessage
        v-else-if="group.type === 'text' && (group.hasText || group.streaming)"
        :content="group.text"
        :streaming="group.streaming"
      />

      <div
        v-else-if="group.type === 'reasoning' && (group.hasText || group.streaming)"
        class="thinking-block"
        :class="{
          'thinking-block--streaming': group.streaming,
          'thinking-block--open': isBlockOpen(group.key),
        }"
      >
        <button class="thinking-header" @click="toggleBlock(group.key)">
          <div class="thinking-header-left">
            <div class="matrix-sweep">
              <div v-for="i in 16" :key="i" class="m-dot" />
            </div>
            <span v-if="group.streaming" class="thinking-status thinking-status--live">
              Thinking
              <span class="thinking-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </span>
            <span v-else class="thinking-status">{{ getThinkingLabel(group.wordCount) }}</span>
          </div>

          <div class="thinking-header-right">
            <button
              v-if="!isStreaming"
              class="thinking-action"
              :title="copiedKey === group.key ? 'Copied!' : 'Copy reasoning'"
              @click.stop="copyThinking(group.key, group.text)"
            >
              <Check v-if="copiedKey === group.key" :size="12" />
              <Copy v-else :size="12" />
            </button>
            <ChevronDown
              :size="14"
              class="thinking-chevron"
              :class="{ 'thinking-chevron--open': isBlockOpen(group.key) }"
            />
          </div>
        </button>

        <div class="thinking-body" :class="{ 'thinking-body--open': isBlockOpen(group.key) }">
          <div class="thinking-body-inner">
            <div
              class="thinking-body-content"
              :class="{ 'thinking-body-content--streaming': group.streaming }"
            >
              <div class="thinking-text">
                {{ group.text }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <TypingIndicator :is-streaming="showTypingIndicator" />
  </div>
</template>

<style scoped>
.assistant-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding-block: 8px;
  max-width: 100%;
}

.assistant-error {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 24px);
  margin: 0 auto 10px auto;
  padding: 10px 14px;
  background: var(--color-bg-card);
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border-bright));
  border-radius: var(--radius-lg);
  color: var(--color-danger-text);
  font-size: 13px;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.assistant-error:hover {
  border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border-bright));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-danger) 20%, transparent);
}

.assistant-error-icon {
  flex-shrink: 0;
  color: var(--color-danger);
}

.assistant-error-text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
}

.tool-events {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.work-block {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.work-header .thinking-header-right {
  opacity: 1;
}

.work-header--live {
  cursor: default;
}

.work-header--live:hover {
  background: transparent;
  border-color: transparent;
  transform: scale(1);
}

/* ── Buttery Smooth Grid Expand/Collapse ── */
.work-body,
.thinking-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  will-change: grid-template-rows;
}

.work-body--open,
.thinking-body--open {
  grid-template-rows: 1fr;
}

/* ── Content Fade & Nudge ── */
.work-body-inner,
.thinking-body-inner {
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 0.25s ease,
    transform 0.4s cubic-bezier(0.25, 1, 0.5, 1);
}

.work-body--open > .work-body-inner,
.thinking-body--open > .thinking-body-inner {
  opacity: 1;
  transform: translateY(0);
  /* Slight delay on opacity fade-in to let the grid start opening */
  transition:
    opacity 0.4s ease 0.05s,
    transform 0.4s cubic-bezier(0.25, 1, 0.5, 1) 0.05s;
}

.work-body-content,
.thinking-body-content {
  display: flex;
  flex-direction: column;
  margin-left: 8.25px; /* Precisely centers the 1.5px border under the 18px matrix */
  padding-left: 14px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-left: 1.5px solid var(--color-border-subtle);
  position: relative;
  transition: border-color 0.3s ease;
}

/* ── Refined Pulsing Line ── */
.work-body-content--streaming::before,
.thinking-body-content--streaming::before {
  content: '';
  position: absolute;
  left: -1.75px; /* Perfectly centers the 2px pulsing line over the 1.5px static border */
  top: 0;
  bottom: 0;
  width: 2px; /* Slightly thicker for a premium feel */
  border-radius: 2px; /* Soft edges */
  background: var(--color-accent);
  animation: line-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;
  z-index: 2;
}

@keyframes line-pulse {
  0% {
    opacity: 0.05;
  }
  100% {
    opacity: 0.35;
  }
}

.thinking-block {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.thinking-header {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: fit-content;
  padding: 6px 10px;
  margin-left: -10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  gap: 8px;
  color: var(--color-text-dim);
  transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
  user-select: none;
}

.thinking-header:hover {
  color: var(--color-text-secondary);
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
}

.thinking-header:active {
  transform: scale(0.97); /* Slightly deeper click feel */
}

.thinking-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.thinking-header-right {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.thinking-header:hover .thinking-header-right,
.thinking-block--open .thinking-header-right {
  opacity: 1;
}

/* ── Matrix Sweep ── */
.matrix-sweep {
  display: grid;
  grid-template-columns: repeat(4, 3px);
  grid-template-rows: repeat(4, 3px);
  gap: 2px;
  margin-right: 4px;
  flex-shrink: 0;
}

.m-dot {
  width: 3px;
  height: 3px;
  background: var(--color-text-dim);
  border-radius: 0.5px;
  opacity: 0.3;
  transition: all 0.3s ease;
}

.work-header--live .m-dot,
.thinking-block--streaming .m-dot {
  animation: sweep-move 2.5s infinite;
}

.m-dot:nth-child(1) {
  animation-delay: 0s;
}
.m-dot:nth-child(2),
.m-dot:nth-child(5) {
  animation-delay: 0.15s;
}
.m-dot:nth-child(3),
.m-dot:nth-child(6),
.m-dot:nth-child(9) {
  animation-delay: 0.3s;
}
.m-dot:nth-child(4),
.m-dot:nth-child(7),
.m-dot:nth-child(10),
.m-dot:nth-child(13) {
  animation-delay: 0.45s;
}
.m-dot:nth-child(8),
.m-dot:nth-child(11),
.m-dot:nth-child(14) {
  animation-delay: 0.6s;
}
.m-dot:nth-child(12),
.m-dot:nth-child(15) {
  animation-delay: 0.75s;
}
.m-dot:nth-child(16) {
  animation-delay: 0.9s;
}

@keyframes sweep-move {
  0%,
  100% {
    opacity: 0.15;
    transform: scale(1);
  }
  15% {
    opacity: 1;
    transform: scale(1.2);
    background: var(--color-accent);
    box-shadow: 0 0 6px var(--color-accent);
  }
  30% {
    opacity: 0.15;
    transform: scale(1);
  }
}

.thinking-status {
  font-size: 13px;
  font-weight: 400;
  color: currentColor;
  white-space: nowrap;
}

.thinking-status--live {
  color: var(--color-accent-text);
}

/* ── Refined Bouncing Dots ── */
.thinking-dots span {
  display: inline-block;
  animation: dot-bounce 1.4s infinite;
  opacity: 0.3;
  transform: translateY(0);
}
.thinking-dots span:nth-child(1) {
  animation-delay: 0s;
}
.thinking-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

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

.thinking-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: currentColor;
  cursor: pointer;
  transition: all 0.15s ease;
}

.thinking-action:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  transform: scale(1.05);
}

/* ── Springy Chevron ── */
.thinking-chevron {
  color: currentColor;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  flex-shrink: 0;
}

.thinking-chevron--open {
  transform: rotate(180deg);
}

.thinking-text {
  color: var(--color-text-tertiary);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
</style>
