<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { buildChatRequestPreview } from '@/stores/chat/requestPreview'
import { useSettingsStore } from '@/stores/settings'
import { estimateChatPrompt } from '@/utils/chatEstimate'

// --- Props ---
const props = defineProps<{
  text: string
  attachments: Attachment[]
}>()
// --- Emits ---
const emit = defineEmits<{
  compactSession: [payload: { source: 'auto' | 'manual' }]
}>()

// --- Stores ---
const chat = useChatStore()
const settings = useSettingsStore()

// --- Constants & Formatters (Instantiated once for performance) ---
const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS // ~56.55

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const intFormatter = new Intl.NumberFormat('en-US')

// --- Internal State ---
let debounceHandle: ReturnType<typeof setTimeout> | null = null
let activeController: AbortController | null = null
let activeEstimateTabId: string | null = null
const prevStreaming = shallowRef(false)
const lastAutoCompactKey = ref('')
const lastAutoCompactionDebugState = ref('')

// --- Computed: Model & Estimator State ---
const estimatorState = computed(() => chat.activeTab.estimator)
const estimate = computed(() => estimatorState.value.estimate)
const estimateError = computed(() => estimatorState.value.error)
const estimating = computed(() => estimatorState.value.estimating)

const hasModel = computed(
  () => !!(chat.activeTab.modelUid ?? settings.activeModelUid ?? settings.activeModel?.uid),
)

// --- Computed: UI Presentation ---
const usagePercent = computed(() => {
  const ratio = estimate.value?.contextUsageRatio
  if (ratio == null)
    return 0
  return Math.max(0, Math.min(Math.round(ratio * 100), 100))
})

const usageTone = computed(() => {
  if (usagePercent.value >= 90)
    return 'danger'
  if (usagePercent.value >= 70)
    return 'warning'
  return 'safe'
})

const manualCompactionEnabled = computed(() => settings.agent.sessionCompaction.showManualButton)
const autoCompactionEnabled = computed(() => settings.agent.sessionCompaction.auto)
const autoCompactionThreshold = computed(() => settings.agent.sessionCompaction.thresholdPercent)
const isCompacting = computed(() => Boolean(chat.activeTab.isCompacting))

const strokeDasharray = computed(() => {
  const progress = (usagePercent.value / 100) * RING_CIRCUMFERENCE
  return `${progress} ${RING_CIRCUMFERENCE}`
})

const contextSummary = computed(() => {
  if (!estimate.value)
    return 'Waiting for estimate'
  const input = intFormatter.format(estimate.value.inputTokens)
  const limit = estimate.value.contextLimit

  return limit == null ? `${input} tokens in prompt` : `${input} / ${intFormatter.format(limit)}`
})

const remainingSummary = computed(() => {
  if (!estimate.value)
    return 'Calculating prompt footprint'
  const remaining = estimate.value.remainingContext

  return remaining == null
    ? 'Context window unavailable for this model'
    : `${intFormatter.format(remaining)} tokens remaining`
})

function emitManualCompaction() {
  console.warn('[compaction] Manual compaction requested from estimator', {
    tabId: chat.activeTab.id,
    usagePercent: usagePercent.value,
    thresholdPercent: autoCompactionThreshold.value,
    messageCount: chat.activeTab.messages.length,
  })
  emit('compactSession', { source: 'manual' })
}

function emitAutoCompaction() {
  console.warn('[compaction] Auto compaction triggered from estimator', {
    tabId: chat.activeTab.id,
    usagePercent: usagePercent.value,
    thresholdPercent: autoCompactionThreshold.value,
    messageCount: chat.activeTab.messages.length,
    lastMessageId: chat.activeTab.messages.at(-1)?.id ?? null,
  })
  emit('compactSession', { source: 'auto' })
}

function valueSize(value: unknown): number {
  if (value == null)
    return 0
  if (typeof value === 'string')
    return value.length
  try {
    return JSON.stringify(value).length
  }
  catch {
    return String(value).length
  }
}

// --- Logic: Fingerprinting & Dependencies ---
/**
 * Creates an object representing all dependencies that should trigger a re-estimate.
 */
const estimationDependencies = computed(() => ({
  text: props.text,
  mode: 'build',
  attachmentsSig: props.attachments.map(a => `${a.id}:${a.size}`).join('|'),
  tabId: chat.activeTab.id,
  modelUid: chat.activeTab.modelUid ?? settings.activeModelUid,
  enabledModels: settings.enabledModels,
  settings: [
    settings.contextCaching,
    settings.autoContext,
    settings.disabledSkillIds.join(),
    settings.mcpServers.length,
  ].join('|'),
  // Include size-only fingerprints for streaming tool results/reasoning without storing their content here.
  messageSig: chat.activeTab.messages
    .map(
      m => [
        m.id,
        m.role,
        m.content.length,
        m.attachments?.length ?? 0,
        m.error ? 1 : 0,
        m.parts?.map(part => part.type === 'tool' ? part.toolCallId : `${part.type}:${part.text.length}`).join(',') ?? '',
        m.toolEvents?.map(event => `${event.id}:${event.status}:${valueSize(event.result)}`).join(',') ?? '',
      ].join(':'),
    )
    .join('|'),
}))

// --- Logic: Watchers ---
watch(
  estimationDependencies,
  () => {
    if (chat.activeTab.isStreaming) {
      prevStreaming.value = true
      scheduleEstimate(1200, { keepExisting: true })
    }
    else {
      scheduleEstimate(420)
    }
  },
  { immediate: true },
)

// Watch streaming explicitly to trigger a fast refresh right when it stops
watch(
  () => chat.activeTab.isStreaming,
  isStreaming => {
    if (!isStreaming && prevStreaming.value) {
      prevStreaming.value = false
      scheduleEstimate(150) // Shorter debounce for post-stream refresh
    }
  },
)

watch(
  () => [
    chat.activeTab.id,
    chat.activeTab.messages.length,
    chat.activeTab.messages.at(-1)?.id ?? '',
    usagePercent.value,
    estimating.value,
    chat.activeTab.isStreaming,
    isCompacting.value,
    autoCompactionEnabled.value,
    autoCompactionThreshold.value,
  ] as const,
  ([
    tabId,
    messageCount,
    lastMessageId,
    percent,
    isEstimating,
    isStreaming,
    compacting,
    autoEnabled,
    threshold,
  ]) => {
    const triggerKey = `${tabId}:${messageCount}:${lastMessageId}`
    const blockedReason = !autoEnabled
      ? 'disabled'
      : isEstimating
        ? 'estimating'
        : compacting
          ? 'compacting'
          : percent < threshold
            ? 'below-threshold'
            : lastAutoCompactKey.value === triggerKey
              ? 'already-triggered'
              : 'ready'

    if (
      autoEnabled
      && !isEstimating
      && !compacting
      && percent >= threshold
      && lastAutoCompactKey.value !== triggerKey
    ) {
      lastAutoCompactKey.value = triggerKey
      lastAutoCompactionDebugState.value = ''
      emitAutoCompaction()
      return
    }

    if (
      percent >= Math.max(50, threshold - 5)
      && lastAutoCompactionDebugState.value !== `${tabId}:${blockedReason}:${percent}:${messageCount}`
    ) {
      lastAutoCompactionDebugState.value = `${tabId}:${blockedReason}:${percent}:${messageCount}`
      console.warn('[compaction] Auto compaction not triggered', {
        tabId,
        usagePercent: percent,
        thresholdPercent: threshold,
        messageCount,
        isStreaming,
        blockedReason,
      })
    }

    if (percent < threshold || tabId !== lastAutoCompactKey.value.split(':')[0])
      lastAutoCompactKey.value = ''
  },
)

// --- Logic: Fetching & Concurrency ---
onUnmounted(() => {
  if (debounceHandle)
    clearTimeout(debounceHandle)
  cleanupActiveEstimation()
})

function cleanupActiveEstimation() {
  if (activeEstimateTabId) {
    chat.setTabEstimatorState(activeEstimateTabId, { estimating: false })
  }
  activeController?.abort()
}

function scheduleEstimate(delay: number, options: { keepExisting?: boolean } = {}) {
  if (options.keepExisting && debounceHandle)
    return
  if (debounceHandle)
    clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    debounceHandle = null
    void refreshEstimate()
  }, delay)
}

async function refreshEstimate() {
  cleanupActiveEstimation()

  const controller = new AbortController()
  activeController = controller
  const tabId = chat.activeTab.id
  activeEstimateTabId = tabId

  const updateState = (payload: Partial<typeof estimatorState.value>) => {
    if (controller.signal.aborted)
      return
    chat.setTabEstimatorState(tabId, payload)
    if (activeEstimateTabId === tabId)
      activeEstimateTabId = null
  }

  try {
    chat.setTabEstimatorState(tabId, { estimating: true, error: '' })

    const preview = await buildChatRequestPreview({
      tab: chat.activeTab,
      content: props.text,
      attachments: props.attachments,
    })

    if (!preview) {
      return updateState({ estimate: null, estimating: false })
    }

    const nextEstimate = await estimateChatPrompt(preview, controller.signal)
    updateState({ estimate: nextEstimate, estimating: false })
  }
  catch (error) {
    updateState({
      estimate: null,
      error: error instanceof Error ? error.message : 'Unknown estimation error',
      estimating: false,
    })
  }
}
</script>

<template>
  <div v-if="hasModel" class="estimator-wrap" tabindex="-1">
    <div class="estimator-inline">
      <button
        type="button"
        class="context-ring"
        :class="[
          `context-ring--${usageTone}`,
          { 'context-ring--loading': estimating && !estimate },
        ]"
        aria-label="Prompt context and cost details"
        aria-haspopup="dialog"
        aria-controls="estimator-popover"
      >
        <svg class="context-ring-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle
            class="context-ring-track"
            cx="12"
            cy="12"
            r="9"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <circle
            class="context-ring-progress"
            cx="12"
            cy="12"
            r="9"
            stroke-width="2.5"
            stroke-linecap="round"
            :stroke-dasharray="strokeDasharray"
          />
        </svg>
      </button>
    </div>

    <!-- Popover Details -->
    <div id="estimator-popover" class="estimator-popover" role="tooltip">
      <header class="estimator-header">
        <div class="estimator-title-row">
          <span class="estimator-title">Prompt Context</span>
          <span class="estimator-percent">{{ usagePercent }}%</span>
        </div>
        <p class="estimator-summary">
          {{ contextSummary }}
        </p>
        <p class="estimator-subtle">
          {{ remainingSummary }}
        </p>
      </header>

      <main v-if="estimate" class="estimator-grid">
        <div class="estimator-row">
          <span class="estimator-label">Input cost</span>
          <span class="estimator-value">{{ usdFormatter.format(estimate.inputCost) }}</span>
        </div>
        <div class="estimator-row">
          <span class="estimator-label">Max output cost</span>
          <span class="estimator-value">
            {{ usdFormatter.format(estimate.projectedOutputCost) }}
          </span>
        </div>
        <div
          v-if="estimate.projectedReasoningTokens > 0 || estimate.projectedReasoningCost > 0"
          class="estimator-row"
        >
          <span class="estimator-label">Reasoning budget</span>
          <span class="estimator-value">
            {{ usdFormatter.format(estimate.projectedReasoningCost) }}
          </span>
        </div>
        <div class="estimator-row estimator-row--strong">
          <span class="estimator-label">Max total est.</span>
          <span class="estimator-value">
            {{ usdFormatter.format(estimate.projectedMaxTotalCost) }}
          </span>
        </div>
      </main>

      <!-- Only shows if there's a calculation error -->
      <footer v-if="estimateError" class="estimator-footer">
        <p class="estimator-meta estimator-meta--error" role="alert">
          {{ estimateError }}
        </p>
      </footer>

      <!-- Compact Session Action -->
      <div v-if="manualCompactionEnabled" class="estimator-compact-row">
        <button
          type="button"
          class="estimator-compact-btn"
          :disabled="isCompacting"
          @click="emitManualCompaction"
        >
          {{ isCompacting ? 'Compacting...' : 'Compact Session' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.estimator-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  outline: none;
}

.estimator-inline {
  display: flex;
  align-items: center;
  padding: 0;
  background: transparent;
  border: none;
}

.context-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.context-ring:hover,
.context-ring:focus-visible {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
  outline: none;
}

.context-ring:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.context-ring-svg {
  width: 18px;
  height: 18px;
  transform: rotate(-90deg);
}

.context-ring-track {
  stroke: color-mix(in srgb, var(--color-text-tertiary) 20%, transparent);
}

.context-ring-progress {
  stroke: color-mix(in srgb, var(--color-text-tertiary) 70%, transparent);
  stroke-dashoffset: 0;
  transition:
    stroke-dasharray 400ms ease,
    stroke 300ms ease;
}

.context-ring--safe .context-ring-progress {
  stroke: var(--color-success-text);
}
.context-ring--warning .context-ring-progress {
  stroke: var(--color-warning-text);
}
.context-ring--danger .context-ring-progress {
  stroke: var(--color-danger-text);
}

.context-ring--loading .context-ring-svg {
  animation: estimator-spin 1.4s linear infinite;
}

.context-ring--loading .context-ring-progress {
  stroke-dasharray: 20 56.55;
  stroke: color-mix(in srgb, var(--color-text-tertiary) 60%, transparent);
}

/* --- POPOVER UPDATES --- */
.estimator-popover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  width: 260px;
  padding: 12px;
  border-radius: var(--radius-lg);

  background: var(--color-bg-elevated);

  border: 1px solid var(--color-border-bright);
  box-shadow: var(--color-shadow-floating);

  opacity: 0;
  visibility: hidden;
  transform: translateX(-50%) translateY(6px) scale(0.98);
  transition:
    opacity 120ms ease-out,
    transform 120ms ease-out,
    visibility 120ms;
  z-index: 10020;
}

.estimator-wrap:hover .estimator-popover,
.context-ring:focus-visible + .estimator-popover {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0) scale(1);
}

/* --- TYPOGRAPHY & LAYOUT --- */
.estimator-header {
  padding-bottom: 10px;
  margin-bottom: 4px; /* Added margin so the grid doesn't hug the line too tightly */
  /* FIX: Translucent wash instead of a solid opaque line */
  border-bottom: 1px solid var(--color-border-mid);
}

.estimator-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.estimator-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-tertiary);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.estimator-percent {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.estimator-summary {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.estimator-subtle {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.estimator-grid {
  display: grid;
  gap: 6px;
  padding-top: 10px;
}

.estimator-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.estimator-row--strong {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-mid);
}

.estimator-label {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.estimator-value {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.estimator-footer {
  display: grid;
  padding-top: 10px;
}

.estimator-meta {
  margin: 0;
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.estimator-meta--error {
  color: var(--color-danger-text);
  font-weight: 500;
}

/* --- Compact Session Button --- */
.estimator-compact-row {
  display: flex;
  justify-content: center;
  padding-top: 10px;
  margin-top: 10px;
  border-top: 1px solid var(--color-border-mid);
}

.estimator-compact-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.estimator-compact-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
}

.estimator-compact-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.estimator-compact-btn:disabled {
  opacity: 0.55;
  cursor: progress;
  transform: none;
}

@keyframes estimator-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
