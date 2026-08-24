<script setup lang="ts">
import type { DiscoveredModel, ThinkingEffort } from '@/stores/settings/types'
import { Brain, ChevronDown, Eye, Search, Wrench, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const chat = useChatStore()
const s = useSettingsStore()
const { enabledModels } = storeToRefs(s)

const pickerOpen = ref(false)
const pickerSearch = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  pickerOpen.value = true
  pickerSearch.value = ''
  nextTick(() => searchInputRef.value?.focus())
}

function closePicker() {
  pickerOpen.value = false
}

function selectModel(uid: string) {
  chat.setTabModel(chat.activeTab.id, uid)
  closePicker()
}

const groupedModels = computed(() => {
  const query = pickerSearch.value.toLowerCase().trim()
  const models = enabledModels.value.filter(
    m => !query
      || m.name.toLowerCase().includes(query)
      || m.providerName.toLowerCase().includes(query),
  )
  const groups = new Map<string, { providerName: string; models: typeof models }>()
  for (const m of models) {
    if (!groups.has(m.providerId))
      groups.set(m.providerId, { providerName: m.providerName, models: [] })
    groups.get(m.providerId)!.models.push(m)
  }
  return [...groups.entries()].map(([id, g]) => ({ providerId: id, ...g }))
})

const activeModelUid = computed(() => chat.activeTab.modelUid ?? s.agent.defaultModelUid ?? s.activeModelUid)
const activeModel = computed(
  () => enabledModels.value.find(m => m.uid === activeModelUid.value)
    ?? enabledModels.value[0]
    ?? null,
)
const activeLabel = computed(() => activeModel.value?.name ?? 'No model')

// ── Hover popup for thinking level (selected model only) ────────────────────
const hoveredUid = ref<string | null>(null)
const popupHovered = ref(false)
let hoverTimeout: ReturnType<typeof setTimeout> | null = null

function onRowEnter(uid: string) {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout)
    hoverTimeout = null
  }
  hoveredUid.value = uid
}
function onRowLeave() {
  hoverTimeout = setTimeout(() => {
    if (!popupHovered.value)
      hoveredUid.value = null
  }, 150)
}
function onPopupEnter() {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout)
    hoverTimeout = null
  }
  popupHovered.value = true
  if (activeModel.value)
    hoveredUid.value = activeModel.value.uid
}
function onPopupLeave() {
  popupHovered.value = false
  hoveredUid.value = null
}

watch(pickerOpen, open => {
  if (!open) {
    hoveredUid.value = null
    popupHovered.value = false
    if (hoverTimeout) {
      clearTimeout(hoverTimeout)
      hoverTimeout = null
    }
  }
})

function getEffortOption(model: DiscoveredModel): { type: 'effort'; values: string[] } | null {
  return model.reasoningOptions?.find((o): o is { type: 'effort'; values: string[] } => o.type === 'effort') ?? null
}
function getBudgetOption(model: DiscoveredModel): { type: 'budget_tokens'; min: number } | null {
  return model.reasoningOptions?.find((o): o is { type: 'budget_tokens'; min: number } => o.type === 'budget_tokens') ?? null
}
function getEffortLevels(model: DiscoveredModel): ThinkingEffort[] {
  return s.getEffectiveThinkingLevels(model)
}
function shouldShowEffort(model: DiscoveredModel): boolean {
  if (!model.enabled)
    return false
  const levels = getEffortLevels(model)
  if (levels.length === 1 && levels[0] === 'off' && !model.supportsThinking)
    return false
  return true
}
function getEffortLabel(model: DiscoveredModel, lvl: ThinkingEffort): string {
  if (lvl === 'off')
    return 'Off'
  if (lvl === 'xhigh')
    return 'XHigh'
  if (lvl === 'max')
    return 'Max'
  const effort = getEffortOption(model)
  if (effort) {
    const hasMax = effort.values.includes('max')
    if (lvl === 'high' && hasMax)
      return 'Max'
    return lvl === 'low' ? 'Low' : lvl === 'medium' ? 'Med' : 'High'
  }
  const budget = getBudgetOption(model)
  if (budget) {
    const minBudget = budget.min
    if (lvl === 'low')
      return `${Math.round(minBudget / 1024)}K`
    if (lvl === 'medium')
      return `${Math.round(minBudget * 10 / 1024)}K`
    if (lvl === 'high')
      return `${Math.round(minBudget * 32 / 1024)}K`
    if (lvl === 'xhigh')
      return `${Math.round(minBudget * 48 / 1024)}K`
    if (lvl === 'max')
      return `${Math.round(minBudget * 100 / 1024)}K`
  }
  return lvl === 'low' ? 'Low' : lvl === 'medium' ? 'Med' : 'High'
}

const showThinkingPopup = computed(() =>
  pickerOpen.value
  && !!activeModel.value
  && shouldShowEffort(activeModel.value)
  && (hoveredUid.value === activeModel.value.uid || popupHovered.value),
)

function onKeydownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closePicker()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydownGlobal)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownGlobal)
})

const modelBtnClasses = computed(() => {
  const shared = [
    'flex items-center gap-1.5 h-[30px] pl-2.5 pr-2 border rounded-(--radius-md)',
    'cursor-pointer max-w-[260px]',
    '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]',
    'active:scale-[0.97] active:duration-[80ms]',
    'hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)',
  ].join(' ')

  return pickerOpen.value
    ? `${shared} bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg)`
    : `${shared} bg-transparent border-transparent`
})

const chevronClasses = computed(() => {
  const base = 'text-(--color-text-tertiary) shrink-0 [transition:transform_200ms_cubic-bezier(0.4,0,0.2,1)]'
  return pickerOpen.value ? `${base} rotate-180` : base
})

function modelRowClasses(isActive: boolean) {
  const base = [
    'flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 my-[2px] h-[32px] px-2 border',
    'rounded-(--radius-sm) text-left box-border cursor-pointer',
    '[transition:background_100ms_cubic-bezier(0.4,0,0.2,1),border-color_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]',
  ].join(' ')

  if (isActive) {
    return `${base} bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary)`
  }
  return `${base} bg-transparent border-transparent text-(--color-text-secondary) `
    + 'hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'
}
</script>

<template>
  <div class="relative">
    <button
      :class="modelBtnClasses"
      aria-label="Select model"
      @click="openPicker"
    >
      <Zap v-if="!activeModel" :size="13" :stroke-width="2.5" class="text-(--color-text-tertiary) shrink-0" />
      <span class="text-[13px] font-semibold text-(--color-text-primary) tracking-[0.01em] whitespace-nowrap overflow-hidden text-ellipsis shrink">{{ activeLabel }}</span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        :class="chevronClasses"
      />
    </button>

    <!-- Above trigger to avoid viewport bottom overflow -->
    <div class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10000]">
      <div class="relative">
        <Transition
          enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
          enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
          enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
          leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
          leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
        >
          <div
            v-if="pickerOpen"
            class="w-[300px] max-h-[300px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
          >
            <div class="flex items-center gap-1.5 px-2.5 pt-2.5 pb-2 border-b border-(--color-border-mid) shrink-0">
              <div class="relative flex-1">
                <Search :size="13" :stroke-width="2" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none" />
                <input
                  ref="searchInputRef"
                  v-model="pickerSearch"
                  class="w-full h-8 pl-[30px] pr-2.5 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-md) text-(--color-text-primary) text-[12.5px] outline-none box-border [transition:border-color_150ms_cubic-bezier(0.4,0,0.2,1),box-shadow_150ms_cubic-bezier(0.4,0,0.2,1)] placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:shadow-[0_0_0_2px_var(--color-accent-muted)]"
                  placeholder="Search models…"
                >
              </div>
            </div>

            <div v-if="enabledModels.length === 0" class="px-5 py-8 text-center flex flex-col items-center gap-1.5">
              <span class="text-(--color-text-dim) mb-1 opacity-60 flex">
                <Zap :size="22" :stroke-width="1.5" />
              </span>
              <p class="m-0 text-[13px] font-medium text-(--color-text-secondary)">
                No models available
              </p>
              <p class="m-0 text-xs text-(--color-text-tertiary) leading-[1.6]">
                Open Settings → Providers and add a provider key.
              </p>
            </div>

            <div v-else-if="groupedModels.length === 0" class="px-5 py-8 text-center flex flex-col items-center gap-1.5">
              <p class="m-0 text-[13px] font-medium text-(--color-text-secondary)">
                No results for "{{ pickerSearch }}"
              </p>
            </div>

            <div
              v-else
              class="overflow-y-auto overflow-x-hidden flex-1 pt-1.5 pb-2 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-md)"
            >
              <div
                v-for="group in groupedModels"
                :key="group.providerId"
                class="mb-0.5"
              >
                <span class="block px-4 pt-2.5 pb-[5px] text-[11px] font-bold tracking-[0.08em] uppercase text-(--color-text-dim) select-none">{{ group.providerName }}</span>

                <button
                  v-for="m in group.models"
                  :key="m.uid"
                  :class="modelRowClasses(m.uid === activeModel?.uid)"
                  @click="selectModel(m.uid)"
                  @mouseenter="onRowEnter(m.uid)"
                  @mouseleave="onRowLeave"
                >
                  <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tracking-[0.01em]">{{ m.name }}</span>

                  <div class="flex items-center gap-1 shrink-0">
                    <span
                      v-if="m.supportsThinking"
                      class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                    >
                      <Brain :size="11" :stroke-width="2" class="block text-(--color-accent-text)" />
                    </span>

                    <span
                      v-if="m.supportsToolCalls"
                      class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                    >
                      <Wrench :size="11" :stroke-width="2" class="block text-(--color-success-text)" />
                    </span>

                    <span
                      v-if="m.supportsAttachments"
                      class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                    >
                      <Eye :size="11" :stroke-width="2" class="block text-(--color-info-text)" />
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </Transition>
        <Transition
          enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-left"
          enter-from-class="opacity-0 [transform:translateX(8px)_scale(0.96)]"
          enter-to-class="opacity-100 [transform:translateX(0)_scale(1)]"
          leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-left"
          leave-from-class="opacity-100 [transform:translateX(0)_scale(1)]"
          leave-to-class="opacity-0 [transform:translateX(8px)_scale(0.96)]"
        >
          <div
            v-if="showThinkingPopup && activeModel"
            class="absolute left-[calc(100%+8px)] top-0 w-[148px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] p-1 flex flex-col gap-0.5 before:absolute before:right-full before:inset-y-0 before:w-2 before:content-['']"
            role="menu"
            @mouseenter="onPopupEnter"
            @mouseleave="onPopupLeave"
          >
            <button
              v-for="lvl in getEffortLevels(activeModel)"
              :key="lvl"
              class="flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[13px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100"
              :class="activeModel.thinkingEffort === lvl
                ? 'bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary)'
                : 'bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'"
              @click="s.setModelThinking(activeModel.uid, lvl)"
            >
              <Brain :size="13" :stroke-width="2" :class="activeModel.thinkingEffort === lvl ? 'text-(--color-accent-text)' : 'text-(--color-text-tertiary)'" />
              <span>{{ getEffortLabel(activeModel, lvl) }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <div v-if="pickerOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="closePicker" />
  </div>
</template>
