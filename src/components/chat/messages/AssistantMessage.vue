<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import type { AgentStatus } from '@/stores/chat/core/types'
import { AlertTriangle, Check, Copy } from 'lucide-vue-next'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agent/status'
import { useDesignVersionStore } from '@/stores/designVersions'
import { useSettingsStore } from '@/stores/settings'
import ActionGroupBlock from './block/ActionBlock.vue'
import FileEditChips from './block/FileDiffBlock.vue'
import ThinkingBlock from './block/ThinkingBlock.vue'
import ToolCallBlock from './block/ToolCallBlock.vue'
import DesignVersionCard from './DesignVersionCard.vue'
import MarkdownMessage from './markdown/AssistantMarkdown.vue'
import TypingIndicator from './TypingIndicator.vue'

const props = defineProps<{
  msg: Message
  agentStatus?: AgentStatus
}>()

const emit = defineEmits<{
  previewVersion: [string]
  compareVersion: [string]
}>()

const isStreaming = computed(() => props.agentStatus ? isStreamingStatus(props.agentStatus) : false)

const settingsStore = useSettingsStore()

const providerId = computed<string | null>(() => {
  const uid = props.msg.modelUid
  if (!uid)
    return null
  const idx = uid.indexOf('::')
  if (idx === -1)
    return null
  return uid.slice(0, idx) || null
})

const hideThinking = computed(() => settingsStore.shouldHideThinking(providerId.value))
const disableThinkingMarkdown = computed(() => settingsStore.shouldDisableThinkingMarkdown(providerId.value))
const disableAssistantMarkdown = computed(() => settingsStore.shouldDisableAssistantMarkdown(providerId.value))

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

const filteredWork = computed(() => {
  if (!hideThinking.value)
    return layout.value.work
  return layout.value.work.filter(g => g.type !== 'reasoning')
})

const hasVisibleWork = computed(() => {
  const work = filteredWork.value
  if (!work || work.length === 0)
    return false
  return work.some(g => {
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

function friendlyErrorMessage(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed'))
    return 'Network connection lost. Check your internet and try again.'
  if (lower.includes('econnrefused'))
    return 'Connection refused. The server may be unreachable.'
  if (lower.includes('econnreset'))
    return 'Connection was reset. The server may have dropped the request.'
  if (lower.includes('etimedout') || lower.includes('timed out'))
    return 'Request timed out. The server took too long to respond.'
  if (lower.includes('enotfound') || lower.includes('getaddrinfo'))
    return 'DNS lookup failed. Check your network connection.'
  if (lower.includes('abort') || lower.includes('interrupted'))
    return 'Generation was interrupted.'
  if (lower.includes('rate limit') || lower.includes('429'))
    return 'Rate limited by the provider. Please wait a moment and try again.'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden'))
    return 'Authentication failed. Check your API key in Settings.'
  return raw
}

const friendlyError = computed(() => {
  if (!displayError.value)
    return null
  return friendlyErrorMessage(displayError.value)
})

const fileEditEvents = computed(() => {
  if (!props.msg.toolEvents)
    return []
  return props.msg.toolEvents.filter(
    e => (e.toolName === 'edit_files' || e.toolName === 'write_file') && e.status === 'done',
  )
})

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

function copyThinking(key: string, text: string) {
  try {
    navigator.clipboard.writeText(text)
    copiedKey.value = key
    clearTimeout(copyTimeout)
    copyTimeout = window.setTimeout(() => {
      copiedKey.value = null
    }, 2000)
  }
  catch {}
}

const lastTextContent = computed(() => {
  const allGroups = [...layout.value.rest, ...layout.value.work]
  for (let i = allGroups.length - 1; i >= 0; i--) {
    const g = allGroups[i]!
    if ((g.type === 'text' || g.type === 'reasoning') && g.hasText)
      return g.text
  }
  return ''
})

const footerCopied = ref(false)
let footerCopyTimer: number | undefined

async function copyLastText() {
  if (!lastTextContent.value)
    return
  try {
    await navigator.clipboard.writeText(lastTextContent.value)
    footerCopied.value = true
    clearTimeout(footerCopyTimer)
    footerCopyTimer = window.setTimeout(() => { footerCopied.value = false }, 2000)
  }
  catch {}
}

const modelName = computed(() => props.msg.modelName ?? null)

const chatStoreForVersion = useChatStore()
const dvStoreForVersion = useDesignVersionStore()

const designVersion = computed(() => {
  const id = props.msg.designVersionId
  if (!id)
    return null
  for (const tab of chatStoreForVersion.tabs) {
    const v = tab.designVersions?.find(x => x.id === id)
    if (v)
      return v
  }
  const v2 = dvStoreForVersion.getByMessageId(props.msg.id)
  if (v2)
    return v2
  return {
    id,
    versionNumber: 0,
    createdAt: props.msg.timestamp.getTime(),
    label: 'Version',
    filesChanged: [] as string[],
    snapshotPath: '',
    messageId: props.msg.id,
    conversationId: '',
    projectPath: '',
    projectName: '',
  }
})

const designVersionCount = computed(() => {
  const v = designVersion.value
  if (!v)
    return 0
  for (const tab of chatStoreForVersion.tabs) {
    if (tab.designVersions?.some(x => x.id === v.id))
      return tab.designVersions.length
  }
  return dvStoreForVersion.versionsByConversation[v.conversationId]?.length ?? 1
})

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

const finishedTime = computed(() => {
  const elapsed = props.msg.elapsedSec
  if (elapsed != null && elapsed > 0) {
    return formatTime(new Date(props.msg.timestamp.getTime() + elapsed * 1000))
  }
  return formatTime(props.msg.timestamp)
})
</script>

<template>
  <div class="group flex max-w-full flex-col items-start gap-2.5 py-1">
    <div
      v-if="displayError"
      class="mx-auto mb-2.5 flex w-[calc(100%-24px)] max-w-full items-start gap-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] px-3 py-2 text-[12.5px] leading-[1.5]"
    >
      <AlertTriangle :size="13" :stroke-width="2" class="shrink-0 mt-px text-[var(--color-danger)]" />
      <span class="flex-1 min-w-0 text-[var(--color-text-secondary)]">{{ friendlyError }}</span>
    </div>

    <ActionGroupBlock
      v-if="(hasVisibleWork || isStreaming) && filteredWork.length > 0"
      :items="filteredWork"
      :streaming="isStreaming"
      :is-open="!isWorkCollapsed"
      :status-label="workLabel"
      :has-rest-content="layout.rest.length > 0"
      :provider-id="providerId"
      :hide-thinking="hideThinking"
      :disable-thinking-markdown="disableThinkingMarkdown"
      :disable-assistant-markdown="disableAssistantMarkdown"
      @toggle="isWorkCollapsed = !isWorkCollapsed"
    />

    <template v-for="group in layout.rest" :key="group.key">
      <div v-if="group.type === 'tools'" class="flex w-full flex-col gap-2.5">
        <ToolCallBlock v-for="event in group.events" :key="event.id" :event="event" />
      </div>

      <template v-else-if="group.type === 'text' && (group.hasText || group.streaming)">
        <MarkdownMessage
          v-if="!disableAssistantMarkdown"
          :content="group.text"
          :streaming="group.streaming"
        />
        <div
          v-else
          class="whitespace-pre-wrap break-words text-[13.5px] leading-[1.65] text-[var(--color-text-primary)]"
        >
          {{ group.text }}
        </div>
      </template>

      <ThinkingBlock
        v-else-if="group.type === 'reasoning' && (group.hasText || group.streaming) && !hideThinking"
        :text="group.text"
        :word-count="group.wordCount"
        :streaming="group.streaming"
        :is-open="isBlockOpen(group.key)"
        :copied="copiedKey === group.key"
        :disable-markdown="disableThinkingMarkdown"
        @toggle="toggleBlock(group.key)"
        @copy="copyThinking(group.key, group.text)"
      />
    </template>

    <FileEditChips v-if="!isStreaming && fileEditEvents.length > 0" :events="fileEditEvents" />

    <DesignVersionCard
      v-if="!isStreaming && designVersion"
      :version="designVersion as never"
      :can-compare="designVersionCount > 1"
      @preview="emit('previewVersion', designVersion!.id)"
      @compare="emit('compareVersion', designVersion!.id)"
    />

    <div v-if="!isStreaming" class="mr-1 flex items-center gap-1.5 opacity-0 transition-opacity duration-[150ms] group-hover:opacity-100">
      <button
        class="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-transparent bg-transparent text-(--color-text-tertiary) transition-colors duration-[120ms] hover:border-(--color-border-mid) hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)"
        :class="{ '!text-(--color-success-text)': footerCopied }"
        :title="footerCopied ? 'Copied!' : 'Copy message'"
        @click="copyLastText"
      >
        <Copy v-if="!footerCopied" :size="12" :stroke-width="2" />
        <Check v-else :size="12" :stroke-width="2.5" />
      </button>
      <span class="text-[11px] text-(--color-text-tertiary)">{{ finishedTime }}</span>
      <span v-if="modelName" class="text-[11px] text-(--color-text-dim)">{{ modelName }}</span>
    </div>

    <TypingIndicator :is-streaming="showTypingIndicator" />
  </div>
</template>
