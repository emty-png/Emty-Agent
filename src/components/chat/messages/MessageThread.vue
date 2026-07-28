<script setup lang="ts">
import type { Message } from '@/stores/chat'
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import type { AgentStatus } from '@/stores/chat/core/types'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agent/status'
import { BG_TASK_COMPLETED_DIVIDER, SESSION_COMPACTED_DIVIDER, SESSION_COMPACTING_DIVIDER } from '@/stores/chat/core/constants'
import { useCheckpointStore } from '@/stores/checkpoints'
import RestorePointBanner from '../banners/RestorePointBanner.vue'
import AssistantMessage from './AssistantMessage.vue'
import UserMessage from './UserMessage.vue'

const props = defineProps<{
  messages: Message[]
  agentStatus: AgentStatus
  isSubAgent: boolean
}>()

const emit = defineEmits<{
  previewAttachment: [Attachment]
}>()

const chat = useChatStore()
const checkpointStore = useCheckpointStore()

// We need the activeTab to get checkpoints
const activeCheckpoints = computed(() => {
  return checkpointStore.getCheckpoints(chat.activeTab.id)
})

function checkpointAtIndex(msgIndex: number) {
  return activeCheckpoints.value.find(c => c.messageIndex === msgIndex)
}

function isSessionDivider(message: Message) {
  const content = message.content.trim()
  return message.role === 'assistant' && (content === SESSION_COMPACTED_DIVIDER || content === SESSION_COMPACTING_DIVIDER || content === BG_TASK_COMPLETED_DIVIDER)
}

function sessionDividerLabel(message: Message) {
  const content = message.content.trim()
  if (content === SESSION_COMPACTING_DIVIDER)
    return 'Session Compacting...'
  if (content === BG_TASK_COMPLETED_DIVIDER)
    return 'BG Task Completed'
  return 'Session Compacted'
}

async function handleRestore(checkpointId: string) {
  await chat.restoreToCheckpoint(chat.activeTab.id, checkpointId)
}

const displayMessages = computed(() => {
  if (props.isSubAgent) {
    return props.messages.filter(m => m.role !== 'user')
  }
  return props.messages
})

const isStreaming = computed(() => isStreamingStatus(props.agentStatus))

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const sessionDividerClasses = 'flex items-center gap-0 w-full py-0.5 select-none opacity-45 transition-opacity duration-200 ease-[ease] hover:opacity-100'
const sessionDividerLineClasses = 'flex-1 h-px border-t border-dashed border-(--color-border-mid) opacity-50'
const sessionDividerLabelClasses = 'flex items-center gap-[5px] px-2.5 text-(--color-text-dim) shrink-0'
const sessionDividerTextClasses = 'text-[11px] font-semibold tracking-[0.04em] uppercase'
</script>

<template>
  <TransitionGroup name="msg" :css="!isStreaming">
    <template v-for="(msg, msgIdx) in displayMessages" :key="msg.id">
      <RestorePointBanner
        v-if="!isSubAgent && msg.role === 'user' && !msg.isBgNotification && checkpointAtIndex(msgIdx)"
        :key="`rp-${msg.id}`"
        :checkpoint="checkpointAtIndex(msgIdx)!"
        :disabled="isStreaming"
        @restore="handleRestore"
      />

      <div v-if="isSessionDivider(msg)" :class="sessionDividerClasses">
        <div :class="sessionDividerLineClasses" />
        <div :class="sessionDividerLabelClasses">
          <span :class="sessionDividerTextClasses">{{ sessionDividerLabel(msg) }}</span>
        </div>
        <div :class="sessionDividerLineClasses" />
      </div>

      <UserMessage
        v-else-if="msg.role === 'user' && !msg.isBgNotification"
        :msg="msg"
        @preview-attachment="emit('previewAttachment', $event)"
      />

      <AssistantMessage
        v-else-if="!msg.isBgNotification"
        :msg="msg"
        :agent-status="msg.id === messages.at(-1)?.id && msg.elapsedSec == null ? props.agentStatus : { type: 'idle' }"
      />
    </template>
  </TransitionGroup>
</template>
