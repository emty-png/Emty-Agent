<script setup lang="ts">
import { Brain, ChevronDown, Eye, Search, Wrench, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const chat = useChatStore()
const s = useSettingsStore()
const { enabledModels } = storeToRefs(s)

const pickerOpen = ref(false)
const pickerSearch = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const pickerPos = ref({ x: 0, y: 0 })

function updatePickerPos() {
  if (!triggerRef.value || !pickerOpen.value)
    return
  const rect = triggerRef.value.getBoundingClientRect()
  pickerPos.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
  }
}

function openPicker() {
  pickerOpen.value = true
  pickerSearch.value = ''
  updatePickerPos()
  // autofocus via nextTick — more reliable than the `autofocus` attr in Tauri
  nextTick(() => searchInputRef.value?.focus())
}
function closePicker() {
  pickerOpen.value = false
  hideTooltip()
}
function selectModel(uid: string) {
  chat.setTabModel(chat.activeTab.id, uid)
  closePicker()
}

// ── grouped + filtered models ─────────────────────────────────────────────────
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

// ── active model ──────────────────────────────────────────────────────────────
const activeModelUid = computed(() => chat.activeTab.modelUid ?? s.activeModelUid)
const activeModel = computed(
  () => enabledModels.value.find(m => m.uid === activeModelUid.value)
    ?? enabledModels.value[0]
    ?? null,
)
const activeLabel = computed(() => activeModel.value?.name ?? 'No model')

// ── global close ──────────────────────────────────────────────────────────────
function onKeydownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closePicker()
}
window.addEventListener('keydown', onKeydownGlobal)
window.addEventListener('resize', updatePickerPos)
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownGlobal)
  window.removeEventListener('resize', updatePickerPos)
})

// ── Teleported tooltip ────────────────────────────────────────────────────────
// Using Teleport because .picker-groups has overflow-y: auto which clips
// CSS ::after tooltips — this renders the tooltip at the body level instead.
interface TooltipState {
  text: string
  x: number
  y: number
  visible: boolean
}
const tooltip = ref<TooltipState>({ text: '', x: 0, y: 0, visible: false })
let hideTimer: ReturnType<typeof setTimeout> | null = null

function showTooltip(e: MouseEvent, text: string) {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tooltip.value = {
    text,
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
    visible: true,
  }
}

function hideTooltip() {
  // Small delay so the tooltip doesn't flash when moving between icons
  hideTimer = setTimeout(() => {
    tooltip.value.visible = false
  }, 80)
}
</script>

<template>
  <div class="picker-wrap">
    <!-- ── Trigger ──────────────────────────────────────────────────────────── -->
    <div ref="triggerRef" class="trigger-tooltip-wrap">
      <button
        class="model-btn"
        :class="{ 'model-btn--open': pickerOpen }"
        aria-label="Select model"
        @click="openPicker"
        @mouseenter="showTooltip($event, 'Change model')"
        @mouseleave="hideTooltip"
      >
        <Zap v-if="!activeModel" :size="13" :stroke-width="2.5" class="model-btn-zap" />
        <span class="model-name">{{ activeLabel }}</span>
        <ChevronDown
          :size="13"
          :stroke-width="2.5"
          class="model-chevron"
          :class="{ 'model-chevron--open': pickerOpen }"
        />
      </button>
    </div>

    <!-- ── Dropdown ────────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="picker">
        <div
          v-if="pickerOpen"
          class="picker-dropdown"
          :style="{ left: `${pickerPos.x}px`, top: `${pickerPos.y}px` }"
        >
          <!-- Search toolbar -->
          <div class="picker-toolbar">
            <div class="picker-search-wrap">
              <Search :size="13" :stroke-width="2" class="picker-search-icon" />
              <input
                ref="searchInputRef"
                v-model="pickerSearch"
                class="picker-search"
                placeholder="Search models…"
              >
            </div>
          </div>

          <!-- Empty: no providers configured -->
          <div v-if="enabledModels.length === 0" class="picker-empty">
            <span class="picker-empty-icon">
              <Zap :size="22" :stroke-width="1.5" />
            </span>
            <p class="picker-empty-title">
              No models available
            </p>
            <p class="picker-empty-hint">
              Open Settings → Providers and add a provider key.
            </p>
          </div>

          <!-- Empty: no search results -->
          <div v-else-if="groupedModels.length === 0" class="picker-empty">
            <p class="picker-empty-title">
              No results for "{{ pickerSearch }}"
            </p>
          </div>

          <!-- Model groups -->
          <div v-else class="picker-groups">
            <div
              v-for="group in groupedModels"
              :key="group.providerId"
              class="picker-group"
            >
              <span class="picker-group-header">{{ group.providerName }}</span>

              <button
                v-for="m in group.models"
                :key="m.uid"
                class="picker-model-row"
                :class="{ 'picker-model-row--active': m.uid === activeModel?.uid }"
                @click="selectModel(m.uid)"
              >
                <!-- Model name -->
                <span class="picker-model-name">{{ m.name }}</span>

                <!-- Capability badges -->
                <div class="picker-caps">
                  <span v-if="(m as any).free" class="cap-badge cap-badge--free">Free</span>

                  <span
                    v-if="m.supportsThinking"
                    class="cap-icon-wrap"
                    @mouseenter="showTooltip($event, 'Extended thinking')"
                    @mouseleave="hideTooltip"
                  >
                    <Brain :size="11" :stroke-width="2" class="cap-icon cap-icon--thinking" />
                  </span>

                  <span
                    v-if="m.supportsToolCalls"
                    class="cap-icon-wrap"
                    @mouseenter="showTooltip($event, 'Tool use')"
                    @mouseleave="hideTooltip"
                  >
                    <Wrench :size="11" :stroke-width="2" class="cap-icon cap-icon--tools" />
                  </span>

                  <span
                    v-if="m.supportsAttachments"
                    class="cap-icon-wrap"
                    @mouseenter="showTooltip($event, 'Vision & files')"
                    @mouseleave="hideTooltip"
                  >
                    <Eye :size="11" :stroke-width="2" class="cap-icon cap-icon--vision" />
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Backdrop -->
    <div v-if="pickerOpen" class="global-backdrop" @click="closePicker" />

    <!-- ── Teleported tooltip ───────────────────────────────────────────────
         Rendered at <body> so it is never clipped by picker-groups overflow.
         Positioned via fixed coords captured from the hovered element's rect.
    ──────────────────────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        class="float-tooltip"
        :class="{ 'float-tooltip--visible': tooltip.visible }"
        :style="{
          left: `${tooltip.x}px`,
          top: `${tooltip.y}px`,
        }"
      >
        {{ tooltip.text }}
        <span class="float-tooltip-caret" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/*
  Design system (matches component library + ServicesDropdown):
  ─────────────────────────────────────────────────────────────
  Border radius  → xs=3  sm=4  md=6  lg=8  xl=12  pill=9999
  Ease out expo  → cubic-bezier(0.16, 1, 0.3, 1)    snappy open
  Ease in expo   → cubic-bezier(0.7,  0, 0.84, 0)   fast close
  Ease smooth    → cubic-bezier(0.4,  0, 0.2,  1)   state change
  Ease spring    → cubic-bezier(0.34, 1.56, 0.64, 1) pop/bounce

  Durations → instant 80ms  micro 100ms  fast 150ms  normal 220ms
*/

/* ── Wrapper ──────────────────────────────────────────────────────────────── */
.picker-wrap {
  position: relative;
}

/* ── Trigger button ───────────────────────────────────────────────────────── */
.model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding-inline: 10px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  max-width: 260px;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.model-btn:hover,
.model-btn--open {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
}

.model-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.model-btn-zap {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.model-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}

.model-chevron {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.model-chevron--open {
  transform: rotate(180deg);
}

/* ── Dropdown shell ───────────────────────────────────────────────────────── */
.picker-dropdown {
  position: fixed;
  transform: translate(-50%, -100%);
  width: 300px;
  max-height: 300px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
  will-change: transform, opacity;
}

/* ── Search toolbar ───────────────────────────────────────────────────────── */
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.picker-search-wrap {
  position: relative;
  flex: 1;
}

.picker-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.picker-search {
  width: 100%;
  height: 32px;
  padding-left: 30px;
  padding-right: 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.picker-search::placeholder {
  color: var(--color-text-dim);
}

.picker-search:focus {
  border-color: var(--color-accent);
  box-shadow:
    0 0 0 3px var(--color-accent-muted),
    0 0 0 1px var(--color-accent-muted-plus);
}

/* ── Groups + scrollable list ─────────────────────────────────────────────── */
.picker-groups {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding: 6px 0 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.picker-groups::-webkit-scrollbar {
  width: 4px;
}
.picker-groups::-webkit-scrollbar-track {
  background: transparent;
}
.picker-groups::-webkit-scrollbar-thumb {
  background: var(--color-border-bright);
  border-radius: 9999px;
}

.picker-group {
  margin-bottom: 2px;
}

.picker-group-header {
  display: block;
  padding: 10px 16px 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  user-select: none;
}

/* ── Model row ────────────────────────────────────────────────────────────── */
.picker-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: 34px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.picker-model-row:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

.picker-model-row--active {
  background: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.picker-model-row--active:hover {
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  border-color: var(--color-accent);
}

/* Model name */
.picker-model-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

/* ── Capability badges ────────────────────────────────────────────────────── */
.picker-caps {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.cap-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  line-height: 1.4;
  white-space: nowrap;
}

.cap-badge--free {
  color: var(--color-text-dim);
  background: transparent;
  border: 1px solid var(--color-border-mid);
}

/* Icon wrapper — no ::after tooltip; handled by Teleport instead */
.cap-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  cursor: default;
  transition: background 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.cap-icon-wrap:hover {
  background: var(--color-state-hover);
}

.cap-icon {
  display: block;
}
.cap-icon--thinking {
  color: var(--color-accent-text);
}
.cap-icon--tools {
  color: var(--color-success-text);
}
.cap-icon--vision {
  color: var(--color-info-text);
}

/* ── Teleported tooltip ───────────────────────────────────────────────────── */
/* Rendered at body level — never clipped by overflow containers */
.float-tooltip {
  position: fixed;
  transform: translateX(-50%);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  color: var(--color-text-primary);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  pointer-events: none;
  z-index: 99999;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 1px 3px rgba(0, 0, 0, 0.2);

  /* Enter: invisible + shifted up 4px, drops into place */
  opacity: 0;
  margin-top: -4px;
  transition:
    opacity 140ms cubic-bezier(0.4, 0, 0.2, 1),
    margin-top 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.float-tooltip--visible {
  opacity: 1;
  margin-top: 0;
}

/* Upward caret at the top of the tooltip, pointing toward the hovered element above */
.float-tooltip-caret {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-bottom-color: var(--color-border-bright);
}

/* ── Empty states ─────────────────────────────────────────────────────────── */
.picker-empty {
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.picker-empty-icon {
  color: var(--color-text-dim);
  margin-bottom: 4px;
  opacity: 0.6;
  display: flex;
}

.picker-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.picker-empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

/* ── Backdrop ─────────────────────────────────────────────────────────────── */
.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

/* ── Transition ───────────────────────────────────────────────────────────── */
/*
  Opens from BOTTOM (picker appears above the trigger).
  → enter-from: shifted UP + slightly scaled down, transform-origin: bottom center.
  Enter: 220ms ease-out-expo (snappy)
  Leave: 160ms ease-in-expo  (fast, non-intrusive)
*/
.picker-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 100ms cubic-bezier(0.7, 0, 0.84, 0);
}

/* translate(-50%, -100%) must be preserved — it's the centering/anchoring transform */
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 8px)) scale(0.96);
  transform-origin: bottom center;
}

.picker-enter-to,
.picker-leave-from {
  transform: translate(-50%, -100%);
  transform-origin: bottom center;
}
</style>
