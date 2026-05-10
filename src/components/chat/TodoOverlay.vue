<script setup lang="ts">
/**
 * TodoOverlay.vue
 *
 * Renders the agent's live task list above the chat input shell.
 * Reads the active tab's todos directly from the chat store — no props needed.
 */

import { CheckCircle2, ChevronDown, Circle } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()

const todos = computed(() => chat.activeTab.todos)
const doneCount = computed(() => todos.value.filter(t => t.done).length)
const totalCount = computed(() => todos.value.length)
const allDone = computed(() => totalCount.value > 0 && doneCount.value === totalCount.value)

/** Index of the first incomplete task — gets the active indicator. */
const activeIdx = computed(() => todos.value.findIndex(t => !t.done))

const isCollapsed = ref(false)
const bodyRef = ref<HTMLElement | null>(null)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

// Auto-scroll to the active item as the agent progresses through the list
watch(activeIdx, async newIdx => {
  if (newIdx !== -1 && !isCollapsed.value && bodyRef.value) {
    await nextTick()
    // Small delay to allow the TransitionGroup max-height collapse/expand animations to finish
    // so we calculate the correct scroll position.
    setTimeout(() => {
      if (!bodyRef.value)
        return
      const activeEl = bodyRef.value.querySelector('.todo-item--active') as HTMLElement
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
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
        <!-- Chevron — rotates when collapsed -->
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
        <!-- Completion count pill badge -->
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
            v-for="(item, idx) in todos"
            :key="item.id"
            class="todo-item"
            :class="{
              'todo-item--done': item.done,
              'todo-item--active': idx === activeIdx,
            }"
            role="listitem"
            :aria-label="`${item.done ? 'Complete' : 'Pending'}: ${item.text}`"
          >
            <!-- Left accent sliver -->
            <span class="todo-option-accent" aria-hidden="true" />

            <!-- Status icon -->
            <Transition name="todo-icon" mode="out-in">
              <CheckCircle2
                v-if="item.done"
                :key="`done-${item.id}`"
                :size="14"
                :stroke-width="2"
                class="todo-icon todo-icon--done"
                aria-hidden="true"
              />
              <Circle
                v-else
                :key="`pending-${item.id}`"
                :size="14"
                :stroke-width="2"
                class="todo-icon todo-icon--pending"
                :class="{ 'todo-icon--active-svg': idx === activeIdx }"
                aria-hidden="true"
              />
            </Transition>

            <!-- Task text -->
            <span class="todo-text">{{ item.text }}</span>
          </li>
        </TransitionGroup>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── outer shell ───────────────────────────────────────────────────────────── */

.todo-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  margin-bottom: -1px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition:
    border-color 400ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 400ms cubic-bezier(0.4, 0, 0.2, 1);

  /* Subtle ambient glow */
  box-shadow: 0 -4px 20px -6px color-mix(in srgb, var(--color-accent) 12%, transparent);
}

/* no special border/glow when all done — panel just goes quiet */
.todo-overlay--done {
  box-shadow: none;
}

/* ── header ────────────────────────────────────────────────────────────────── */

.todo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 13px 13px 11px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border-mid);
  cursor: pointer;
  text-align: left;
  transition: background 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.todo-overlay--collapsed .todo-header {
  border-bottom-color: transparent;
}

.todo-header:hover {
  background: var(--color-bg-hover);
}

.todo-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.todo-header-end {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.todo-chevron {
  color: var(--color-text-dim);
  flex-shrink: 0;
  transition:
    transform 250ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms ease;
}
.todo-chevron--collapsed {
  transform: rotate(-90deg);
}
.todo-header:hover .todo-chevron {
  color: var(--color-text-tertiary);
}

.todo-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  user-select: none;
  transition: color 150ms ease;
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
  border-radius: var(--radius-pill);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  user-select: none;
  transition:
    color 400ms cubic-bezier(0.4, 0, 0.2, 1),
    background 400ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

.todo-count-sep {
  opacity: 0.45;
  margin-inline: 3px;
  font-weight: 500;
}

/* badge stays neutral when all done */
.todo-count--done {
  color: var(--color-text-dim);
  border-color: transparent;
  background: transparent;
}

/* ── body (scrollable) ───────────────────────────────────────────────────── */

.todo-body {
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;

  /* Firefox Scrollbar */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

/* Custom WebKit Scrollbar Styling */
.todo-body::-webkit-scrollbar {
  width: 6px;
}
.todo-body::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}
.todo-body::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 6px;
}
.todo-body::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

/* Body collapse/expand animation */
.todo-body-enter-active {
  transition:
    opacity 200ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.todo-body-leave-active {
  transition:
    opacity 150ms cubic-bezier(0.4, 0, 1, 1),
    transform 150ms cubic-bezier(0.4, 0, 1, 1);
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
}

/* ── individual item ─────────────────────────────────────────────────────── */

.todo-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-mid);
  transition: background 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.todo-item:first-child {
  border-top: none;
}
.todo-item:hover {
  background: var(--color-bg-elevated);
}

/* Left accent sliver — shown when active */
.todo-option-accent {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  transform-origin: center;
  width: 2px;
  height: 55%;
  min-height: 14px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.todo-item--active .todo-option-accent {
  transform: translateY(-50%) scaleY(1);
}
.todo-item--active {
  background: color-mix(in srgb, var(--color-bg-elevated) 80%, var(--color-accent-muted));
}
.todo-item--active:hover {
  background: color-mix(in srgb, var(--color-bg-elevated) 100%, var(--color-accent-muted));
}

/* Status icon */
.todo-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.todo-icon--done {
  color: var(--color-success);
}
.todo-icon--pending {
  color: color-mix(in srgb, var(--color-text-dim) 40%, transparent);
}
.todo-icon--active-svg {
  color: var(--color-success); /* Bright green matching the check circle */
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

/* Task text */
.todo-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-text-secondary);
  transition:
    color 300ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 300ms ease,
    text-decoration-color 300ms ease;
  text-decoration: none;
  text-decoration-color: transparent;
}

/* Active item text */
.todo-item--active .todo-text {
  color: var(--color-text-primary);
}

/* Done state: strikethrough + muted */
.todo-item--done .todo-text {
  color: color-mix(in srgb, var(--color-text-dim) 70%, transparent);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-text-dim) 50%, transparent);
}

/* ── todo item enter/leave animation ─────────────────────────────────────── */

.todo-item-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
    max-height 220ms cubic-bezier(0.4, 0, 0.2, 1),
    padding 220ms ease;
  max-height: 80px;
  overflow: hidden;
}
.todo-item-leave-active {
  transition:
    opacity 150ms ease,
    max-height 150ms cubic-bezier(0.4, 0, 1, 1),
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
  border-top-color: transparent;
}
.todo-item-move {
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
