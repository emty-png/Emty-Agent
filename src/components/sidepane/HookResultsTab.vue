<script setup lang="ts">
import type { HookLogEntry } from '@/utils/hooks'
import { CheckCircle, Loader2, Search, Trash2, XCircle, Zap } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { clearHookLog, hookLog } from '@/utils/hooks'

const props = defineProps<{
  tabId: string
}>()

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const filterEvent = ref<string>('all')
const filterStatus = ref<string>('all')
const search = ref('')

const filteredLog = computed(() => {
  let list = hookLog.value.filter(entry => entry.tabId === props.tabId)
  if (filterEvent.value !== 'all')
    list = list.filter(e => e.event === filterEvent.value)
  if (filterStatus.value !== 'all')
    list = list.filter(e => e.status === filterStatus.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(e => e.command.toLowerCase().includes(q) || e.event.toLowerCase().includes(q) || (e.output && e.output.toLowerCase().includes(q)))
  }
  return list
})

const eventLabel: Record<string, string> = {
  SessionStart: 'Session',
  SessionEnd: 'Session',
  TurnStart: 'Turn Start',
  TurnEnd: 'Turn End',
  BeforePromptBuild: 'Before Prompt',
  AfterPromptBuild: 'After Prompt',
  PreCompact: 'Pre Compact',
  PostCompact: 'Post Compact',
  SubagentStart: 'Subagent Start',
  SubagentEnd: 'Subagent End',
  PermissionRequest: 'Permission',
  PreToolUse: 'Pre Tool',
  PostToolUse: 'Post Tool',
  PreFileWrite: 'Pre Write',
  PostFileWrite: 'Post Write',
  PreFileEdit: 'Pre Edit',
  PostFileEdit: 'Post Edit',
  PreFileRead: 'Pre Read',
  PostFileRead: 'Post Read',
  PreMcpUse: 'Pre MCP',
  PostMcpUse: 'Post MCP',
  PreShellExec: 'Pre Shell',
  PostShellExec: 'Post Shell',
  StopFailure: 'Stop Failure',
}

const uniqueEvents = computed(() => {
  const s = new Set(hookLog.value.filter(e => e.tabId === props.tabId).map(e => e.event))
  return Array.from(s).sort()
})

function duration(entry: HookLogEntry): string | null {
  if (!entry.finishedAt)
    return null
  const ms = entry.finishedAt - entry.startedAt
  if (ms < 1000)
    return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const secs = Math.floor(diff / 1000)
  if (secs < 5)
    return 'now'
  if (secs < 60)
    return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60)
    return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

let timeInterval: ReturnType<typeof setInterval> | null = null
const tick = ref(0)
onMounted(() => {
  timeInterval = setInterval(() => { tick.value++ }, 10_000)
})
onUnmounted(() => {
  if (timeInterval)
    clearInterval(timeInterval)
})

function onScroll() {
  const el = logContainer.value
  if (!el)
    return
  autoScroll.value = el.scrollTop < 30
}

watch(() => hookLog.value.length, () => {
  if (autoScroll.value) {
    nextTick(() => {
      logContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
})

function handleClear() {
  clearHookLog()
}
</script>

<template>
  <div class="flex flex-1 min-h-0 flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-[var(--color-border-subtle)] gap-2">
      <div class="flex items-center gap-2 shrink-0">
        <Zap :size="13" class="text-[var(--color-accent)]" />
        <span class="text-[12px] font-semibold text-[var(--color-text-primary)]">Hook Executions</span>
        <span
          v-if="filteredLog.length > 0"
          class="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[var(--color-bg-elevated)] px-1.5 text-[10px] font-semibold text-[var(--color-text-dim)]"
        >
          {{ filteredLog.length }}
        </span>
      </div>
      <button class="inline-flex items-center gap-1 h-6 px-2 border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)]" @click="handleClear">
        <Trash2 :size="11" /> Clear
      </button>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
      <div class="relative flex-1 min-w-0 flex items-center">
        <Search :size="12" class="absolute left-1.5 text-[var(--color-text-dim)]" />
        <input v-model="search" placeholder="Search command, event..." class="w-full h-6 pl-6 pr-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] text-[11px] outline-none focus:border-[var(--color-accent-dim)]">
      </div>
      <select v-model="filterEvent" class="h-6 px-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] text-[11px]">
        <option value="all">
          All events
        </option>
        <option v-for="ev in uniqueEvents" :key="ev" :value="ev">
          {{ eventLabel[ev] ?? ev }}
        </option>
      </select>
      <select v-model="filterStatus" class="h-6 px-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] text-[11px]">
        <option value="all">
          All status
        </option>
        <option value="running">
          running
        </option>
        <option value="completed">
          completed
        </option>
        <option value="denied">
          denied
        </option>
        <option value="error">
          error
        </option>
      </select>
    </div>

    <!-- Log entries -->
    <div
      ref="logContainer"
      class="flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]"
      @scroll="onScroll"
    >
      <!-- Empty state -->
      <div
        v-if="filteredLog.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center"
      >
        <div class="w-[32px] h-[32px] rounded-[var(--radius-md)] flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)] border border-[var(--color-border-subtle)]">
          <Zap :size="15" :stroke-width="1.5" />
        </div>
        <p class="m-0 text-[12px] text-[var(--color-text-secondary)]">
          No hook executions yet
        </p>
        <p class="m-0 text-[11px] text-[var(--color-text-dim)] max-w-[180px] leading-[1.4]">
          Hook events will appear here as they fire. Use filters to narrow.
        </p>
      </div>

      <!-- Entries (newest first) -->
      <div
        v-for="entry in filteredLog"
        :key="entry.id"
        class="flex items-start gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-[11px] transition-colors duration-150"
        :class="[
          entry.status === 'running'
            ? 'border-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-bg-base))]'
            : entry.status === 'denied'
              ? 'border-[color-mix(in_srgb,var(--color-danger)_30%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-danger)_4%,var(--color-bg-base))]'
              : entry.status === 'error'
                ? 'border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-border-subtle))] bg-[color-mix(in_srgb,var(--color-warning)_4%,var(--color-bg-base))]'
                : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]',
        ]"
      >
        <!-- Status icon -->
        <div class="mt-[1px] shrink-0">
          <Loader2
            v-if="entry.status === 'running'"
            :size="13"
            class="text-[var(--color-accent)] animate-[spin_0.9s_linear_infinite]"
          />
          <CheckCircle
            v-else-if="entry.status === 'completed'"
            :size="13"
            class="text-[var(--color-success)]"
          />
          <XCircle
            v-else-if="entry.status === 'denied'"
            :size="13"
            class="text-[var(--color-danger)]"
          />
          <XCircle
            v-else
            :size="13"
            class="text-[var(--color-warning)]"
          />
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1 flex flex-col gap-1">
          <!-- Top row: event + badge + time -->
          <div class="flex items-center gap-1.5">
            <span class="font-semibold text-[var(--color-text-primary)]">
              {{ eventLabel[entry.event] ?? entry.event }}
            </span>
            <span
              class="rounded px-1 py-[0.5px] font-mono text-[9px] font-semibold"
              :class="[
                entry.status === 'running'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : entry.status === 'completed'
                    ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                    : entry.status === 'denied'
                      ? 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]'
                      : 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]',
              ]"
            >
              {{ entry.status }}
            </span>
            <span
              v-if="duration(entry)"
              class="rounded bg-[var(--color-bg-elevated)] px-1 py-[0.5px] font-mono text-[9px] text-[var(--color-text-dim)]"
            >
              {{ duration(entry) }}
            </span>
            <span class="ml-auto text-[9px] text-[var(--color-text-dim)]">
              <!-- Force reactivity on time-ago via tick -->
              {{ timeAgo(entry.startedAt) }}
            </span>
          </div>

          <!-- Command -->
          <div class="overflow-hidden text-ellipsis whitespace-nowrap rounded bg-[var(--color-bg-surface)] px-1.5 py-[2px] font-mono text-[10px] text-[var(--color-text-secondary)]">
            {{ entry.command }}
          </div>

          <!-- Workspace -->
          <div v-if="entry.workspacePath" class="text-[10px] text-[var(--color-text-dim)] truncate">
            {{ entry.workspacePath }}
          </div>

          <!-- Reason (denied) -->
          <div v-if="entry.reason" class="text-[10px] text-[var(--color-danger)] leading-[1.4]">
            {{ entry.reason }}
          </div>

          <!-- Error -->
          <div v-if="entry.error" class="text-[10px] text-[var(--color-warning)] leading-[1.4]">
            {{ entry.error }}
          </div>

          <!-- Output -->
          <div v-if="entry.output" class="overflow-hidden text-ellipsis whitespace-nowrap rounded bg-[var(--color-bg-surface)] px-1.5 py-[2px] font-mono text-[10px] text-[var(--color-accent)]">
            {{ entry.output }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
