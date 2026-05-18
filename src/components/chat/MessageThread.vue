<script setup lang="ts">
import type { Message } from '@/stores/chat'
import type { Attachment } from '@/stores/chat/attachment-types'
import { computed } from 'vue'
import AssistantMessage from '@/components/chat/AssistantMessage.vue'
import RestorePoint from '@/components/chat/RestorePoint.vue'
import UserMessage from '@/components/chat/UserMessage.vue'
import { useChatStore } from '@/stores/chat'
import { useCheckpointStore } from '@/stores/checkpoints'

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

      <UserMessage
        v-if="msg.role === 'user'"
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
