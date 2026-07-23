<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()

function removeItem(id: string) {
  chat.removeFromQueue(id)
}

function truncate(text: string, max: number): string {
  if (text.length <= max)
    return text
  return `${text.slice(0, max)}\u2026`
}
</script>

<template>
  <div class="mx-2 mt-1.5 flex flex-col gap-0.5">
    <div
      v-for="item in chat.activeTab.messageQueue"
      :key="item.id"
      class="group flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] px-2 py-1 text-[12px] text-(--color-text-secondary)"
    >
      <span class="flex-1 truncate">{{ truncate(item.text, 80) }}</span>
      <span
        v-if="item.attachments.length > 0"
        class="shrink-0 text-[10px] opacity-60"
      >+{{ item.attachments.length }}</span>
      <button
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] opacity-0 hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] hover:text-(--color-danger-text) group-hover:opacity-100"
        aria-label="Remove from queue"
        @click="removeItem(item.id)"
      >
        <X :size="10" :stroke-width="2.5" />
      </button>
    </div>
  </div>
</template>
