<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import { Check, ChevronDown, Copy, Sparkles } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import MarkdownMessage from '@/components/chat/MarkdownMessage.vue'
import ToolCallBadge from '@/components/chat/ToolCallBadge.vue'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'

const props = defineProps<{
  msg: Message
  isStreaming: boolean
}>()

function formatTokenCount(count: number): string {
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1000)
    return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`
  return String(count)
}

function formatProviderName(providerId: string): string {
  switch (providerId) {
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Anthropic'
    case 'google': return 'Gemini'
    default: return providerId
  }
}

function cacheSummary(msg: Message): string {
  if (!msg.cacheStats)
    return ''
  const parts: string[] = []
  if ((msg.cacheStats.readTokens ?? 0) > 0)
    parts.push(`${formatTokenCount(msg.cacheStats.readTokens ?? 0)} hit`)
  if ((msg.cacheStats.writeTokens ?? 0) > 0)
    parts.push(`${formatTokenCount(msg.cacheStats.writeTokens ?? 0)} write`)
  return `${formatProviderName(msg.cacheStats.providerId)} cache: ${parts.join(' · ')}`
}

const groupedParts = computed(() => {
  const msg = props.msg
  const groups: Array<{ type: 'text' | 'reasoning'; text: string; key: string } | { type: 'tools'; events: ToolEvent[]; key: string }> = []

  const parseText = (text: string, baseKey: string) => {
    const thinkRegex = /<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/gi
    if (!/<(?:think|thought)>/i.test(text)) {
      groups.push({ type: 'text', text, key: `${baseKey}-text` })
      return
    }
    let lastIndex = 0
    let match = thinkRegex.exec(text)
    let matchIdx = 0
    while (match !== null) {
      if (match.index > lastIndex)
        groups.push({ type: 'text', text: text.substring(lastIndex, match.index), key: `${baseKey}-t-${matchIdx}` })
      groups.push({ type: 'reasoning', text: match[1]!, key: `${baseKey}-r-${matchIdx}` })
      lastIndex = thinkRegex.lastIndex
      matchIdx++
      match = thinkRegex.exec(text)
    }
    if (lastIndex < text.length)
      groups.push({ type: 'text', text: text.substring(lastIndex), key: `${baseKey}-t-end` })
  }

  if (msg.parts && msg.parts.length > 0) {
    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i]!
      if (part.type === 'text') {
        parseText(part.text, `part-${i}`)
      }
      else if (part.type === 'reasoning') {
        groups.push({ type: 'reasoning', text: part.text, key: `part-${i}-reasoning` })
      }
      else if (part.type === 'tool') {
        const event = msg.toolEvents?.find(e => e.id === part.toolCallId)
        if (event) {
          const last = groups[groups.length - 1]
          if (last?.type === 'tools')
            last.events.push(event)
          else groups.push({ type: 'tools', events: [event], key: `part-${i}-tools` })
        }
      }
    }
  }
  else {
    if (msg.toolEvents && msg.toolEvents.length > 0)
      groups.push({ type: 'tools', events: msg.toolEvents, key: 'fb-tools' })
    if (msg.content)
      parseText(msg.content, 'fb-content')
  }

  return groups.length > 0 ? groups : null
})

// ── Layout structuring for the "Worked" collapsing wrapper ────────────────────

const layout = computed(() => {
  const parts = groupedParts.value || []
  let lastWork = -1
  // Find the index of the last tool call or thinking block
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part && (part.type === 'tools' || part.type === 'reasoning')) {
      lastWork = i
      break
    }
  }

  if (lastWork === -1) {
    return { work: [], rest: parts }
  }

  return {
    work: parts.slice(0, lastWork + 1), // everything up to the final thought/tool
    rest: parts.slice(lastWork + 1), // the final response (typically text)
  }
})

const showTypingIndicator = computed(() => {
  return props.isStreaming && (!props.msg.parts || props.msg.parts.length === 0
    || (props.msg.parts.length === 1 && props.msg.parts[0]!.type === 'text' && !props.msg.parts[0]!.text))
})

// ── Thinking block state ──────────────────────────────────────────────────────

const openBlocks = reactive<Record<string, boolean>>({})

// ── Streaming / Timing state ──────────────────────────────────────────────────

const streamStart = ref<number | null>(props.isStreaming ? Date.now() : null)
const elapsedSec = ref<number | null>(null)
const isWorkCollapsed = ref(!props.isStreaming)

watch(() => props.isStreaming, (streaming, was) => {
  if (streaming && !was) {
    streamStart.value = Date.now()
    elapsedSec.value = null
    isWorkCollapsed.value = false // Expand while streaming
  }
  else if (!streaming && was) {
    elapsedSec.value = streamStart.value
      ? Math.max(1, Math.round((Date.now() - streamStart.value) / 1000))
      : null

    // Auto-collapse when finished
    setTimeout(() => {
      isWorkCollapsed.value = true
      for (const g of groupedParts.value ?? []) {
        if (g.type === 'reasoning')
          openBlocks[g.key] = false
      }
    }, 500)
  }
})

const workLabel = computed(() => {
  if (props.isStreaming)
    return 'Working'
  if (elapsedSec.value !== null)
    return `Worked for ${elapsedSec.value}s`
  return 'Worked'
})

function isGroupStreaming(gIdx: number, inWork: boolean): boolean {
  if (!props.isStreaming)
    return false
  if (inWork) {
    return gIdx === layout.value.work.length - 1 && layout.value.rest.length === 0
  }
  return gIdx === layout.value.rest.length - 1
}

function isBlockOpen(key: string): boolean {
  return openBlocks[key] ?? props.isStreaming
}

function toggleBlock(key: string) {
  openBlocks[key] = !isBlockOpen(key)
}

function thinkingLabel(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return `Thought for ${words > 0 ? `~${formatTokenCount(words)} words` : 'a moment'}`
}

const copiedKey = ref<string | null>(null)

async function copyThinking(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => { copiedKey.value = null }, 2000)
  }
  catch {}
}
</script>

<template>
  <div class="assistant-row">
    <div v-if="msg.error" class="assistant-error">
      ⚠ {{ msg.error }}
    </div>

    <!-- ── 1. Grouped Work Block (Collapses all tools/reasoning + text before final text) ── -->
    <div v-if="layout.work.length > 0" class="work-block">
      <!-- Master Header -->
      <button v-if="!isStreaming" class="thinking-header work-header" @click="isWorkCollapsed = !isWorkCollapsed">
        <div class="thinking-header-left">
          <Sparkles :size="14" class="thinking-icon" />
          <span class="thinking-status">{{ workLabel }}</span>
        </div>
        <div class="thinking-header-right">
          <ChevronDown :size="14" class="thinking-chevron" :class="{ 'thinking-chevron--open': !isWorkCollapsed }" />
        </div>
      </button>

      <div v-else class="thinking-header work-header work-header--live">
        <div class="thinking-header-left">
          <Sparkles :size="14" class="thinking-icon thinking-icon--pulse" />
          <span class="thinking-status thinking-status--live">
            Working<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
          </span>
        </div>
      </div>

      <!-- Master Body -->
      <div class="work-body" :class="{ 'work-body--open': !isWorkCollapsed || isStreaming }">
        <div class="work-body-inner">
          <template v-for="(group, gIdx) in layout.work" :key="group.key">
            <div v-if="group.type === 'tools'" class="tool-events">
              <ToolCallBadge v-for="event in group.events" :key="event.id" :event="event" />
            </div>

            <MarkdownMessage
              v-else-if="group.type === 'text' && group.text"
              :content="group.text"
              :streaming="isGroupStreaming(gIdx, true)"
            />

            <div
              v-else-if="group.type === 'reasoning' && group.text"
              class="thinking-block"
              :class="{ 'thinking-block--streaming': isGroupStreaming(gIdx, true), 'thinking-block--open': isBlockOpen(group.key) }"
            >
              <button class="thinking-header" @click="toggleBlock(group.key)">
                <div class="thinking-header-left">
                  <Sparkles :size="14" class="thinking-icon" :class="{ 'thinking-icon--pulse': isGroupStreaming(gIdx, true) }" />
                  <span v-if="isGroupStreaming(gIdx, true)" class="thinking-status thinking-status--live">
                    Thinking<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                  </span>
                  <span v-else class="thinking-status">{{ thinkingLabel(group.text) }}</span>
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
                  <ChevronDown :size="14" class="thinking-chevron" :class="{ 'thinking-chevron--open': isBlockOpen(group.key) }" />
                </div>
              </button>

              <div class="thinking-body" :class="{ 'thinking-body--open': isBlockOpen(group.key) }">
                <div class="thinking-body-inner">
                  <div class="thinking-text">
                    {{ group.text }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── 2. Rest Block (Final Response Text) ── -->
    <template v-for="(group, gIdx) in layout.rest" :key="group.key">
      <div v-if="group.type === 'tools'" class="tool-events">
        <ToolCallBadge v-for="event in group.events" :key="event.id" :event="event" />
      </div>

      <MarkdownMessage
        v-else-if="group.type === 'text' && group.text"
        :content="group.text"
        :streaming="isGroupStreaming(gIdx, false)"
      />

      <div
        v-else-if="group.type === 'reasoning' && group.text"
        class="thinking-block"
        :class="{ 'thinking-block--streaming': isGroupStreaming(gIdx, false), 'thinking-block--open': isBlockOpen(group.key) }"
      >
        <button class="thinking-header" @click="toggleBlock(group.key)">
          <div class="thinking-header-left">
            <Sparkles :size="14" class="thinking-icon" :class="{ 'thinking-icon--pulse': isGroupStreaming(gIdx, false) }" />
            <span v-if="isGroupStreaming(gIdx, false)" class="thinking-status thinking-status--live">
              Thinking<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </span>
            <span v-else class="thinking-status">{{ thinkingLabel(group.text) }}</span>
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
            <ChevronDown :size="14" class="thinking-chevron" :class="{ 'thinking-chevron--open': isBlockOpen(group.key) }" />
          </div>
        </button>

        <div class="thinking-body" :class="{ 'thinking-body--open': isBlockOpen(group.key) }">
          <div class="thinking-body-inner">
            <div class="thinking-text">
              {{ group.text }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="msg.cacheStats" class="cache-badge">
      {{ cacheSummary(msg) }}
    </div>

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
  align-self: flex-start;
  padding: 10px 14px;
  background: var(--color-danger-muted);
  color: var(--color-danger-text);
  border: 1px solid var(--color-danger-dim);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--font-mono);
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-events {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

/* ── Work block (Master Group) ───────────────────────────────────────────── */

.work-block {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.work-header .thinking-header-right {
  opacity: 1; /* Always show the expand chevron for the master block */
}

.work-header--live {
  cursor: default;
}

.work-header--live:hover {
  background: transparent;
}

.work-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.work-body--open {
  grid-template-rows: 1fr;
}

.work-body-inner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
  margin-left: 7px; /* Aligns correctly with the header's 14px icon */
  padding-left: 14px;
  border-left: 1.5px solid var(--color-border-subtle);
  padding-bottom: 4px;
}

/* ── Thinking block ──────────────────────────────────────────────────────── */

.thinking-block {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* Header */
.thinking-header {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: fit-content;
  padding: 4px 8px;
  margin-left: -8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  gap: 8px;
  color: var(--color-text-dim);
  transition: all 0.15s ease;
}

.thinking-header:hover {
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
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
  transition: opacity 0.15s ease;
}

.thinking-header:hover .thinking-header-right,
.thinking-block--open .thinking-header-right {
  opacity: 1;
}

.thinking-icon {
  color: currentColor;
  flex-shrink: 0;
  transition: opacity 0.2s ease;
}

.thinking-icon--pulse {
  animation: icon-pulse 1.8s ease-in-out infinite;
  color: var(--color-accent-text);
}

@keyframes icon-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
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

.thinking-dots span {
  animation: dot-blink 1.4s ease-in-out infinite;
  opacity: 0;
}
.thinking-dots span:nth-child(1) {
  animation-delay: 0s;
}
.thinking-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-blink {
  0%,
  80%,
  100% {
    opacity: 0;
  }
  40% {
    opacity: 1;
  }
}

/* Copy action button */
.thinking-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  transition: all 0.12s ease;
}

.thinking-action:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* Chevron */
.thinking-chevron {
  color: currentColor;
  transition: transform 0.22s ease;
  flex-shrink: 0;
}

.thinking-chevron--open {
  transform: rotate(180deg);
}

/* Collapsible body */
.thinking-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.thinking-body--open {
  grid-template-rows: 1fr;
}

.thinking-body-inner {
  overflow: hidden;
}

.thinking-text {
  margin-top: 4px;
  margin-left: 7px;
  padding-left: 14px;
  border-left: 1.5px solid var(--color-border-subtle);
  color: var(--color-text-tertiary);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  padding-bottom: 4px;
}

/* ── Cache badge ─────────────────────────────────────────────────────────── */
.cache-badge {
  align-self: flex-start;
  margin-top: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--color-text-tertiary);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
}
</style>
