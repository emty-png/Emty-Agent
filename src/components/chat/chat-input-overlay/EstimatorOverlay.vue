<script setup lang="ts">
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agent/status'
import { buildChatRequestPreview } from '@/stores/chat/context/requestPreview'
import { useSettingsStore } from '@/stores/settings'
import { estimateChatPrompt } from '@/utils/chatEstimate'

const props = defineProps<{
  text: string
  attachments: Attachment[]
}>()
const emit = defineEmits<{
  compactSession: [payload: { source: 'auto' | 'manual' }]
}>()

const chat = useChatStore()
const settings = useSettingsStore()

const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS // ~56.55

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const intFormatter = new Intl.NumberFormat('en-US')

const debounceHandle = ref<ReturnType<typeof setTimeout> | null>(null)
const activeController = shallowRef<AbortController | null>(null)
const activeEstimateTabId = ref<string | null>(null)
const prevStreaming = shallowRef(false)
const lastAutoCompactKey = ref('')
const lastAutoCompactionDebugState = ref('')

const isOpen = ref(false)

const closeTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

function openPopover() {
  if (closeTimeout.value) {
    clearTimeout(closeTimeout.value)
    closeTimeout.value = null
  }
  isOpen.value = true
}

function closePopover() {
  if (closeTimeout.value)
    clearTimeout(closeTimeout.value)
  closeTimeout.value = setTimeout(() => {
    isOpen.value = false
  }, 150) // Small grace period delay to allow cursor transitions
}

const estimatorState = computed(() => chat.activeTab.estimator)
const estimate = computed(() => estimatorState.value.estimate)
const estimateError = computed(() => estimatorState.value.error)
const estimating = computed(() => estimatorState.value.estimating)

const hasModel = computed(
  () => !!(chat.activeTab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid ?? settings.activeModel?.uid),
)

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

const estimationDependencies = computed(() => ({
  text: props.text,
  mode: 'build',
  attachmentsSig: props.attachments.map(a => `${a.id}:${a.size}`).join('|'),
  tabId: chat.activeTab.id,
  modelUid: chat.activeTab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid,
  enabledModels: settings.enabledModels,
  settings: [
    settings.contextCaching,
    settings.autoContext,
    settings.disabledSkillIds.join(),
    settings.mcpServers.length,
  ].join('|'),
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

watch(
  estimationDependencies,
  () => {
    if (isStreamingStatus(chat.activeTab.agentStatus)) {
      prevStreaming.value = true
      scheduleEstimate(1200, { keepExisting: true })
    }
    else {
      scheduleEstimate(420)
    }
  },
  { immediate: true },
)

watch(
  () => isStreamingStatus(chat.activeTab.agentStatus),
  isStreaming => {
    if (!isStreaming && prevStreaming.value) {
      prevStreaming.value = false
      scheduleEstimate(150)
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
    isStreamingStatus(chat.activeTab.agentStatus),
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
    let blockedReason: string
    if (!autoEnabled)
      blockedReason = 'disabled'
    else if (isEstimating)
      blockedReason = 'estimating'
    else if (compacting)
      blockedReason = 'compacting'
    else if (percent < threshold)
      blockedReason = 'below-threshold'
    else if (lastAutoCompactKey.value === triggerKey)
      blockedReason = 'already-triggered'
    else blockedReason = 'ready'

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

onUnmounted(() => {
  if (debounceHandle.value)
    clearTimeout(debounceHandle.value)
  if (closeTimeout.value)
    clearTimeout(closeTimeout.value)
  cleanupActiveEstimation()
})

function cleanupActiveEstimation() {
  if (activeEstimateTabId.value) {
    chat.setTabEstimatorState(activeEstimateTabId.value, { estimating: false })
  }
  activeController.value?.abort()
}

function scheduleEstimate(delay: number, options: { keepExisting?: boolean } = {}) {
  if (options.keepExisting && debounceHandle.value)
    return
  if (debounceHandle.value)
    clearTimeout(debounceHandle.value)
  debounceHandle.value = setTimeout(() => {
    debounceHandle.value = null
    void refreshEstimate()
  }, delay)
}

async function refreshEstimate() {
  cleanupActiveEstimation()

  const controller = new AbortController()
  activeController.value = controller
  const tabId = chat.activeTab.id
  activeEstimateTabId.value = tabId

  const updateState = (payload: Partial<typeof estimatorState.value>) => {
    if (controller.signal.aborted)
      return
    chat.setTabEstimatorState(tabId, payload)
    if (activeEstimateTabId.value === tabId)
      activeEstimateTabId.value = null
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

// --- Presentation: Tailwind v4 class strings ---
// The ring's tone/loading state and the popover's open/closed state each
// used to be driven by CSS descendant selectors keyed off a parent modifier
// class (`.context-ring--danger .context-ring-progress`, `.estimator-popover--open`).
// With no stylesheet to hang those selectors on, each state is resolved to a
// complete class string here so branches never fight over the same property.

const isLoadingRing = computed(() => estimating.value && !estimate.value)

// CSS previously overrode the bound `stroke-dasharray` attribute while loading
// (an author stylesheet rule beats an SVG presentation attribute) — now that
// override is just resolved directly in script.
const displayDasharray = computed(() => (isLoadingRing.value ? '20 56.55' : strokeDasharray.value))

const ringSvgClasses = computed(() =>
  isLoadingRing.value
    // The spin animation drives `transform` itself, so the static -90deg
    // rotation below is intentionally dropped while loading (matches the
    // original: an animated `transform` fully overrides a static one).
    ? 'w-[18px] h-[18px] animate-[spin_1.4s_linear_infinite]'
    : 'w-[18px] h-[18px] [transform:rotate(-90deg)]',
)

const progressStrokeClass = computed(() => {
  if (isLoadingRing.value)
    return 'stroke-[color-mix(in_srgb,var(--color-text-tertiary)_60%,transparent)]'
  if (usageTone.value === 'danger')
    return 'stroke-(--color-danger-text)'
  if (usageTone.value === 'warning')
    return 'stroke-(--color-warning-text)'
  return 'stroke-(--color-success-text)'
})

const CONTEXT_RING_CLASSES = [
  'flex items-center justify-center w-[30px] h-[30px] p-0 border border-transparent',
  'rounded-(--radius-md) bg-transparent cursor-pointer shrink-0',
  '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]',
  '[&:hover,&:focus-visible]:bg-(--color-state-hover) [&:hover,&:focus-visible]:border-(--color-border-mid)',
  '[&:hover,&:focus-visible]:rounded-(--radius-lg) [&:hover,&:focus-visible]:outline-none',
  'active:scale-[0.97] active:duration-[80ms]',
].join(' ')

const POPOVER_BASE_CLASSES = [
  'w-[260px] p-3 rounded-(--radius-lg) bg-(--color-bg-surface) border border-(--color-border-mid)',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)]',
].join(' ')

const COMPACT_BTN_CLASSES = [
  'inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-(--color-text-secondary)',
  'bg-transparent border border-transparent rounded-(--radius-md) cursor-pointer',
  '[transition:background_100ms_cubic-bezier(0.4,0,0.2,1),border-color_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]',
  'hover:text-(--color-text-primary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle)',
  'active:scale-[0.97] active:duration-[80ms]',
  'disabled:opacity-[0.55] disabled:cursor-progress disabled:[transform:none]',
].join(' ')
</script>

<template>
  <div v-if="hasModel" class="relative flex items-center shrink-0 outline-none" tabindex="-1">
    <div class="flex items-center p-0 bg-transparent border-none">
      <button
        type="button"
        :class="CONTEXT_RING_CLASSES"
        aria-label="Prompt context and cost details"
        aria-haspopup="dialog"
        aria-controls="estimator-popover"
        @mouseenter="openPopover"
        @mouseleave="closePopover"
        @focus="openPopover"
        @blur="closePopover"
      >
        <svg :class="ringSvgClasses" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke-width="2.5"
            stroke-linecap="round"
            class="stroke-[color-mix(in_srgb,var(--color-text-tertiary)_20%,transparent)]"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke-width="2.5"
            stroke-linecap="round"
            :stroke-dasharray="displayDasharray"
            class="[stroke-dashoffset:0] [transition:stroke-dasharray_400ms_ease,stroke_300ms_ease]" :class="[progressStrokeClass]"
          />
        </svg>
      </button>
    </div>

    <!-- Popover always above trigger -->
    <div class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10020]">
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-out origin-bottom"
        enter-from-class="opacity-0 [transform:translateY(6px)_scale(0.98)]"
        enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-active-class="transition-[opacity,transform] duration-100 ease-in origin-bottom"
        leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-to-class="opacity-0 [transform:translateY(6px)_scale(0.98)]"
      >
        <div
          v-if="isOpen"
          id="estimator-popover"
          :class="POPOVER_BASE_CLASSES"
          role="tooltip"
          @mouseenter="openPopover"
          @mouseleave="closePopover"
        >
          <header class="pb-2.5 mb-1 border-b border-(--color-border-mid)">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11px] font-bold text-(--color-text-tertiary) tracking-[0.05em] uppercase">Prompt Context</span>
              <span class="text-[11px] font-bold text-(--color-text-secondary) tabular-nums">{{ usagePercent }}%</span>
            </div>
            <p class="mt-1.5 text-xs font-semibold text-(--color-text-primary)">
              {{ contextSummary }}
            </p>
            <p class="mt-0.5 text-[11px] text-(--color-text-tertiary) leading-[1.4]">
              {{ remainingSummary }}
            </p>
          </header>

          <main v-if="estimate" class="grid gap-1.5 pt-2.5">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11.5px] text-(--color-text-secondary) font-normal">Input cost</span>
              <span class="text-[11.5px] font-semibold text-(--color-text-primary) tabular-nums tracking-[-0.01em]">{{ usdFormatter.format(estimate.inputCost) }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11.5px] text-(--color-text-secondary) font-normal">Max output cost</span>
              <span class="text-[11.5px] font-semibold text-(--color-text-primary) tabular-nums tracking-[-0.01em]">
                {{ usdFormatter.format(estimate.projectedOutputCost) }}
              </span>
            </div>
            <div
              v-if="estimate.projectedReasoningTokens > 0 || estimate.projectedReasoningCost > 0"
              class="flex items-center justify-between gap-3"
            >
              <span class="text-[11.5px] text-(--color-text-secondary) font-normal">Reasoning budget</span>
              <span class="text-[11.5px] font-semibold text-(--color-text-primary) tabular-nums tracking-[-0.01em]">
                {{ usdFormatter.format(estimate.projectedReasoningCost) }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3 mt-1 pt-2.5 border-t border-(--color-border-mid)">
              <span class="text-[11.5px] text-(--color-text-secondary) font-normal">Max total est.</span>
              <span class="text-[11.5px] font-semibold text-(--color-text-primary) tabular-nums tracking-[-0.01em]">
                {{ usdFormatter.format(estimate.projectedMaxTotalCost) }}
              </span>
            </div>
          </main>

          <footer v-if="estimateError" class="grid pt-2.5">
            <p class="text-[10.5px] leading-[1.4] text-(--color-danger-text) font-medium" role="alert">
              {{ estimateError }}
            </p>
          </footer>

          <div v-if="manualCompactionEnabled" class="flex justify-center pt-2.5 mt-2.5 border-t border-(--color-border-mid)">
            <button
              type="button"
              :class="COMPACT_BTN_CLASSES"
              :disabled="isCompacting"
              @click="emitManualCompaction"
            >
              {{ isCompacting ? 'Compacting...' : 'Compact Session' }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
