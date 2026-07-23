<script setup lang="ts">
import type { HookEvent } from '@/utils/hooks'
import type { HookEntry } from '@/utils/hooks/types'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  event: HookEvent
  entries: HookEntry[]
  enabled: boolean
  hookCount: number
}>()

const emit = defineEmits<{
  toggle: []
}>()

const expanded = ref(false)

const eventLabel = computed(() => {
  const labels: Record<HookEvent, string> = {
    SessionStart: 'Session Start',
    SessionEnd: 'Session End',
    TurnStart: 'Turn Start',
    TurnEnd: 'Turn End',
    StopFailure: 'Stop Failure',
    PreToolUse: 'Pre Tool Use',
    PostToolUse: 'Post Tool Use',
    PreFileWrite: 'Pre File Write',
    PostFileWrite: 'Post File Write',
    PreShellExec: 'Pre Shell Exec',
    PostShellExec: 'Post Shell Exec',
  }
  return labels[props.event]
})

const eventDescription = computed(() => {
  const descriptions: Record<HookEvent, string> = {
    SessionStart: 'Fires when the first message is sent in a tab',
    SessionEnd: 'Fires when a tab is closed',
    TurnStart: 'Fires when the user submits a prompt',
    TurnEnd: 'Fires when the agent completes its turn',
    StopFailure: 'Fires when the agent fails terminally (after retries exhausted or non-retryable error)',
    PreToolUse: 'Fires before any tool executes (can block)',
    PostToolUse: 'Fires after a tool completes',
    PreFileWrite: 'Fires before a file is written (can block)',
    PostFileWrite: 'Fires after a file is written',
    PreShellExec: 'Fires before a shell command runs (can block)',
    PostShellExec: 'Fires after a shell command completes',
  }
  return descriptions[props.event]
})

const canBlock = computed(() => {
  return ['SessionStart', 'PreToolUse', 'PreFileWrite', 'PreShellExec', 'TurnStart'].includes(props.event as HookEvent)
})
</script>

<template>
  <div
    class="group overflow-hidden rounded-[var(--radius-lg)] border transition-colors duration-150"
    :class="[
      enabled
        ? 'border-[color-mix(in_srgb,var(--color-accent)_25%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-accent)_3%,var(--color-bg-base))]'
        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]',
    ]"
  >
    <header
      class="flex min-h-[42px] cursor-pointer items-center gap-[10px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50 px-[14px] py-[10px] select-none transition-colors duration-150 hover:bg-[var(--color-bg-surface)]"
      @click="expanded = !expanded"
    >
      <div class="flex items-center gap-[8px] overflow-hidden">
        <component
          :is="expanded ? ChevronDown : ChevronRight"
          :size="13"
          class="shrink-0 text-[var(--color-text-dim)] transition-transform duration-150"
        />
        <span class="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {{ eventLabel }}
        </span>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-[8px]">
        <span
          v-if="hookCount > 0"
          class="inline-flex items-center rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-[7px] py-[2px] text-[11px] font-semibold text-[var(--color-accent)]"
        >
          {{ hookCount }} hook{{ hookCount !== 1 ? 's' : '' }}
        </span>
        <span
          v-if="canBlock"
          class="rounded-[var(--radius-sm)] px-[7px] py-[2px] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warning)]"
        >
          blockable
        </span>
        <label
          class="relative inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150"
          :class="[enabled ? 'bg-[var(--color-accent-dim)]' : 'bg-[var(--color-bg-elevated)]']"
          @click.stop
        >
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="enabled"
            @change="emit('toggle')"
          >
          <span
            class="absolute left-[2px] h-[16px] w-[16px] rounded-full transition-all duration-200 peer-checked:translate-x-[14px]"
            :class="[enabled ? 'bg-[var(--color-text-primary)]' : 'bg-[var(--color-text-tertiary)]']"
          />
        </label>
      </div>
    </header>
    <div v-if="expanded" class="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/30 px-[14px] py-[12px]">
      <p class="m-0 mb-[10px] text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">
        {{ eventDescription }}
      </p>
      <div v-if="entries.length === 0" class="flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-[16px] text-[12px] italic text-[var(--color-text-dim)]">
        No hooks configured
      </div>
      <div v-else class="flex flex-col gap-[6px]">
        <div
          v-for="(entry, i) in entries"
          :key="i"
          class="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-[12px] py-[10px]"
        >
          <div class="mb-[6px] text-[11px] font-medium text-[var(--color-text-dim)]">
            <template v-if="entry.matcher">
              Matcher: <code class="rounded bg-[var(--color-bg-surface)] px-[4px] py-[1px] text-[var(--color-accent)]">{{ entry.matcher }}</code>
            </template>
            <template v-else>
              Matches all
            </template>
          </div>
          <div
            v-for="(hook, j) in entry.hooks"
            :key="j"
            class="flex items-center gap-[8px] text-[12px]"
          >
            <code class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-[var(--color-bg-surface)] px-[8px] py-[3px] font-mono text-[11px] text-[var(--color-text-secondary)]">
              {{ hook.command }}
            </code>
            <span class="shrink-0 rounded bg-[var(--color-bg-elevated)] px-[5px] py-[1px] font-mono text-[10px] text-[var(--color-text-dim)]">
              {{ hook.timeoutSec ?? 5 }}s
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
