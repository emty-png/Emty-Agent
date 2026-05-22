<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import TerminalSessionView from './TerminalSessionView.vue'

const props = defineProps<{
  ownerId: string
  cwd?: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const terminal = useTerminalStore()
const owner = computed(() => terminal.getOwner(props.ownerId))
const activeSession = computed(() =>
  owner.value.sessions.find(session => session.id === owner.value.activeSessionId) ?? null,
)

function sessionStateClass(status: string) {
  if (status === 'error')
    return 'terminal-tab__dot--error'
  if (status === 'closed')
    return 'terminal-tab__dot--closed'
  if (status === 'starting')
    return 'terminal-tab__dot--starting'
  return 'terminal-tab__dot--ready'
}

async function addSession() {
  await terminal.createSession(props.ownerId, props.cwd)
}

async function closeSession(sessionId: string) {
  await terminal.closeSession(props.ownerId, sessionId)
}
</script>

<template>
  <section class="terminal-pane">
    <div class="terminal-pane__header">
      <div class="terminal-tabs">
        <button
          v-for="session in owner.sessions"
          :key="session.id"
          class="terminal-tab"
          :class="{ 'terminal-tab--active': session.id === owner.activeSessionId }"
          :title="session.cwd || session.title"
          @click="terminal.activateSession(props.ownerId, session.id)"
        >
          <span class="terminal-tab__dot" :class="sessionStateClass(session.status)" />
          <span class="terminal-tab__label">{{ session.title }}</span>
          <span
            class="terminal-tab__close"
            role="button"
            aria-label="Close terminal session"
            @click.stop="closeSession(session.id)"
          >
            <X :size="11" :stroke-width="2" />
          </span>
        </button>
      </div>

      <div class="terminal-pane__actions">
        <button
          class="terminal-pane__btn"
          aria-label="Open a new terminal session"
          title="New terminal"
          @click="addSession"
        >
          <Plus :size="14" :stroke-width="1.9" />
        </button>
        <button
          class="terminal-pane__btn"
          aria-label="Hide terminal panel"
          title="Hide terminal"
          @click="emit('close')"
        >
          <X :size="14" :stroke-width="1.9" />
        </button>
      </div>
    </div>

    <div class="terminal-pane__body">
      <!-- Force a clean mount/unmount cycle on active tab shifts using :key -->
      <TerminalSessionView
        v-if="activeSession"
        :key="activeSession.id"
        :session="activeSession"
        :active="true"
      />

      <div v-else class="terminal-pane__empty">
        Terminal panel is open with no active session.
      </div>
    </div>
  </section>
</template>

<style scoped>
.terminal-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  border-top: 1px solid var(--color-border-subtle);
  min-height: 0;
}

.terminal-pane__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 0 8px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
}

.terminal-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.terminal-tabs::-webkit-scrollbar {
  display: none;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: 240px;
  height: 26px;
  padding: 0 8px;
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

.terminal-tab:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.terminal-tab--active {
  background: var(--color-bg-base);
  border-color: var(--color-border-mid);
  color: var(--color-text-primary);
}

.terminal-tab__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.terminal-tab__dot--ready {
  background: var(--color-success);
}

.terminal-tab__dot--starting {
  background: var(--color-warning);
}

.terminal-tab__dot--closed {
  background: var(--color-text-dim);
}

.terminal-tab__dot--error {
  background: var(--color-danger);
}

.terminal-tab__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}

.terminal-tab__close {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  color: inherit;
  opacity: 0;
  flex-shrink: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.terminal-tab:hover .terminal-tab__close,
.terminal-tab--active .terminal-tab__close {
  opacity: 1;
}

.terminal-tab__close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.terminal-pane__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.terminal-pane__btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.terminal-pane__btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.terminal-pane__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.terminal-pane__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-tertiary);
  font-size: 12px;
  background: var(--color-bg-base);
}
</style>
