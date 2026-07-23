<script setup lang="ts">
import type { HookLogEntry } from '@/utils/hooks'
import { CheckCircle, Clock, XCircle } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  entry: HookLogEntry
}>()

const eventLabel = computed(() => {
  const labels: Record<string, string> = {
    SessionStart: 'Session Start',
    SessionEnd: 'Session End',
    TurnStart: 'Turn Start',
    TurnEnd: 'Turn End',
    PreToolUse: 'Pre Tool Use',
    PostToolUse: 'Post Tool Use',
    PreFileWrite: 'Pre File Write',
    PostFileWrite: 'Post File Write',
    PreShellExec: 'Pre Shell Exec',
    PostShellExec: 'Post Shell Exec',
  }
  return labels[props.entry.event] ?? props.entry.event
})

const duration = computed(() => {
  if (!props.entry.finishedAt)
    return null
  const ms = props.entry.finishedAt - props.entry.startedAt
  if (ms < 1000)
    return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
})

const timeAgo = computed(() => {
  const diff = Date.now() - props.entry.startedAt
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)
    return 'just now'
  if (mins < 60)
    return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
})
</script>

<template>
  <div
    class="flex items-start gap-[10px] rounded-[var(--radius-lg)] border px-[12px] py-[10px] text-[12px]"
    :class="[
      entry.allowed && !entry.error
        ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]'
        : entry.allowed && entry.error
          ? 'border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-warning)_4%,var(--color-bg-base))]'
          : 'border-[color-mix(in_srgb,var(--color-danger)_30%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-danger)_4%,var(--color-bg-base))]',
    ]"
  >
    <div class="mt-[1px] shrink-0">
      <CheckCircle
        v-if="entry.allowed && !entry.error"
        :size="14"
        class="text-[var(--color-success)]"
      />
      <XCircle
        v-else-if="!entry.allowed"
        :size="14"
        class="text-[var(--color-danger)]"
      />
      <Clock
        v-else
        :size="14"
        class="text-[var(--color-warning)]"
      />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-[6px]">
        <span class="font-semibold text-[var(--color-text-primary)]">
          {{ eventLabel }}
        </span>
        <span
          class="rounded-[var(--radius-xs)] px-[5px] py-[1px] font-mono text-[10px] font-semibold"
          :class="[
            entry.allowed
              ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
              : 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]',
          ]"
        >
          {{ entry.allowed ? 'allow' : 'deny' }}
        </span>
        <span v-if="duration" class="rounded bg-[var(--color-bg-elevated)] px-[5px] py-[1px] font-mono text-[10px] text-[var(--color-text-dim)]">
          {{ duration }}
        </span>
        <span class="ml-auto text-[10px] text-[var(--color-text-dim)]">
          {{ timeAgo }}
        </span>
      </div>
      <div class="mt-[4px] overflow-hidden text-ellipsis whitespace-nowrap rounded bg-[var(--color-bg-surface)] px-[6px] py-[2px] font-mono text-[11px] text-[var(--color-text-secondary)]">
        {{ entry.command }}
      </div>
      <div v-if="entry.reason" class="mt-[4px] text-[11px] text-[var(--color-danger)]">
        {{ entry.reason }}
      </div>
      <div v-if="entry.error" class="mt-[4px] text-[11px] text-[var(--color-warning)]">
        {{ entry.error }}
      </div>
    </div>
  </div>
</template>
