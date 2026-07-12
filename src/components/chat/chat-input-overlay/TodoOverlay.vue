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

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const rootClasses = computed(() => [
  'todo-overlay w-[calc(100%-24px)] mx-auto mb-2.5 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) flex flex-col overflow-hidden transition-[border-color,box-shadow] duration-120 ease-out',
  isCollapsed.value ? 'todo-overlay--collapsed' : '',
  allDone.value ? 'todo-overlay--done' : '',
].join(' '))

const headerClasses = computed(() => [
  'group flex items-center justify-between w-full p-[10px_14px] bg-transparent border-b cursor-pointer text-left',
  isCollapsed.value ? 'border-transparent' : 'border-(--color-border-mid)',
].join(' '))
const headerMainClasses = 'flex items-center gap-2.5'
const headerEndClasses = 'flex items-center shrink-0'

const chevronClasses = computed(() => [
  'shrink-0 text-(--color-text-tertiary) transition-[transform,color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-(--color-text-secondary)',
  isCollapsed.value ? '-rotate-90 todo-chevron--collapsed' : '',
].join(' '))

const titleClasses = 'text-[11.5px] font-semibold tracking-[0.01em] text-(--color-text-tertiary) select-none transition-colors duration-120 ease-out group-hover:text-(--color-text-secondary)'

const countClasses = computed(() => [
  'inline-flex items-center justify-center h-5 px-2 rounded-(--radius-lg) text-[11px] font-semibold [font-variant-numeric:tabular-nums] select-none transition-all duration-120 ease-out',
  allDone.value ? 'text-(--color-text-tertiary) bg-transparent todo-count--done' : 'bg-(--color-state-hover) text-(--color-text-secondary)',
].join(' '))

const countSepClasses = 'opacity-45 mx-[3px] font-medium'

const bodyClasses = 'max-h-[280px] overflow-y-auto overflow-x-hidden flex flex-col p-[6px_6px_10px_6px] [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:my-1 [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-sm) hover:[&::-webkit-scrollbar-thumb]:bg-(--color-border-mid)'

const listClasses = 'list-none m-0 p-0 flex flex-col gap-[3px]'

function getItemClasses(status: string) {
  const base = 'relative flex items-center gap-2.5 p-[7px_8px] min-h-[34px] rounded-(--radius-md) border box-border transition-[background,border-color,color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]'
  if (status === 'completed') {
    return `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary) todo-item--done`
  }
  if (status === 'in_progress') {
    return `${base} bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-bg-card))] border-(--color-accent-dim) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] hover:border-(--color-accent) todo-item--active`
  }
  return `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)`
}

const iconBaseClasses = 'shrink-0 mt-0 w-3.5 h-3.5 inline-flex items-center justify-center'
const iconDoneClasses = `${iconBaseClasses} text-(--color-success) todo-icon--done`
const iconPendingClasses = `${iconBaseClasses} text-[color-mix(in_srgb,var(--color-text-tertiary)_40%,transparent)] todo-icon--pending`
const iconSpinnerClasses = `${iconBaseClasses} w-3 h-3 rounded-full box-border border-[1.6px] border-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-accent-muted))] border-t-(--color-accent) animate-[spin_900ms_linear_infinite] todo-spinner`

const textGroupClasses = 'flex-1 flex flex-col gap-0 min-w-0'

function getTextClasses(status: string) {
  const base = 'text-[13.5px] font-[inherit] leading-[1.5] transition-[color,opacity,text-decoration-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] no-underline decoration-transparent truncate'
  if (status === 'completed') {
    return `${base} text-[color-mix(in_srgb,var(--color-text-tertiary)_60%,transparent)] line-through decoration-[color-mix(in_srgb,var(--color-text-tertiary)_40%,transparent)]`
  }
  return base
}

const activeFormClasses = 'text-[11.5px] font-[inherit] leading-[1.3] text-(--color-accent) opacity-80 truncate todo-active-form'

// ── Transition bindings ─────────────────────────────────────────────────────
const bodyTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
  leaveActiveClass: 'transition-[opacity,transform] duration-100 ease',
  enterFromClass: 'opacity-0 -translate-y-1.5',
  leaveToClass: 'opacity-0 -translate-y-1',
}

const itemTransitions = {
  enterActiveClass: 'transition-[opacity,transform,max-height,padding] duration-[220ms] ease-out max-h-20 overflow-hidden',
  leaveActiveClass: 'transition-[opacity,max-height,padding] duration-150 ease-in max-h-20 overflow-hidden',
  enterFromClass: 'opacity-0 -translate-y-1.25',
  leaveToClass: 'opacity-0 max-h-0 pt-0 pb-0',
  moveClass: 'transition-transform duration-[220ms] ease-out',
}

const iconTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
  leaveActiveClass: 'transition-opacity duration-100 ease absolute',
  enterFromClass: 'opacity-0 scale-[0.6]',
  leaveToClass: 'opacity-0',
}
</script>

<template>
  <div
    :class="rootClasses"
    role="region"
    aria-label="Task progress"
  >
    <!-- ── Header ────────────────────────────────────────────────────── -->
    <button
      :class="headerClasses"
      :aria-expanded="!isCollapsed"
      aria-controls="todo-body"
      @click="toggleCollapse"
    >
      <div :class="headerMainClasses">
        <ChevronDown
          :size="14"
          :stroke-width="2.5"
          :class="chevronClasses"
          aria-hidden="true"
        />
        <span :class="titleClasses">Tasks</span>
      </div>

      <div :class="headerEndClasses">
        <span
          :class="countClasses"
          :aria-label="`${doneCount} of ${totalCount} complete`"
        >
          {{ doneCount }}<span :class="countSepClasses">/</span>{{ totalCount }}
        </span>
      </div>
    </button>

    <!-- ── Body (collapsible & scrollable) ────────────────────────────── -->
    <Transition v-bind="bodyTransitions">
      <div
        v-if="!isCollapsed"
        id="todo-body"
        ref="bodyRef"
        :class="bodyClasses"
      >
        <TransitionGroup v-bind="itemTransitions" tag="ul" :class="listClasses" role="list">
          <li
            v-for="item in todos"
            :key="item.id"
            :class="getItemClasses(item.status)"
            role="listitem"
            :aria-label="`${item.status === 'completed' ? 'Complete' : item.status === 'in_progress' ? 'In progress' : 'Pending'}: ${item.subject}`"
          >
            <!-- Status icon -->
            <Transition v-bind="iconTransitions" mode="out-in">
              <CheckCircle2
                v-if="item.status === 'completed'"
                :key="`done-${item.id}`"
                :size="14"
                :stroke-width="2"
                :class="iconDoneClasses"
                aria-hidden="true"
              />
              <span
                v-else-if="item.status === 'in_progress'"
                :key="`active-${item.id}`"
                :class="iconSpinnerClasses"
                aria-hidden="true"
              />
              <Circle
                v-else
                :key="`pending-${item.id}`"
                :size="14"
                :stroke-width="2"
                :class="iconPendingClasses"
                aria-hidden="true"
              />
            </Transition>

            <!-- Subject + optional activeForm subtitle -->
            <span :class="textGroupClasses">
              <span :class="getTextClasses(item.status)">{{ item.subject }}</span>
              <span
                v-if="item.status === 'in_progress' && item.activeForm"
                :class="activeFormClasses"
              >{{ item.activeForm }}</span>
            </span>
          </li>
        </TransitionGroup>
      </div>
    </Transition>
  </div>
</template>
