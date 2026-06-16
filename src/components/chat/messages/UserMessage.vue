<script setup lang="ts">
import type { Message } from '@/stores/chat'
import type { Attachment } from '@/stores/chat/attachment-types'
import { Copy, FileText } from 'lucide-vue-next'
import { ref } from 'vue'
import { formatFileSize } from '@/stores/chat/attachment-types'

defineProps<{
  msg: Message
}>()

const emit = defineEmits<{
  previewAttachment: [Attachment]
}>()

interface MsgPart { type: 'text' | 'mention' | 'skill'; value: string }

/**
 * Split a user message string into plain text, @mention, and [skill:id] parts.
 * @src/index.ts and @src/ are rendered as highlighted chips.
 * [skill:id] are rendered as skill chips.
 */
function splitMentions(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  const regex = /@\[([\w./\-]+)\]|\[skill:[^\]]+\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const type = match[0].startsWith('@[') ? 'mention' : 'skill'
    parts.push({ type, value: match[0] })
    lastIndex = match.index + match[0].length
    match = regex.exec(text)
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return parts
}

/** True if the content contains any @mention or [skill:id] tokens. */
function hasMentions(text: string): boolean {
  return /@\[[\w./\-]+\]|\[skill:[^\]]+\]/.test(text)
}

function getMessageAttachments(msg: Message): Attachment[] {
  return ((msg as Message & { attachments?: Attachment[] | null }).attachments) ?? []
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const copied = ref(false)
async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch (err) {
    console.error('Failed to copy', err)
  }
}
</script>

<template>
  <div class="user-row">
    <div class="user-pill">
      <!--
        If the message contains @mentions, split and render them
        as highlighted chips. Otherwise render plain text.
        white-space: pre-wrap is preserved in both branches.
      -->
      <template v-if="hasMentions(msg.content)">
        <template
          v-for="(part, i) in splitMentions(msg.content)"
          :key="i"
        >
          <span
            v-if="part.type === 'mention'"
            class="mention-chip"
          >{{ part.value }}</span>
          <span
            v-else-if="part.type === 'skill'"
            class="skill-chip"
          >{{ part.value }}</span>
          <template v-else>
            {{ part.value }}
          </template>
        </template>
      </template>
      <template v-else-if="msg.content">
        {{ msg.content }}
      </template>
      <!-- Attachment thumbnails inside user bubble -->
      <div v-if="getMessageAttachments(msg).length > 0" class="user-attachments">
        <div
          v-for="att in getMessageAttachments(msg)"
          :key="att.id"
          class="user-att-chip"
          @click="emit('previewAttachment', att)"
        >
          <img
            v-if="att.type === 'image'"
            :src="att.dataUrl"
            :alt="att.name"
            class="user-att-img"
          >
          <div v-else class="user-att-file">
            <FileText :size="14" :stroke-width="1.6" />
            <span class="user-att-name">{{ att.name }}</span>
            <span class="user-att-size">{{ formatFileSize(att.size) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="user-meta">
      <button class="user-copy-btn" :class="{ 'user-copy-btn--copied': copied }" :title="copied ? 'Copied!' : 'Copy message'" @click="copyMessage(msg.content)">
        <Copy :size="12" :stroke-width="2" />
      </button>
      <span class="user-time">{{ formatTime(msg.timestamp) }}</span>
    </div>
  </div>
</template>

<style scoped>
.user-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  padding-block: 6px;
}

.user-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 4px;
  opacity: 0;
  transition: opacity 150ms ease;
}

.user-row:hover .user-meta {
  opacity: 1;
}

.user-time {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.user-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.user-copy-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  color: var(--color-text-secondary);
}

.user-copy-btn--copied {
  color: var(--color-success-text);
}
.user-pill {
  max-width: 85%;
  padding: 10px 14px;
  background: var(--color-accent-muted-plus);
  color: var(--color-text-primary);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg);
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.mention-chip {
  display: inline-flex;
  align-items: center;
  color: var(--color-accent-text);
  background: var(--color-accent-muted-plus);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-xs);
  padding: 0 4px;
  margin: 0 2px;
  vertical-align: baseline;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  color: var(--color-success-text);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-success) 28%, transparent);
  border-radius: var(--radius-xs);
  padding: 0 4px;
  margin: 0 2px;
  vertical-align: baseline;
}

/* ── user attachments inside bubble ────────────────────────────────────────── */
.user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-accent-dim);
}
.user-att-chip {
  position: relative;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-base);
  border: 1px solid var(--color-accent-dim);
  cursor: pointer;
  transition: opacity 120ms ease;
  max-width: 200px;
}
.user-att-chip:hover {
  opacity: 0.85;
}
.user-att-img {
  display: block;
  width: auto;
  max-width: 140px;
  height: 60px;
  object-fit: cover;
}
.user-att-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  color: var(--color-accent-text);
}
.user-att-name {
  font-size: 12px;
  font-weight: 500;
  max-width: 100px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-att-size {
  font-size: 10px;
  opacity: 0.7;
}
</style>
