<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import type { ChatMode } from '@/utils/ai'
import { ArrowDown, Plus, Square, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import ArtifactRenderer from '@/components/chat/ArtifactRenderer.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import MarkdownMessage from '@/components/chat/MarkdownMessage.vue'
import RestorePoint from '@/components/chat/RestorePoint.vue'
import ToolCallBadge from '@/components/chat/ToolCallBadge.vue'
import { useChatStore } from '@/stores/chat'
import { useCheckpointStore } from '@/stores/checkpoints'

const chat = useChatStore()
const checkpointStore = useCheckpointStore()
const { tabs, activeId, activeTab } = storeToRefs(chat)

// ── typing phrases ───────────────────────────────────────────────────────────
const phrases = ['Thinking...', 'Changing reality...', 'Reticulating splines...', 'Pondering...', 'Analyzing...', 'Consulting the oracle...', 'Processing thoughts...', 'Generating brilliance...', 'Synthesizing wisdom...', 'Crafting response...', 'Loading neurons...', 'Meditating...', 'Channeling wisdom...', 'Orchestrating magic...']
const currentPhraseIndex = ref(0)

watch(
  () => activeTab.value.isStreaming,
  (isStreaming, _, onCleanup) => {
    if (!isStreaming) {
      currentPhraseIndex.value = 0
      return
    }

    const interval = setInterval(() => {
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
    }, 2000)

    onCleanup(() => clearInterval(interval))
  },
  { immediate: true },
)

// ── auto-scroll & scroll button ───────────────────────────────────────────────
const threadRef = ref<HTMLElement | null>(null)
const showScrollButton = ref(false)

function onScroll(e: Event) {
  const target = e.target as HTMLElement
  // Show button if scrolled up more than 100px from the bottom
  const distance = target.scrollHeight - target.scrollTop - target.clientHeight
  showScrollButton.value = distance > 100
}

function scrollToBottom() {
  if (threadRef.value) {
    // Smooth scroll down to the bottom
    threadRef.value.scrollTo({
      top: threadRef.value.scrollHeight,
      behavior: 'smooth',
    })
    showScrollButton.value = false
  }
}

// Evaluate scroll state when switching tabs
watch(activeId, async () => {
  await nextTick()
  if (threadRef.value) {
    const distance = threadRef.value.scrollHeight - threadRef.value.scrollTop - threadRef.value.clientHeight
    showScrollButton.value = distance > 100
  }
})

watch(
  () => [
    activeTab.value.messages.length,
    activeTab.value.messages.at(-1)?.content?.length,
    activeTab.value.messages.at(-1)?.toolEvents?.length,
  ],
  async () => {
    await nextTick()
    // Auto-scroll instantly during streams if the user hasn't scrolled up
    if (threadRef.value && !showScrollButton.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  },
)

// ── send / stop ───────────────────────────────────────────────────────────────
function send(text: string, mode: ChatMode) {
  chat.sendMessage(text, mode)
}

function stop() {
  chat.stopGeneration()
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getGroupedParts(msg: Message) {
  if (!msg.parts || msg.parts.length === 0)
    return null
  const groups: Array<{ type: 'text'; text: string; key: string } | { type: 'tools'; events: ToolEvent[]; key: string }> = []
  for (let i = 0; i < msg.parts.length; i++) {
    const part = msg.parts[i]!
    if (part.type === 'text') {
      groups.push({ type: 'text', text: part.text, key: `text-${i}` })
    }
    else if (part.type === 'tool') {
      const event = msg.toolEvents?.find(e => e.id === part.toolCallId)
      if (event) {
        const last = groups[groups.length - 1]
        if (last?.type === 'tools') {
          last.events.push(event)
        }
        else {
          groups.push({ type: 'tools', events: [event], key: `tools-${i}` })
        }
      }
    }
  }
  return groups
}

// ── @mention highlighting in user bubbles ─────────────────────────────────────

interface MsgPart { type: 'text' | 'mention'; value: string }

/**
 * Split a user message string into plain text and @mention parts.
 * @src/index.ts and @src/ are rendered as highlighted chips.
 */
function splitMentions(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  const regex = /@[\w./\-]+/g
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'mention', value: match[0] })
    lastIndex = match.index + match[0].length
    match = regex.exec(text)
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return parts
}

/** True if the content contains any @mention tokens. */
function hasMentions(text: string): boolean {
  return /@[\w.\-]+/.test(text)
}

// ── sub-agent tab helpers ─────────────────────────────────────────────────────

const isSubAgentTab = computed(() => !!activeTab.value.subAgent)

/** Navigate to the parent tab that spawned this sub-agent (if still open). */
function goToParent() {
  const parentId = activeTab.value.subAgent?.parentTabId
  if (!parentId)
    return
  const parentTab = chat.tabs.find(t => t.id === parentId)
  if (parentTab)
    chat.activeId = parentId
}

const parentTabExists = computed(() => {
  const parentId = activeTab.value.subAgent?.parentTabId
  return !!parentId && chat.tabs.some(t => t.id === parentId)
})

/** Filter out the "user" mission message from sub-agent tabs — the banner shows it. */
function getSubAgentMessages(messages: Message[]) {
  return messages.filter(m => m.role !== 'user')
}

// ── checkpoint / restore-point helpers ────────────────────────────────────────

/** Reactive list of checkpoints for the active tab. */
const activeCheckpoints = computed(
  () => checkpointStore.getCheckpoints(activeTab.value.id),
)

/**
 * Find a checkpoint that sits at a given message index.
 * Used in the template to render restore points between message pairs.
 */
function checkpointAtIndex(msgIndex: number) {
  return activeCheckpoints.value.find(c => c.messageIndex === msgIndex)
}

/** Handle the restore event from a RestorePoint component. */
async function handleRestore(checkpointId: string) {
  await chat.restoreToCheckpoint(activeTab.value.id, checkpointId)
}
</script>

<template>
  <div class="chat-root">
    <div class="tab-bar">
      <div class="tab-list">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{
            'tab--active': tab.id === activeId,
            'tab--subagent': !!tab.subAgent,
          }"
          @click="activeId = tab.id"
        >
          <span v-if="tab.isStreaming" class="tab-streaming-dot" />
          <span class="tab-title">{{ tab.title }}</span>
          <span
            class="tab-close"
            role="button"
            aria-label="Close tab"
            @click.stop="chat.closeTab(tab.id)"
          >
            <X :size="11" :stroke-width="2" />
          </span>
        </button>
      </div>

      <button
        class="tab-new"
        :class="{ 'tab-new--hidden': tabs.length >= 9 }"
        aria-label="New chat"
        :disabled="tabs.length >= 9"
        @click="chat.addTab"
      >
        <Plus :size="14" :stroke-width="1.8" />
      </button>
    </div>

    <div class="chat-body">
      <Transition name="fade" mode="out-in">
        <!-- Landing (empty normal tab) -->
        <div v-if="activeTab.messages.length === 0 && !isSubAgentTab" key="landing" class="landing">
          <div class="center-col">
            <ChatInput
              :is-streaming="activeTab.isStreaming"
              @send="send"
              @stop="stop"
            />
          </div>
        </div>

        <!-- Sub-agent conversation -->
        <div v-else-if="isSubAgentTab" key="subagent" class="conversation">
          <!-- Mission banner -->
          <div class="sa-banner">
            <div class="sa-banner-inner">
              <div class="sa-banner-body">
                <div class="sa-banner-header">
                  <span class="sa-banner-name">
                    {{ activeTab.subAgent!.personality.charAt(0).toUpperCase() + activeTab.subAgent!.personality.slice(1) }} Agent
                  </span>
                </div>
                <p class="sa-banner-mission">
                  {{ activeTab.subAgent!.mission }}
                </p>
              </div>
            </div>
          </div>

          <div class="thread-container">
            <div class="scroll-blur-top" />

            <div ref="threadRef" class="thread" @scroll="onScroll">
              <div class="thread-inner">
                <TransitionGroup name="msg">
                  <template v-for="msg in getSubAgentMessages(activeTab.messages)" :key="msg.id">
                    <div class="assistant-row">
                      <div v-if="msg.error" class="assistant-error">
                        ⚠ {{ msg.error }}
                      </div>

                      <template v-for="(group, gIdx) in getGroupedParts(msg)" :key="group.key">
                        <div v-if="group.type === 'tools'" class="tool-events">
                          <template v-for="event in group.events" :key="event.id">
                            <ToolCallBadge :event="event" />
                            <ArtifactRenderer :event="event" />
                          </template>
                        </div>

                        <MarkdownMessage
                          v-else-if="group.type === 'text' && group.text"
                          :content="group.text"
                          :streaming="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id && gIdx === getGroupedParts(msg)!.length - 1"
                        />
                      </template>

                      <template v-if="!getGroupedParts(msg)">
                        <div
                          v-if="msg.toolEvents && msg.toolEvents.length > 0"
                          class="tool-events"
                        >
                          <template v-for="event in msg.toolEvents" :key="event.id">
                            <ToolCallBadge :event="event" />
                            <ArtifactRenderer :event="event" />
                          </template>
                        </div>

                        <MarkdownMessage
                          v-if="msg.content"
                          :content="msg.content"
                          :streaming="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id"
                        />
                      </template>

                      <div
                        v-if="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id && (!msg.parts || msg.parts.length === 0 || (msg.parts.length === 1 && msg.parts[0]!.type === 'text' && !msg.parts[0]!.text))"
                        class="typing"
                      >
                        <div class="hexagon-hive">
                          <div class="hex h1" />
                          <div class="hex h2" />
                          <div class="hex h3" />
                          <div class="hex h4" />
                          <div class="hex h5" />
                          <div class="hex h6" />
                          <div class="hex h7" />
                        </div>
                        <span class="typing-text">{{ phrases[currentPhraseIndex] }}</span>
                      </div>
                    </div>
                  </template>
                </TransitionGroup>
              </div>
            </div>

            <div class="scroll-blur-bottom" />

            <Transition name="btn-pop">
              <button
                v-if="showScrollButton"
                class="scroll-down-btn sa-scroll-down-btn"
                aria-label="Scroll to bottom"
                @click="scrollToBottom"
              >
                <ArrowDown :size="16" :stroke-width="2.5" />
              </button>
            </Transition>
          </div>

          <!-- Sub-agent footer (read-only — no ChatInput) -->
          <div class="sa-footer">
            <div class="sa-footer-inner">
              <button
                v-if="parentTabExists"
                class="sa-footer-parent-btn"
                title="Go to the tab that spawned this agent"
                @click="goToParent"
              >
                ← Back to parent
              </button>
              <span v-else class="sa-footer-orphan">Spawned by a closed tab</span>

              <div class="sa-footer-spacer" />

              <button
                v-if="activeTab.isStreaming"
                class="sa-footer-stop"
                aria-label="Stop sub-agent"
                @click="chat.stopGeneration(activeTab.id)"
              >
                <Square :size="12" :stroke-width="0" style="fill: currentColor; margin-right: 6px;" />
                Stop
              </button>

              <span
                v-else
                class="sa-footer-done"
                :class="`sa-footer-done--${activeTab.subAgent!.status}`"
              >
                {{ activeTab.subAgent!.status === 'done' ? 'Completed' : 'Stopped' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Normal conversation -->
        <div v-else key="conversation" class="conversation">
          <div class="thread-container">
            <!-- Smooth fade blur at the top -->
            <div class="scroll-blur-top" />

            <div ref="threadRef" class="thread" @scroll="onScroll">
              <div class="thread-inner">
                <TransitionGroup name="msg">
                  <template v-for="(msg, msgIdx) in activeTab.messages" :key="msg.id">
                    <!-- Restore point divider: shown before each user message -->
                    <RestorePoint
                      v-if="msg.role === 'user' && checkpointAtIndex(msgIdx)"
                      :key="`rp-${msg.id}`"
                      :checkpoint="checkpointAtIndex(msgIdx)!"
                      :disabled="activeTab.isStreaming"
                      @restore="handleRestore"
                    />

                    <div v-if="msg.role === 'user'" class="user-row">
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
                            <template v-else>
                              {{ part.value }}
                            </template>
                          </template>
                        </template>
                        <template v-else>
                          {{ msg.content }}
                        </template>
                      </div>
                      <span class="user-time">{{ formatTime(msg.timestamp) }}</span>
                    </div>

                    <div v-else class="assistant-row">
                      <div v-if="msg.error" class="assistant-error">
                        ⚠ {{ msg.error }}
                      </div>

                      <template v-for="(group, gIdx) in getGroupedParts(msg)" :key="group.key">
                        <div v-if="group.type === 'tools'" class="tool-events">
                          <template v-for="event in group.events" :key="event.id">
                            <ToolCallBadge :event="event" />
                            <ArtifactRenderer :event="event" />
                          </template>
                        </div>

                        <MarkdownMessage
                          v-else-if="group.type === 'text' && group.text"
                          :content="group.text"
                          :streaming="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id && gIdx === getGroupedParts(msg)!.length - 1"
                        />
                      </template>

                      <!-- Fallback for legacy messages that didn't have 'parts' -->
                      <template v-if="!getGroupedParts(msg)">
                        <div
                          v-if="msg.toolEvents && msg.toolEvents.length > 0"
                          class="tool-events"
                        >
                          <template v-for="event in msg.toolEvents" :key="event.id">
                            <ToolCallBadge :event="event" />
                            <ArtifactRenderer :event="event" />
                          </template>
                        </div>

                        <MarkdownMessage
                          v-if="msg.content"
                          :content="msg.content"
                          :streaming="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id"
                        />
                      </template>

                      <div
                        v-if="activeTab.isStreaming && msg.id === activeTab.messages.at(-1)?.id && (!msg.parts || msg.parts.length === 0 || (msg.parts.length === 1 && msg.parts[0]!.type === 'text' && !msg.parts[0]!.text))"
                        class="typing"
                      >
                        <div class="hexagon-hive">
                          <div class="hex h1" />
                          <div class="hex h2" />
                          <div class="hex h3" />
                          <div class="hex h4" />
                          <div class="hex h5" />
                          <div class="hex h6" />
                          <div class="hex h7" />
                        </div>
                        <span class="typing-text">{{ phrases[currentPhraseIndex] }}</span>
                      </div>
                    </div>
                  </template>
                </TransitionGroup>
              </div>
            </div>

            <!-- Smooth fade blur at the bottom -->
            <div class="scroll-blur-bottom" />
          </div>

          <div class="convo-input-wrap">
            <Transition name="btn-pop">
              <button
                v-if="showScrollButton"
                class="scroll-down-btn"
                aria-label="Scroll to bottom"
                @click="scrollToBottom"
              >
                <ArrowDown :size="16" :stroke-width="2.5" />
              </button>
            </Transition>

            <div class="center-col">
              <ChatInput
                :is-streaming="activeTab.isStreaming"
                @send="send"
                @stop="stop"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.chat-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

.center-col {
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
  padding-inline: 20px;
}

/* ── tab bar ──────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  padding-inline: 8px 4px;
  background: var(--color-bg-surface);
  box-shadow: inset 0 -1px 0 var(--color-border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-list {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 140px;
  min-width: 140px;
  height: 30px;
  padding-inline: 10px 8px;
  border-top: 1px solid transparent;
  border-left: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 450;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}
.tab:not(.tab--active):hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab--active {
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  border-top-color: var(--color-border-subtle);
  border-left-color: var(--color-border-subtle);
  border-right-color: var(--color-border-subtle);
  border-bottom-color: var(--color-bg-base);
  cursor: default;
}
.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-close {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}
.tab:not(.tab--active):hover .tab-close,
.tab--active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tab-streaming-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-bright);
  flex-shrink: 0;
  animation: tab-pulse 1.4s ease-in-out infinite;
}
@keyframes tab-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.65);
  }
}

.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.tab-new:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tab-new--hidden {
  opacity: 0;
  pointer-events: none;
}

/* ── body ─────────────────────────────────────────────────────────────────── */
.chat-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* ── landing ──────────────────────────────────────────────────────────────── */
.landing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
}
.landing .center-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── conversation ─────────────────────────────────────────────────────────── */
.conversation {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.thread-container {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.thread {
  flex: 1;
  overflow-y: auto;
  padding-top: 32px;
  padding-bottom: 48px; /* Extra space to ensure bottom messages clear the blur */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}
.thread-inner {
  width: 100%;
  max-width: 670px;
  margin-inline: auto;
  padding-inline: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Blurs ────────────────────────────────────────────────────────────────── */
.scroll-blur-top,
.scroll-blur-bottom {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 5;
}

.scroll-blur-top {
  top: 0;
  height: 32px;
  background: linear-gradient(to bottom, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
}

.scroll-blur-bottom {
  bottom: 0;
  height: 48px;
  background: linear-gradient(to top, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to top, black 0%, transparent 100%);
  mask-image: linear-gradient(to top, black 0%, transparent 100%);
}

/* ── user message — square style ────────────────────────────────────────────── */
.user-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.user-pill {
  display: inline-block;
  max-width: 72%;
  padding: 8px 16px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--color-text-primary);
  word-break: break-word;
  white-space: pre-wrap;
}
.user-time {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  padding-right: 4px;
}

/* @mention chip inside user bubble */
.mention-chip {
  display: inline;
  background: var(--color-accent-muted-plus);
  color: var(--color-accent-text);
  border: 1px solid var(--color-accent-dim);
  border-radius: 4px;
  padding: 0 5px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  white-space: nowrap;
  /* Sits inline with the surrounding text */
  vertical-align: baseline;
  line-height: 1.5;
}

/* ── assistant message ────────────────────────────────────────────────────── */
.assistant-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-events {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}

.assistant-error {
  font-size: 13px;
  color: var(--color-danger-text);
  padding: 8px 12px;
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
}

/* ── typing indicator (hexagon hive) ──────────────────────────────────────── */
.typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 0;
}

.typing-text {
  font-size: 13.5px;
  color: var(--color-text-tertiary);
  font-style: italic;
  min-width: 110px;
  transition: opacity 200ms ease;
}

.hexagon-hive {
  position: relative;
  width: 24px;
  height: 24px;
}

.hex {
  position: absolute;
  width: 4px;
  height: 4px;
  background: var(--color-accent-dim);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);

  /* 1. Hardware acceleration for silky smooth sub-pixel rendering */
  transform: translate3d(-50%, -50%, 0);
  will-change: transform, opacity;

  /* 2. Faster, more fluid easing curve */
  animation: pulse-hex 1.5s infinite cubic-bezier(0.4, 0, 0.2, 1);
}

/* Central hexagon */
.h1 {
  top: 50%;
  left: 50%;
  animation-delay: 0s;
}

/* 3. Surrounding hexagons positioned in a ring with a tighter wave delay */
.h2 {
  top: 20%;
  left: 50%;
  animation-delay: 0.1s;
}
.h3 {
  top: 35%;
  left: 75%;
  animation-delay: 0.2s;
}
.h4 {
  top: 65%;
  left: 75%;
  animation-delay: 0.3s;
}
.h5 {
  top: 80%;
  left: 50%;
  animation-delay: 0.4s;
}
.h6 {
  top: 65%;
  left: 25%;
  animation-delay: 0.5s;
}
.h7 {
  top: 35%;
  left: 25%;
  animation-delay: 0.6s;
}

@keyframes pulse-hex {
  0%,
  100% {
    opacity: 1;
    transform: translate3d(-50%, -50%, 0) scale(1);
  }
  50% {
    /* 4. Softer scale and opacity jump */
    opacity: 0.4;
    transform: translate3d(-50%, -50%, 0) scale(0.6);
  }
}

/* ── input bar & scroll button ────────────────────────────────────────────── */
.convo-input-wrap {
  position: relative;
  flex-shrink: 0;
  padding-block: 10px 20px;
  z-index: 10;
}

.scroll-down-btn {
  position: absolute;
  top: -46px;
  left: 50%;
  transform: translate(-50%, 0) scale(1); /* Explicit resting state */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-mid);
  color: var(--color-text-tertiary);
  cursor: pointer;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.04),
    0 0 0 1px color-mix(in srgb, var(--color-accent-bright) 10%, transparent);
  z-index: 10;
  will-change: transform, opacity; /* Fixes layout jank on pop-in */
  transition:
    background 150ms ease,
    color 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.scroll-down-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.sa-scroll-down-btn {
  bottom: 10px;
  top: auto;
}

/* ── sub-agent mission banner ────────────────────────────────────────────── */
.sa-banner {
  display: flex;
  justify-content: center;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.sa-banner-inner {
  width: 100%;
  max-width: 670px;
  padding: 24px 20px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.sa-banner-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  margin-top: 2px;
}
.sa-banner-icon--info {
  background: var(--color-info-muted);
  color: var(--color-info-text);
}
.sa-banner-icon--success {
  background: var(--color-success-muted);
  color: var(--color-success-text);
}
.sa-banner-icon--warning {
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  color: var(--color-warning-text);
}
.sa-banner-icon--accent {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.sa-banner-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sa-banner-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sa-banner-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-primary);
}

.sa-banner-mission {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  font-weight: 450;
  word-break: break-word;
}

/* ── sub-agent footer ────────────────────────────────────────────────────── */
.sa-footer {
  display: flex;
  justify-content: center;
  padding: 12px 0 24px;
  flex-shrink: 0;
  background: var(--color-bg-base);
  position: relative;
  z-index: 10;
}

.sa-footer-inner {
  width: 100%;
  max-width: 720px;
  padding: 0 20px;
  display: flex;
  align-items: center;
}

.sa-footer-parent-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.sa-footer-parent-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  border-color: var(--color-border-mid);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.sa-footer-orphan {
  font-size: 13px;
  color: var(--color-text-dim);
  font-style: italic;
  padding-left: 4px;
}

.sa-footer-spacer {
  flex: 1;
}

.sa-footer-stop {
  display: flex;
  align-items: center;
  height: 34px;
  padding-inline: 16px;
  border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger-text);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 110ms ease,
    border-color 110ms ease;
}
.sa-footer-stop:hover {
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
}

.sa-footer-done {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sa-footer-done--done {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success-text);
  border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
}
.sa-footer-done--error {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger-text);
  border: 1px solid color-mix(in srgb, var(--color-danger) 20%, transparent);
}

/* ── transitions ──────────────────────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.msg-enter-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* Scroll Button extremely smooth spring transition */
.btn-pop-enter-active {
  transition:
    opacity 250ms ease-out,
    transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.btn-pop-leave-active {
  transition:
    opacity 200ms ease-in,
    transform 200ms ease-in;
}
.btn-pop-enter-from,
.btn-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px) scale(0.85);
}
</style>
