<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import type { UsageStats } from '@/utils/contextCaching'
import type { SubAgentPersonality } from '@/utils/tools/subagent'
import { CircleX, Loader2 } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { dbFindSubAgentConversation, dbGetConversation, dbLoadMessages } from '@/db/database'
import { useChatStore } from '@/stores/chat'
import { safeJsonParse } from '@/utils/repairJson'

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

const shellResult = computed(() => {
  const r = props.event.result
  if (r && typeof r === 'object' && !Array.isArray(r))
    return r as Record<string, unknown>
  return null
})

const exitCode = computed(() => {
  if (shellResult.value && 'exit_code' in shellResult.value)
    return typeof shellResult.value.exit_code === 'number' ? shellResult.value.exit_code : null
  return null
})

const exitLabel = computed(() => {
  const durMs = shellResult.value && typeof shellResult.value.duration_ms === 'number'
    ? shellResult.value.duration_ms
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

  let convId = subAgentConversationId.value

  if (!convId) {
    // Attempt to recover old subagent conversations by title and timestamp
    const args = props.event.args
    if (args?.personality && args?.mission) {
      const { PERSONALITY_META } = await import('@/utils/tools/subagent')
      const meta = PERSONALITY_META[args.personality as keyof typeof PERSONALITY_META]
      if (meta) {
        const missionStr = String(args.mission)
        const titleMission = missionStr.length > 40 ? `${missionStr.slice(0, 40)}\u2026` : missionStr
        const title = `${meta.label} \u00B7 ${titleMission}`

        try {
          const recovered = await dbFindSubAgentConversation(title, props.event.startedAt)
          if (recovered) {
            convId = recovered.id
          }
        }
        catch (err) {
          console.error('Failed to recover subagent conversation:', err)
        }
      }
    }
  }

  if (!convId)
    return

  try {
    isOpening.value = true
    const conv = await dbGetConversation(convId)
    if (!conv)
      return

    const rawMsgs = await dbLoadMessages(conv.id)
    const messages: Message[] = rawMsgs.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: new Date(r.created_at),
      ...(r.tool_events ? { toolEvents: safeJsonParse(r.tool_events, []) } : {}),
      ...(r.parts ? { parts: safeJsonParse(r.parts, []) } : {}),
      ...(r.cache_stats ? { cacheStats: safeJsonParse<UsageStats>(r.cache_stats, { providerId: '', promptTokens: 0, completionTokens: 0, totalTokens: 0 }) } : {}),
      ...(r.model_uid ? { modelUid: r.model_uid } : {}),
      ...(r.model_name ? { modelName: r.model_name } : {}),
      ...(r.is_complete === 0 ? { error: 'Interrupted during generation.' } : {}),
      ...(r.is_bg_notification === 1 ? { isBgNotification: true } : {}),
    }))

    chat.openConversation({
      conversationId: conv.id,
      title: conv.title,
      messages,
      workspacePath: conv.workspace_path ?? null,
      workspaceMeta: conv.workspace_meta ? safeJsonParse(conv.workspace_meta, null) : null,
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
    :is="isSubAgent ? 'button' : 'span'"
    class="group/tool m-0 inline-flex items-baseline gap-1.5 whitespace-nowrap select-none border-none bg-transparent p-0 text-inherit [font:inherit] [text-align:inherit]"
    :class="[
      (subAgentTabExists || subAgentConversationId || isSubAgent) ? 'cursor-pointer' : '',
    ]"
    :disabled="isSubAgent && isOpening"
    :title="isSubAgent ? 'Click to view sub-agent history' : undefined"
    @click="isSubAgent ? openSubAgentTab() : undefined"
  >
    <!-- Running shell tool: spinner + "Running" -->
    <template v-if="isShellTool && isRunning">
      <Loader2 :size="10" class="inline-block text-[var(--color-accent-text)]" />
      <span v-if="executionStartedAt !== null" class="ml-1 text-[11px] font-medium text-[var(--color-accent-text)] opacity-70">
        Running {{ runningElapsedLabel }}
      </span>
      <span v-else class="ml-1 text-[11px] font-medium text-[var(--color-accent-text)] opacity-70">Waiting</span>
    </template>
    <!-- Completed shell tool: show exit code + duration -->
    <span
      v-else-if="isShellTool && !isRunning"
      class="text-[11px] font-medium tabular-nums tracking-[0.02em] leading-[1.6]"
      :class="exitCode === 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'"
    >
      {{ exitLabel }}
    </span>

    <CircleX v-if="showFailIcon" :size="12" class="shrink-0 text-[var(--color-danger)]" />

    <span
      v-if="hasAnnotations"
      class="gloss-text inline-block text-[12px] font-semibold leading-[1.6] tracking-[0.01em] text-[var(--color-text-tertiary)] [text-shadow:0_0_1px_color-mix(in_srgb,var(--color-bg-base)_6%,transparent),0_0_10px_color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
      :class="(subAgentTabExists || subAgentConversationId || isSubAgent) ? 'group-hover/tool:opacity-80' : ''"
    >
      <template v-for="(seg, i) in labelSegments" :key="i">
        <span v-if="seg.kind === 'range'" class="animate-none text-[11px] font-bold tabular-nums tracking-[0.03em] text-[var(--color-success)] [-webkit-background-clip:unset] [-webkit-text-fill-color:var(--color-success)] [background-clip:unset] [background:none]">{{ seg.text }}</span>
        <span v-else-if="seg.kind === 'diff-add'" class="animate-none text-[11px] font-bold tabular-nums tracking-[0.03em] text-[var(--color-success)] [-webkit-background-clip:unset] [-webkit-text-fill-color:var(--color-success)] [background-clip:unset] [background:none]">{{ seg.text }}</span>
        <span v-else-if="seg.kind === 'diff-remove'" class="animate-none text-[11px] font-bold tabular-nums tracking-[0.03em] text-[var(--color-danger)] [-webkit-background-clip:unset] [-webkit-text-fill-color:var(--color-danger)] [background-clip:unset] [background:none]">{{ seg.text }}</span>
        <template v-else>{{ seg.text }}</template>
      </template>
    </span>
    <span
      v-else
      class="gloss-text inline-block text-[12px] font-semibold leading-[1.6] tracking-[0.01em] text-[var(--color-text-tertiary)] [text-shadow:0_0_1px_color-mix(in_srgb,var(--color-bg-base)_6%,transparent),0_0_10px_color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
      :class="(subAgentTabExists || subAgentConversationId || isSubAgent) ? 'group-hover/tool:opacity-80' : ''"
    >
      {{ isOpening ? 'Loading sub-agent...' : event.label }}
    </span>
  </component>
</template>

<style>
@keyframes text-gloss-sweep {
  from {
    background-position: 0% center;
  }
  to {
    background-position: 100% center;
  }
}

.gloss-text {
  background-image: linear-gradient(
    100deg,
    var(--color-text-tertiary) 0%,
    var(--color-text-tertiary) 35%,
    color-mix(in srgb, var(--color-accent) 60%, white) 50%,
    var(--color-text-tertiary) 65%,
    var(--color-text-tertiary) 100%
  );
  background-size: 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: text-gloss-sweep 3.5s ease-in-out infinite;
}
</style>
