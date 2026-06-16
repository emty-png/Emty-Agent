<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import type { SubAgentPersonality } from '@/utils/tools/subagent'
import { CircleX, Loader2 } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { dbGetConversation, dbLoadMessages } from '@/db/database'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  event: ToolEvent
}>()

const chat = useChatStore()

// ── shell tool timer ──────────────────────────────────────────────────────────

const SHELL_TOOLS = new Set(['run_command', 'git_command'])
const isShellTool = computed(() => SHELL_TOOLS.has(props.event.toolName ?? ''))
const isRunning = computed(() => props.event.status === 'running')
const isError = computed(() => props.event.status === 'error')
const showFailIcon = computed(() => isError.value && !isShellTool.value)
const nowMs = ref(Date.now())
let timerId: number | null = null

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const executionStartedAt = computed(() => {
  const value = props.event.metadata?.executionStartedAt
  return typeof value === 'number' ? value : null
})

const runningElapsedLabel = computed(() =>
  executionStartedAt.value === null
    ? ''
    : formatElapsed(nowMs.value - executionStartedAt.value),
)

onMounted(() => {
  timerId = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timerId !== null)
    window.clearInterval(timerId)
})

// ── shell tool exit badge ─────────────────────────────────────────────────────

const exitCode = computed(() => {
  const result = props.event.result as Record<string, unknown> | undefined
  if (result && typeof result === 'object' && 'exit_code' in result)
    return typeof result.exit_code === 'number' ? result.exit_code : null
  return null
})

const exitLabel = computed(() => {
  const result = props.event.result as Record<string, unknown> | undefined
  const durMs = result && typeof result === 'object' && typeof result.duration_ms === 'number'
    ? result.duration_ms
    : null
  const duration = durMs !== null ? ` (${(durMs / 1000).toFixed(1)}s)` : ''

  if (exitCode.value === -1)
    return `[Timeout]${duration}`
  if (exitCode.value !== null)
    return `[Exit ${exitCode.value}]${duration}`
  return duration || ''
})

// ── label segmentation ────────────────────────────────────────────────────────

/**
 * Token kinds the label can contain:
 *   plain      — unstyled text, inherits parent gradient
 *   range      — "#0–499" line-range annotation (dimmed)
 *   diff-add   — "+22"  diff addition count (green)
 *   diff-remove — "-5"  diff removal count (red)
 */
type SegmentKind = 'plain' | 'range' | 'diff-add' | 'diff-remove'

interface LabelSegment {
  text: string
  kind: SegmentKind
}

/**
 * Unified tokenizer regex — groups in priority order:
 *   1. Range / count     #250–499  #250-499  #312  (hash + digits, optional
 *      range; must come first to not mis-classify trailing digits as diff)
 *   2. Diff addition     +22       (standalone +digits anywhere)
 *   3. Diff removal      ·-5       (space then -digits — the leading space is
 *      intentional; it prevents matching hyphens inside filenames like "v1-2.ts")
 *
 * The space before group 3 is consumed by the regex so we can emit it as a
 * plain segment and colour only the "-N" part.
 */
const TOKEN_RE = /(#\d+(?:[–\-]\d+)?)|(\+\d+)|( -\d+)/g

const labelSegments = computed<LabelSegment[]>(() => {
  const label = props.event.label
  const segments: LabelSegment[] = []
  let lastIndex = 0

  const matches = label.matchAll(TOKEN_RE)
  for (const match of matches) {
    // Emit any plain text between the last match and this one.
    if (match.index > lastIndex)
      segments.push({ text: label.slice(lastIndex, match.index), kind: 'plain' })

    if (match[1]) {
      // Range or count token: #250–499 or #312
      segments.push({ text: match[1], kind: 'range' })
    }
    else if (match[2]) {
      // Diff-add token: +22
      segments.push({ text: match[2], kind: 'diff-add' })
    }
    else if (match[3]) {
      // Diff-remove token: " -5" — split the leading space from the coloured part.
      segments.push({ text: ' ', kind: 'plain' })
      segments.push({ text: match[3].trimStart(), kind: 'diff-remove' })
    }

    lastIndex = match.index + match[0].length
  }

  // Emit any trailing plain text.
  if (lastIndex < label.length)
    segments.push({ text: label.slice(lastIndex), kind: 'plain' })

  // If nothing matched, return a single plain segment — no overhead in template.
  return segments.length > 0 ? segments : [{ text: label, kind: 'plain' }]
})

/** True when at least one non-plain segment exists; gates the segmented render path. */
const hasAnnotations = computed(() =>
  labelSegments.value.some(s => s.kind !== 'plain'),
)

// ── sub-agent badge ───────────────────────────────────────────────────────────

const isSubAgent = computed(() => props.event.toolName === 'spawn_subagent')

const subAgentTabId = computed(
  () => props.event.metadata?.subAgentTabId as string | undefined,
)

const subAgentConversationId = computed(
  () => props.event.metadata?.subAgentConversationId as string | undefined,
)

const subAgentTabExists = computed(() =>
  !!subAgentTabId.value && chat.tabs.some(t => t.id === subAgentTabId.value),
)

const subAgentStatus = computed(() => {
  if (subAgentTabExists.value) {
    const t = chat.tabs.find(t => t.id === subAgentTabId.value)
    if (t?.subAgent?.status)
      return t.subAgent.status
  }
  return props.event.status
})

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

const isOpening = ref(false)

async function openSubAgentTab() {
  if (subAgentTabExists.value && subAgentTabId.value) {
    chat.activeId = subAgentTabId.value
    return
  }

  if (!subAgentConversationId.value)
    return

  try {
    isOpening.value = true
    const conv = await dbGetConversation(subAgentConversationId.value)
    if (!conv)
      return

    const rawMsgs = await dbLoadMessages(subAgentConversationId.value)
    const messages: Message[] = rawMsgs.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: new Date(r.created_at),
      toolEvents: r.tool_events ? JSON.parse(r.tool_events) : undefined,
      parts: r.parts ? JSON.parse(r.parts) : undefined,
      cacheStats: r.cache_stats ? JSON.parse(r.cache_stats) : undefined,
      ...(r.is_complete === 0 ? { error: 'Interrupted during generation.' } : {}),
    }))

    chat.openConversation({
      conversationId: conv.id,
      title: conv.title,
      messages,
      workspacePath: conv.workspace_path ?? null,
      workspaceMeta: conv.workspace_meta ? JSON.parse(conv.workspace_meta) : null,
      subAgent: {
        personality: personality.value ?? 'general',
        mission: typeof props.event.args?.mission === 'string' ? props.event.args.mission : '',
        parentTabId: chat.activeId,
        status: 'done',
      },
    })

    const newTab = chat.tabs.find(t => t.conversationId === conv.id)
    if (newTab) {
      chat.activeId = newTab.id
      if (props.event.metadata) {
        // ToolEvent is shared with the store's messages array — mutation is intentional
        // eslint-disable-next-line vue/no-mutating-props
        props.event.metadata.subAgentTabId = newTab.id
      }
    }
  }
  catch (err) {
    console.error('Failed to open sub-agent tab', err)
  }
  finally {
    isOpening.value = false
  }
}
</script>

<template>
  <component
    :is="isSubAgent && (subAgentTabExists || subAgentConversationId) ? 'button' : 'span'"
    class="tool-wrap"
    :class="{ 'tool-wrap--clickable': isSubAgent && (subAgentTabExists || subAgentConversationId) }"
    :disabled="isSubAgent && isOpening"
    :title="isSubAgent
      ? (subAgentTabExists
        ? 'Click to view sub-agent'
        : subAgentConversationId
          ? 'Click to load sub-agent history'
          : 'Sub-agent is initialising\u2026')
      : undefined"
    @click="isSubAgent ? openSubAgentTab() : undefined"
  >
    <!-- Running shell tool: spinner + "Running" -->
    <template v-if="isShellTool && isRunning">
      <Loader2 :size="10" class="tool-spinner animate-spin inline-block" />
      <span v-if="executionStartedAt !== null" class="tool-running-label">
        Running {{ runningElapsedLabel }}
      </span>
      <span v-else class="tool-running-label">Waiting</span>
    </template>
    <!-- Completed shell tool: show exit code + duration -->
    <span
      v-else-if="isShellTool && !isRunning"
      class="tool-exit"
      :class="exitCode === 0 ? 'tool-exit--ok' : 'tool-exit--fail'"
    >
      {{ exitLabel }}
    </span>

    <template v-else-if="isSubAgent">
      <span class="tool-timer">
        <template v-if="isOpening">
          <Loader2 :size="10" class="animate-spin inline-block mr-1" />Loading
        </template>
        <template v-else-if="subAgentStatus === 'running'">
          <Loader2 :size="10" class="animate-spin inline-block mr-1" />Running
        </template>
        <template v-else-if="subAgentStatus === 'done'">
          Done
        </template>
        <template v-else>
          Error
        </template>
      </span>
    </template>

    <CircleX v-if="showFailIcon && !isSubAgent" :size="12" class="tool-fail-icon" />

    <span v-if="hasAnnotations" class="tool-text">
      <template v-for="(seg, i) in labelSegments" :key="i">
        <span v-if="seg.kind === 'range'" class="tt-range">{{ seg.text }}</span>
        <span v-else-if="seg.kind === 'diff-add'" class="tt-diff tt-diff--add">{{ seg.text }}</span>
        <span v-else-if="seg.kind === 'diff-remove'" class="tt-diff tt-diff--remove">{{ seg.text }}</span>
        <template v-else>{{ seg.text }}</template>
      </template>
    </span>
    <span v-else class="tool-text">
      {{ event.label }}
    </span>
  </component>
</template>

<style scoped>
/* ── standard tool badge ─────────────────────────────────────────────────── */

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

.tool-exit {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1.6;
}
.tool-exit--ok {
  color: var(--color-success);
}
.tool-exit--fail {
  color: var(--color-danger);
}

.tool-spinner {
  color: var(--color-accent-text);
}

.tool-running-label {
  font-size: 11px;
  font-weight: 500;
  margin-left: 4px;
  opacity: 0.7;
  color: var(--color-accent-text);
}

.tool-fail-icon {
  flex-shrink: 0;
  color: var(--color-danger);
}

/*
 * The primary label element.
 * Applies a sweeping gloss gradient to all plain text children.
 * Coloured child spans (tt-diff, tt-range) must opt out of this gradient
 * by resetting background-clip and -webkit-text-fill-color.
 */
.tool-text {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  letter-spacing: 0.01em;
  text-shadow:
    0 0 1px color-mix(in srgb, var(--color-bg-base) 6%, transparent),
    0 0 10px color-mix(in srgb, var(--color-accent) 8%, transparent);
  background: linear-gradient(
    110deg,
    var(--color-text-tertiary) 0%,
    var(--color-text-tertiary) 65%,
    color-mix(in srgb, var(--color-bg-base) 95%, transparent) 75%,
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

/* ── range annotation: "#0–499" ─────────────────────────────────────────── */

/*
 * Escapes the parent gradient (same technique as .tt-diff) so it renders
 * as a solid colour instead of an invisible dimmed gradient fragment.
 * Uses --color-success-text (green) at reduced opacity to read as metadata
 * rather than competing with the diff-add "+" tokens.
 */
.tt-range {
  /* Escape parent gradient */
  background: none;
  -webkit-background-clip: unset;
  background-clip: unset;
  animation: none;
  /* Typography */
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
  /* Colour */
  -webkit-text-fill-color: var(--color-success);
  color: var(--color-success);
}

/* ── diff stat tokens: "+22" / "-5" ─────────────────────────────────────── */

/*
 * Must escape the parent's `background-clip: text` + `-webkit-text-fill-color: transparent`
 * gradient to render a solid colour. We do this by:
 *   1. Clearing the background so background-clip has nothing to clip.
 *   2. Setting -webkit-text-fill-color to a solid value, overriding transparent.
 *   3. Setting color as a fallback for non-WebKit engines.
 * animation: none prevents the parent keyframe from touching these spans.
 */
.tt-diff {
  /* Escape parent gradient */
  background: none;
  -webkit-background-clip: unset;
  background-clip: unset;
  animation: none;
  /* Typography */
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.tt-diff--add {
  -webkit-text-fill-color: var(--color-success);
  color: var(--color-success);
}

.tt-diff--remove {
  -webkit-text-fill-color: var(--color-danger);
  color: var(--color-danger);
}

/* ── sub-agent badge ─────────────────────────────────────────────────────── */

.subagent-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding-inline: 6px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  background: var(--color-bg-elevated);
  cursor: default;
  user-select: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
  font-family: inherit;
  text-align: left;
  white-space: nowrap;
  max-width: 420px;
}

.subagent-badge--clickable {
  cursor: pointer;
}
.subagent-badge--clickable:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-bright);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
}

.subagent-badge--closed {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Personality colour theming */
.subagent-badge--info {
  border-color: color-mix(in srgb, var(--color-info) 30%, var(--color-border-mid));
}
.subagent-badge--info:hover {
  border-color: color-mix(in srgb, var(--color-info) 55%, transparent);
}
.subagent-badge--success {
  border-color: color-mix(in srgb, var(--color-success) 30%, var(--color-border-mid));
}
.subagent-badge--success:hover {
  border-color: color-mix(in srgb, var(--color-success) 55%, transparent);
}
.subagent-badge--warning {
  border-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-border-mid));
}
.subagent-badge--warning:hover {
  border-color: color-mix(in srgb, var(--color-warning) 55%, transparent);
}
.subagent-badge--accent {
  border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-mid));
}
.subagent-badge--accent:hover {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}

/* Personality icon */
.sa-icon-wrap {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
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

/* Label */
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

/* Status chip */
.sa-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: var(--radius-md);
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
