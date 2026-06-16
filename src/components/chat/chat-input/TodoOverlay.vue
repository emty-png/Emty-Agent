<script setup lang="ts">
/**
 * TodoOverlay.vue
 *
 * Renders the agent's live task list above the chat input shell.
 * Reads the active tab's todos directly from the chat store — no props needed.
 */

import { CheckCircle2, ChevronDown, Circle, Loader } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()

const todos = computed(() => chat.activeTab.todos)
const doneCount = computed(() => todos.value.filter(t => t.status === 'completed').length)
const totalCount = computed(() => todos.value.length)
const allDone = computed(() => totalCount.value > 0 && doneCount.value === totalCount.value)

/**
 * Index of the active item for auto-scroll purposes.
 * Prefers the first in_progress task; falls back to the first pending task.
 */
const activeIdx = computed(() => {
  const inProgress = todos.value.findIndex(t => t.status === 'in_progress')
  if (inProgress !== -1)
    return inProgress
  return todos.value.findIndex(t => t.status === 'pending')
})

const isCollapsed = ref(true)
const bodyRef = ref<HTMLElement | null>(null)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

// Auto-scroll to the active item as the agent progresses through the list
watch(activeIdx, async newIdx => {
  if (newIdx !== -1 && !isCollapsed.value && bodyRef.value) {
    await nextTick()
    // Small delay to allow TransitionGroup animations to settle before measuring scroll position
    setTimeout(() => {
      if (!bodyRef.value)
        return
      const activeEl = bodyRef.value.querySelector('.todo-item--active') as HTMLElement
      if (activeEl)
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 250)
  }
})
</script>

<template>
  <div
    class="todo-overlay"
    :class="{ 'todo-overlay--collapsed': isCollapsed, 'todo-overlay--done': allDone }"
    role="region"
    aria-label="Task progress"
  >
    <!-- ── Header ────────────────────────────────────────────────────── -->
    <button
      class="todo-header"
      :aria-expanded="!isCollapsed"
      aria-controls="todo-body"
      @click="toggleCollapse"
    >
      <div class="todo-header-main">
        <ChevronDown
          :size="14"
          :stroke-width="2.5"
          class="todo-chevron"
          :class="{ 'todo-chevron--collapsed': isCollapsed }"
          aria-hidden="true"
        />
        <span class="todo-title">Tasks</span>
      </div>

      <div class="todo-header-end">
        <span
          class="todo-count"
          :class="{ 'todo-count--done': allDone }"
          :aria-label="`${doneCount} of ${totalCount} complete`"
        >
          {{ doneCount }}<span class="todo-count-sep">/</span>{{ totalCount }}
        </span>
      </div>
    </button>

    <!-- ── Body (collapsible & scrollable) ────────────────────────────── -->
    <Transition name="todo-body">
      <div
        v-if="!isCollapsed"
        id="todo-body"
        ref="bodyRef"
        class="todo-body"
      >
        <TransitionGroup name="todo-item" tag="ul" class="todo-list" role="list">
          <li
            v-for="item in todos"
            :key="item.id"
            class="todo-item"
            :class="{
              'todo-item--done': item.status === 'completed',
              'todo-item--active': item.status === 'in_progress',
            }"
            role="listitem"
            :aria-label="`${item.status === 'completed' ? 'Complete' : item.status === 'in_progress' ? 'In progress' : 'Pending'}: ${item.subject}`"
          >
            <!-- Left accent sliver -->
            <span class="todo-option-accent" aria-hidden="true" />

            <!-- Status icon -->
            <Transition name="todo-icon" mode="out-in">
              <CheckCircle2
                v-if="item.status === 'completed'"
                :key="`done-${item.id}`"
                :size="14"
                :stroke-width="2"
                class="todo-icon todo-icon--done"
                aria-hidden="true"
              />
              <Loader
                v-else-if="item.status === 'in_progress'"
                :key="`active-${item.id}`"
                :size="14"
                :stroke-width="2"
                class="todo-icon todo-icon--in-progress"
                aria-hidden="true"
              />
              <Circle
                v-else
                :key="`pending-${item.id}`"
                :size="14"
                :stroke-width="2"
                class="todo-icon todo-icon--pending"
                aria-hidden="true"
              />
            </Transition>

            <!-- Subject + optional activeForm subtitle -->
            <span class="todo-text-group">
              <span class="todo-text">{{ item.subject }}</span>
              <span
                v-if="item.status === 'in_progress' && item.activeForm"
                class="todo-active-form"
              >{{ item.activeForm }}</span>
            </span>
          </li>
        </TransitionGroup>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── outer shell — matches input-shell color tokens ───────────────────────── */

.todo-overlay {
  /* Aligns width and margin with the input-shell */
  width: calc(100% - 24px);
  margin: 0 auto 10px auto;
  background: var(--color-bg-card); /* Matches input-shell background */
  border: 1px solid var(--color-border-bright); /* Matches input-shell border */
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

/* ── header ────────────────────────────────────────────────────────────────── */

.todo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.todo-header-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.todo-header-end {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.todo-chevron {
  color: var(--color-text-tertiary); /* Swapped from text-dim */
  flex-shrink: 0;
  transition:
    transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms ease;
}
.todo-chevron--collapsed {
  transform: rotate(-90deg);
}
.todo-header:hover .todo-chevron {
  color: var(--color-text-secondary);
}

.todo-title {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text-tertiary);
  user-select: none;
  transition: color 120ms ease;
}
.todo-header:hover .todo-title {
  color: var(--color-text-secondary);
}

/* Completion count pill */
.todo-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-lg);
  background: var(--color-state-hover);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  user-select: none;
  transition: all 120ms ease;
}

.todo-count-sep {
  opacity: 0.45;
  margin-inline: 3px;
  font-weight: 500;
}

.todo-count--done {
  color: var(--color-text-tertiary); /* Swapped from text-dim */
  background: transparent;
}

/* ── body (scrollable) ───────────────────────────────────────────────────── */

.todo-body {
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 12px 12px 12px;

  /* Scrollbars adjusted to use match system border styles */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.todo-body::-webkit-scrollbar {
  width: 6px;
}
.todo-body::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}
.todo-body::-webkit-scrollbar-thumb {
  background: var(--color-border-bright);
  border-radius: var(--radius-sm);
}
.todo-body::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-mid);
}

/* Body collapse/expand animation */
.todo-body-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.todo-body-leave-active {
  transition:
    opacity 100ms ease,
    transform 100ms ease;
}
.todo-body-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.todo-body-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── list ────────────────────────────────────────────────────────────────── */

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ── individual item — styled to match the dropdown items ────────────────── */

.todo-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  box-sizing: border-box;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Hover state matching standard unselected options */
.todo-item:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

/* Active item matching .perm-option--active styles */
.todo-item--active {
  background: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.todo-item--active:hover {
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  border-color: var(--color-accent);
}

/* Left accent sliver for active item */
.todo-option-accent {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  transform-origin: center;
  width: 3px;
  height: 14px;
  border-radius: var(--radius-xs);
  background: var(--color-accent);
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.todo-item--active .todo-option-accent {
  transform: translateY(-50%) scaleY(1);
}

/* Status icons */
.todo-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.todo-icon--done {
  color: var(--color-success);
}
.todo-icon--in-progress {
  color: var(--color-accent);
  animation: todo-spin 1.4s linear infinite;
}
.todo-icon--pending {
  color: color-mix(in srgb, var(--color-text-tertiary) 40%, transparent); /* Swapped from text-dim */
}

@keyframes todo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Task text group */
.todo-text-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* Icon cross-fade */
.todo-icon-enter-active {
  transition:
    opacity 200ms ease,
    transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.todo-icon-leave-active {
  transition: opacity 100ms ease;
  position: absolute;
}
.todo-icon-enter-from {
  opacity: 0;
  transform: scale(0.6);
}
.todo-icon-leave-to {
  opacity: 0;
}

/* Task subject */
.todo-text {
  font-size: 13.5px; /* Matches textarea text size */
  font-family: inherit;
  line-height: 1.5; /* Matches textarea line height */
  color: inherit; /* Inherits container colors cleanly */
  transition:
    color 300ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 300ms ease,
    text-decoration-color 300ms ease;
  text-decoration: none;
  text-decoration-color: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* activeForm subtitle — visible while in_progress */
.todo-active-form {
  font-size: 11.5px; /* Matches chat tooltip typography */
  font-family: inherit;
  line-height: 1.3;
  color: var(--color-accent);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Done state: strikethrough + muted */
.todo-item--done .todo-text {
  color: color-mix(in srgb, var(--color-text-tertiary) 60%, transparent); /* Swapped from text-dim */
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-text-tertiary) 40%, transparent); /* Swapped from text-dim */
}

/* ── todo item enter/leave animation ─────────────────────────────────────── */

.todo-item-enter-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease,
    max-height 220ms ease,
    padding 220ms ease;
  max-height: 80px;
  overflow: hidden;
}
.todo-item-leave-active {
  transition:
    opacity 150ms ease,
    max-height 150ms ease,
    padding 150ms ease;
  max-height: 80px;
  overflow: hidden;
}
.todo-item-enter-from {
  opacity: 0;
  transform: translateY(-5px);
}
.todo-item-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.todo-item-move {
  transition: transform 220ms ease;
}
</style>
