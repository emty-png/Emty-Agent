<script setup lang="ts">
import type { ToolEvent } from '@/stores/chat'
import type { SubAgentPersonality } from '@/utils/tools/subagent'
import { Bug, Compass, Cpu, ExternalLink, Globe } from 'lucide-vue-next'
import { computed, onUnmounted, ref, watchEffect } from 'vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  event: ToolEvent
}>()

const chat = useChatStore()

// ── shell tool timer ──────────────────────────────────────────────────────────

const SHELL_TOOLS = new Set(['run_command', 'git_command'])
const isShellTool = computed(() => SHELL_TOOLS.has(props.event.toolName ?? ''))
const isRunning = computed(() => props.event.status === 'running')
const elapsedSeconds = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

function tick(): void {
  elapsedSeconds.value = Math.floor((Date.now() - (props.event.startedAt ?? Date.now())) / 1000)
}
function stopTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

watchEffect(() => {
  if (isShellTool.value && isRunning.value) {
    tick()
    if (ticker === null)
      ticker = setInterval(tick, 500)
  }
  else {
    stopTicker()
    if (props.event.finishedAt != null && props.event.startedAt != null) {
      elapsedSeconds.value = Math.floor((props.event.finishedAt - props.event.startedAt) / 1000)
    }
  }
})

onUnmounted(stopTicker)

function formatElapsed(s: number): string {
  const clamped = Math.max(0, s)
  const m = Math.floor(clamped / 60)
  const sec = clamped % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ── sub-agent badge ───────────────────────────────────────────────────────────

const isSubAgent = computed(() => props.event.toolName === 'spawn_subagent')

const subAgentTabId = computed(
  () => props.event.metadata?.subAgentTabId as string | undefined,
)

/** True if the sub-agent tab still exists (user hasn't closed it). */
const subAgentTabExists = computed(() =>
  !!subAgentTabId.value && chat.tabs.some(t => t.id === subAgentTabId.value),
)

/** The sub-agent tab's live status (for status chip updates after tool result). */
const subAgentStatus = computed(() => {
  const t = chat.tabs.find(t => t.id === subAgentTabId.value)
  return t?.subAgent?.status ?? 'running'
})

/**
 * Parse personality from the badge label.
 * Label format: "Explorer · Mission text..." or just "Explorer"
 * We read from the underlying tool event label rather than re-parsing args.
 */
const personality = computed<SubAgentPersonality | null>(() => {
  const label = props.event.label.toLowerCase()
  if (label.startsWith('explorer'))
    return 'explorer'
  if (label.startsWith('researcher'))
    return 'researcher'
  if (label.startsWith('debugger'))
    return 'debugger'
  if (label.startsWith('general'))
    return 'general'
  return null
})

const PERSONALITY_COLOR: Record<string, string> = {
  explorer: 'info',
  researcher: 'success',
  debugger: 'warning',
  general: 'accent',
}

/** CSS class modifier for the personality color theme. */
const colorKey = computed(() =>
  personality.value ? PERSONALITY_COLOR[personality.value] ?? 'accent' : 'accent',
)

function openSubAgentTab() {
  if (!subAgentTabId.value || !subAgentTabExists.value)
    return
  chat.activeId = subAgentTabId.value
}
</script>

<template>
  <!-- ── Sub-agent badge ──────────────────────────────────────────────────── -->
  <button
    v-if="isSubAgent"
    class="subagent-badge"
    :class="[
      `subagent-badge--${colorKey}`,
      { 'subagent-badge--clickable': subAgentTabExists },
      { 'subagent-badge--closed': subAgentTabId && !subAgentTabExists },
    ]"
    :disabled="!subAgentTabExists"
    :title="subAgentTabExists ? 'Click to open sub-agent tab' : subAgentTabId ? 'Sub-agent tab was closed' : 'Sub-agent is initialising\u2026'"
    @click="openSubAgentTab"
  >
    <!-- Personality icon -->
    <span class="sa-icon-wrap" :class="`sa-icon-wrap--${colorKey}`">
      <Compass v-if="personality === 'explorer'" :size="11" :stroke-width="2" />
      <Globe v-else-if="personality === 'researcher'" :size="11" :stroke-width="2" />
      <Bug v-else-if="personality === 'debugger'" :size="11" :stroke-width="2" />
      <Cpu v-else :size="11" :stroke-width="2" />
    </span>

    <!-- Label: "Explorer · Analyze auth flow" -->
    <span class="sa-label">{{ event.label }}</span>

    <!-- Status chip -->
    <span
      class="sa-status"
      :class="`sa-status--${subAgentStatus}`"
    >
      <template v-if="subAgentStatus === 'running'">
        <span class="sa-pulse" />
        <span class="sa-status-text">Running</span>
      </template>
      <template v-else-if="subAgentStatus === 'done'">
        <span class="sa-status-text">Done</span>
        <ExternalLink v-if="subAgentTabExists" :size="9" :stroke-width="2" />
      </template>
      <template v-else>
        <span class="sa-status-text">{{ subAgentTabId ? 'Error' : 'Pending' }}</span>
      </template>
    </span>
  </button>

  <!-- ── Standard tool badge ─────────────────────────────────────────────── -->
  <span v-else class="tool-wrap">
    <span
      v-if="isShellTool"
      class="tool-timer"
      :class="{ 'tool-timer--done': !isRunning }"
    >
      {{ formatElapsed(elapsedSeconds) }}
    </span>
    <span class="tool-text">
      {{ event.label }}
    </span>
  </span>
</template>

<style scoped>
/* ── standard tool badge (unchanged) ─────────────────────────────────────── */

.tool-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  user-select: none;
}

.tool-timer {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1.6;
  color: var(--color-accent-text);
  opacity: 0.75;
  transition:
    opacity 400ms ease,
    color 400ms ease;
}
.tool-timer--done {
  color: var(--color-text-dim);
  opacity: 0.55;
}

.tool-text {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  letter-spacing: 0.01em;
  text-shadow:
    0 0 1px rgba(255, 255, 255, 0.06),
    0 0 10px rgba(224, 120, 48, 0.08);
  background: linear-gradient(
    110deg,
    var(--color-text-tertiary) 0%,
    var(--color-text-tertiary) 65%,
    rgba(255, 255, 255, 0.95) 75%,
    var(--color-text-tertiary) 85%,
    var(--color-text-tertiary) 100%
  );
  background-size: 200% auto;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gloss-sweep 2.5s linear infinite;
}

@keyframes gloss-sweep {
  0% {
    background-position: 200% center;
  }
  100% {
    background-position: 0% center;
  }
}

/* ── sub-agent badge ─────────────────────────────────────────────────────── */

.subagent-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding-inline: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
  cursor: default;
  user-select: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
  /* Reset button defaults */
  font-family: inherit;
  text-align: left;
  white-space: nowrap;
  max-width: 420px;
}

/* Clickable state (tab exists) */
.subagent-badge--clickable {
  cursor: pointer;
}
.subagent-badge--clickable:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-bright);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
}

/* Closed state (tab was closed) */
.subagent-badge--closed {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── personality color theming ── */
/* Explorer — info (blue) */
.subagent-badge--info {
  border-color: color-mix(in srgb, var(--color-info) 30%, var(--color-border-mid));
}
.subagent-badge--info:hover {
  border-color: color-mix(in srgb, var(--color-info) 55%, transparent);
}

/* Researcher — success (green) */
.subagent-badge--success {
  border-color: color-mix(in srgb, var(--color-success) 30%, var(--color-border-mid));
}
.subagent-badge--success:hover {
  border-color: color-mix(in srgb, var(--color-success) 55%, transparent);
}

/* Debugger — warning (amber) */
.subagent-badge--warning {
  border-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-border-mid));
}
.subagent-badge--warning:hover {
  border-color: color-mix(in srgb, var(--color-warning) 55%, transparent);
}

/* General — accent (orange) */
.subagent-badge--accent {
  border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-mid));
}
.subagent-badge--accent:hover {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}

/* ── personality icon ── */
.sa-icon-wrap {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
}
.sa-icon-wrap--info {
  background: var(--color-info-muted);
  color: var(--color-info-text);
}
.sa-icon-wrap--success {
  background: var(--color-success-muted);
  color: var(--color-success-text);
}
.sa-icon-wrap--warning {
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  color: var(--color-warning-text);
}
.sa-icon-wrap--accent {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

/* ── label ── */
.sa-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* ── status chip ── */
.sa-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 99px;
  flex-shrink: 0;
}

.sa-status--running {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info-text);
}
.sa-status--done {
  background: var(--color-success-muted);
  color: var(--color-success-text);
}
.sa-status--error {
  background: var(--color-danger-muted);
  color: var(--color-danger-text);
}

.sa-status-text {
  line-height: 1;
}

/* Running pulse dot */
.sa-pulse {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-info);
  animation: sa-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes sa-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.6);
  }
}
</style>
