<script setup lang="ts">
/**
 * TodoOverlay.vue
 *
 * Renders the agent's live task list above the chat input shell.
 * Reads the active tab's todos directly from the chat store — no props needed.
 *
 * Visual fusion:
 *   border-bottom: none + margin-bottom: -1px + border-radius 12px 12px 0 0
 *   merges this panel with the input-shell below into one continuous card.
 *
 * Features:
 *   • Collapsible — click the header to toggle
 *   • Shows "X/Y" completion count in the header
 *   • Completed items have a filled check icon + muted text
 *   • Pending items have an outline circle icon
 *   • Animates items in/out with TransitionGroup
 *   • Header count pulses briefly when any item changes
 */

import { AlignJustify, CheckCircle2, Circle } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()

const todos = computed(() => chat.activeTab.todos)
const doneCount = computed(() => todos.value.filter(t => t.done).length)
const totalCount = computed(() => todos.value.length)
const allDone = computed(() => totalCount.value > 0 && doneCount.value === totalCount.value)

const isCollapsed = ref(false)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
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
      <span class="todo-title">Todos</span>

      <!-- Completion count badge -->
      <span
        class="todo-count"
        :class="{ 'todo-count--done': allDone }"
        aria-label="`${doneCount} of ${totalCount} complete`"
      >
        {{ doneCount }}/{{ totalCount }}
      </span>

      <!-- Spacer -->
      <span class="todo-header-spacer" />

      <!-- Collapse toggle icon -->
      <AlignJustify
        :size="13"
        :stroke-width="1.8"
        class="todo-collapse-icon"
        :class="{ 'todo-collapse-icon--collapsed': isCollapsed }"
        aria-hidden="true"
      />
    </button>

    <!-- ── Body (collapsible) ────────────────────────────────────────── -->
    <div
      v-if="!isCollapsed"
      id="todo-body"
      class="todo-body"
    >
      <TransitionGroup name="todo-item" tag="ul" class="todo-list" role="list">
        <li
          v-for="item in todos"
          :key="item.id"
          class="todo-item"
          :class="{ 'todo-item--done': item.done }"
          role="listitem"
          :aria-label="`${item.done ? 'Complete' : 'Pending'}: ${item.text}`"
        >
          <!-- Status icon -->
          <CheckCircle2
            v-if="item.done"
            :size="14"
            :stroke-width="2"
            class="todo-icon todo-icon--done"
            aria-hidden="true"
          />
          <Circle
            v-else
            :size="14"
            :stroke-width="1.6"
            class="todo-icon todo-icon--pending"
            aria-hidden="true"
          />

          <!-- Task text -->
          <span class="todo-text">{{ item.text }}</span>
        </li>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
/* ── outer shell — fuses with input-shell below ──────────────────────────── */

.todo-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  /* Overlap input-shell's top border by 1px so the panels merge seamlessly */
  margin-bottom: -1px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Smooth border-color transition to success when all done */
  transition: border-color 300ms ease;
}

/* Tint the border accent when all tasks are complete */
.todo-overlay--done {
  border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border-mid));
}

/* ── header (clickable row) ──────────────────────────────────────────────── */

.todo-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 100ms ease;
  /* Add separator only when body is visible */
  border-bottom: 1px solid transparent;
}

/* Show the divider only when expanded */
.todo-overlay:not(.todo-overlay--collapsed) .todo-header {
  border-bottom-color: var(--color-border-subtle);
}

.todo-header:hover {
  background: var(--color-bg-hover);
}

.todo-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  user-select: none;
}

/* Completion count badge */
.todo-count {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 99px;
  padding: 0 6px;
  line-height: 18px;
  user-select: none;
  transition:
    color 300ms ease,
    background 300ms ease,
    border-color 300ms ease;
}

/* Green tint when all complete */
.todo-count--done {
  color: var(--color-success-text);
  background: var(--color-success-muted);
  border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
}

.todo-header-spacer {
  flex: 1;
}

/* Collapse icon */
.todo-collapse-icon {
  color: var(--color-text-dim);
  flex-shrink: 0;
  transition:
    color 100ms ease,
    opacity 100ms ease;
}
.todo-header:hover .todo-collapse-icon {
  color: var(--color-text-tertiary);
}

/* ── body ────────────────────────────────────────────────────────────────── */

.todo-body {
  padding: 6px 0 8px;
}

/* ── list ────────────────────────────────────────────────────────────────── */

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* ── individual item ─────────────────────────────────────────────────────── */

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 5px 14px;
  /* Subtle separator except the first */
  border-top: 1px solid transparent;
  transition: background 80ms ease;
}
.todo-item + .todo-item {
  border-top-color: var(--color-border-subtle);
}
.todo-item:hover {
  background: color-mix(in srgb, var(--color-bg-elevated) 40%, transparent);
}

/* Status icons */
.todo-icon {
  flex-shrink: 0;
  /* Vertically align with first line of text */
  margin-top: 2px;
  transition:
    color 250ms ease,
    opacity 250ms ease;
}
.todo-icon--done {
  color: var(--color-success);
}
.todo-icon--pending {
  color: var(--color-text-dim);
}

/* Task text */
.todo-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  transition:
    color 250ms ease,
    opacity 250ms ease;
}

/* Done state: muted text */
.todo-item--done .todo-text {
  color: var(--color-text-dim);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-text-dim) 50%, transparent);
}

/* ── todo item enter/leave animation ─────────────────────────────────────── */

.todo-item-enter-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    max-height 180ms ease;
  max-height: 60px;
  overflow: hidden;
}
.todo-item-leave-active {
  transition:
    opacity 130ms ease,
    max-height 130ms ease;
  max-height: 60px;
  overflow: hidden;
}
.todo-item-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.todo-item-leave-to {
  opacity: 0;
  max-height: 0;
}
/* Keep leaving items in flow */
.todo-item-move {
  transition: transform 180ms ease;
}
</style>
