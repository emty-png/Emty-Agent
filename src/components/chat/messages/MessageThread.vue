<script setup lang="ts">
import type { Message } from '@/stores/chat'
import type { Attachment } from '@/stores/chat/attachment-types'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { SESSION_COMPACTED_DIVIDER, SESSION_COMPACTING_DIVIDER } from '@/stores/chat/constants'
import { useCheckpointStore } from '@/stores/checkpoints'
import AssistantMessage from './AssistantMessage.vue'
import RestorePoint from './RestorePoint.vue'
import UserMessage from './UserMessage.vue'

const props = defineProps<{
  messages: Message[]
  isStreaming: boolean
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
  return message.role === 'assistant' && (content === SESSION_COMPACTED_DIVIDER || content === SESSION_COMPACTING_DIVIDER)
}

function sessionDividerLabel(message: Message) {
  return message.content.trim() === SESSION_COMPACTING_DIVIDER
    ? 'Session Compacting...'
    : 'Session Compacted'
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
</script>

<template>
  <TransitionGroup name="msg" :css="!isStreaming">
    <template v-for="(msg, msgIdx) in displayMessages" :key="msg.id">
      <RestorePoint
        v-if="!isSubAgent && msg.role === 'user' && checkpointAtIndex(msgIdx)"
        :key="`rp-${msg.id}`"
        :checkpoint="checkpointAtIndex(msgIdx)!"
        :disabled="isStreaming"
        @restore="handleRestore"
      />

      <div v-if="isSessionDivider(msg)" class="session-divider">
        <div class="session-divider-line" />
        <div class="session-divider-label">
          <span class="session-divider-text">{{ sessionDividerLabel(msg) }}</span>
        </div>
        <div class="session-divider-line" />
      </div>

      <UserMessage
        v-else-if="msg.role === 'user'"
        :msg="msg"
        @preview-attachment="emit('previewAttachment', $event)"
      />

      <AssistantMessage
        v-else
        :msg="msg"
        :is-streaming="isStreaming && msg.id === messages.at(-1)?.id"
      />
    </template>
  </TransitionGroup>
</template>

<style scoped>
.session-divider {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  padding: 2px 0;
  user-select: none;
  opacity: 0.45;
  transition: opacity 200ms ease;
}

.session-divider:hover {
  opacity: 1;
}

.session-divider-line {
  flex: 1;
  height: 1px;
  border-top: 1px dashed var(--color-border-mid);
  opacity: 0.5;
}

.session-divider-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  color: var(--color-text-dim);
  flex-shrink: 0;
}

.session-divider-text {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
