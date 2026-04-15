<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const { tabs, activeId, activeTab } = storeToRefs(chat)

// scroll to bottom on new messages
const threadRef = ref<HTMLElement | null>(null)
watch(
  () => activeTab.value.messages.length,
  async () => {
    await nextTick()
    if (threadRef.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  },
)

function send(text: string) {
  chat.sendMessage(text)
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="chat-root">
    <!-- ── tab bar ───────────────────────────────────────────────────── -->
    <div class="tab-bar">
      <div class="tab-list">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="[{ 'tab--active': tab.id === activeId }]"
          @click="activeId = tab.id"
        >
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

      <!-- new tab -->
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

    <!-- ── content: landing or conversation ──────────────────────────── -->
    <div class="chat-body">
      <!-- ╔══════════════════════════════╗
           ║  LANDING (no messages yet)   ║
           ╚══════════════════════════════╝ -->
      <Transition name="fade" mode="out-in">
        <div v-if="activeTab.messages.length === 0" key="landing" class="landing">
          <div class="landing-input-wrap">
            <ChatInput @send="send" />
          </div>
        </div>

        <!-- ╔══════════════════════════════╗
             ║  CONVERSATION (has messages) ║
             ╚══════════════════════════════╝ -->
        <div v-else key="conversation" class="conversation">
          <!-- message thread -->
          <div ref="threadRef" class="thread">
            <TransitionGroup name="msg">
              <div
                v-for="msg in activeTab.messages"
                :key="msg.id"
                class="msg-row"
                :class="[`msg-row--${msg.role}`]"
              >
                <!-- assistant avatar -->
                <div v-if="msg.role === 'assistant'" class="avatar">
                  <span class="avatar-glyph">✦</span>
                </div>

                <div class="msg-wrap">
                  <div class="bubble" :class="[`bubble--${msg.role}`]">
                    <template v-if="msg.content === '...'">
                      <div class="typing">
                        <span />
                        <span />
                        <span />
                      </div>
                    </template>
                    <template v-else>
                      {{ msg.content }}
                    </template>
                  </div>
                  <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
                </div>
              </div>
            </TransitionGroup>
          </div>

          <!-- pinned input -->
          <div class="convo-input-wrap">
            <ChatInput @send="send" />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────── */
.chat-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

/* ── tab bar ─────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: flex-end;
  height: 36px;
  min-height: 36px;
  padding-inline: 8px 4px;
  padding-bottom: 0;
  gap: 0;
  background: var(--color-bg-surface);
  /* NO border-bottom here — border lives on each tab instead */
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-list {
  display: flex;
  align-items: flex-end;
  gap: 0;
  flex: 1;
  min-width: 0;
}

/* ── individual tab ──────────────────────────────────────────────────────── */
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  /* fixed width for visual consistency */
  width: 140px;
  min-width: 140px;
  max-width: 140px;
  height: 30px;
  padding-inline: 12px 8px;
  /* border on all sides including bottom — bottom color will be overridden for active */
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
  white-space: nowrap;
}

.tab-close {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  opacity: 0; /* hidden by default on inactive tabs */
  transition:
    background 120ms ease,
    color 120ms ease,
    opacity 120ms ease;
}

/* show on hover of the whole tab */
.tab:not(.tab--active):hover .tab-close {
  opacity: 1;
}

/* always visible on active tab */
.tab--active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* ── new tab button ──────────────────────────────────────────────────────── */
.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 4px; /* sit just above the tab bottom-border line */
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

/* ── chat body ───────────────────────────────────────────────────────────── */
.chat-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* ── landing ─────────────────────────────────────────────────────────────── */
.landing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.landing-input-wrap {
  width: 100%;
  max-width: 640px;
}

/* ── conversation ────────────────────────────────────────────────────────── */
.conversation {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

/* ── thread ──────────────────────────────────────────────────────────────── */
.thread {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}

/* ── message row ─────────────────────────────────────────────────────────── */
.msg-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.msg-row--user {
  flex-direction: row-reverse;
}

.msg-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 68%;
}

.msg-row--user .msg-wrap {
  align-items: flex-end;
}

.msg-row--assistant .msg-wrap {
  align-items: flex-start;
}

/* ── avatar ──────────────────────────────────────────────────────────────── */
.avatar {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--color-ember-glow);
  border: 1px solid var(--color-ember-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-glyph {
  font-size: 11px;
  color: var(--color-ember-text);
  line-height: 1;
}

/* ── bubble ──────────────────────────────────────────────────────────────── */
.bubble {
  padding: 9px 13px;
  border-radius: var(--radius-lg);
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
}

.bubble--user {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-bottom-right-radius: 4px;
}

.bubble--assistant {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-bottom-left-radius: 4px;
}

/* ── timestamp ───────────────────────────────────────────────────────────── */
.msg-time {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  letter-spacing: 0.01em;
  padding-inline: 2px;
}

/* ── typing indicator ────────────────────────────────────────────────────── */
.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-block: 2px;
}

.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-ember-dim);
  animation: bounce 1.1s ease-in-out infinite;
}

.typing span:nth-child(2) {
  animation-delay: 0.18s;
}
.typing span:nth-child(3) {
  animation-delay: 0.36s;
}

/* ── pinned input ────────────────────────────────────────────────────────── */
.convo-input-wrap {
  padding: 12px 24px 20px;
  flex-shrink: 0;
}

/* ── transitions ─────────────────────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
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
    opacity 220ms ease,
    transform 220ms ease;
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
</style>
