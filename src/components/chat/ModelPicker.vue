<script setup lang="ts">
import { Brain, ChevronDown, Eye, Search, Wrench, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const chat = useChatStore()
const s = useSettingsStore()
const { enabledModels } = storeToRefs(s)

const pickerOpen = ref(false)
const pickerSearch = ref('')

function openPicker() {
  pickerOpen.value = true
  pickerSearch.value = ''
}
function closePicker() { pickerOpen.value = false }
function selectModel(uid: string) {
  chat.setTabModel(chat.activeTab.id, uid)
  closePicker()
}

const groupedModels = computed(() => {
  const query = pickerSearch.value.toLowerCase().trim()
  const models = enabledModels.value.filter(m =>
    !query || m.name.toLowerCase().includes(query) || m.providerName.toLowerCase().includes(query),
  )
  const groups = new Map<string, { providerName: string; models: typeof models }>()
  for (const m of models) {
    if (!groups.has(m.providerId))
      groups.set(m.providerId, { providerName: m.providerName, models: [] })
    groups.get(m.providerId)!.models.push(m)
  }
  return [...groups.entries()].map(([id, g]) => ({ providerId: id, ...g }))
})

function onKeydownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closePicker()
}
window.addEventListener('keydown', onKeydownGlobal)
onUnmounted(() => window.removeEventListener('keydown', onKeydownGlobal))

const activeModelUid = computed(() => chat.activeTab.modelUid ?? s.activeModelUid)
const activeModel = computed(() => enabledModels.value.find(m => m.uid === activeModelUid.value) ?? enabledModels.value[0] ?? null)
const activeLabel = computed(() => activeModel.value?.name ?? 'No model')
</script>

<template>
  <div class="picker-wrap">
    <!-- Trigger button -->
    <button
      class="model-btn"
      :class="{ 'model-btn--open': pickerOpen }"
      aria-label="Select model"
      @click="openPicker"
    >
      <Zap v-if="!activeModel" :size="13" :stroke-width="2.5" class="model-btn-zap" />
      <span class="model-name">{{ activeLabel }}</span>
      <ChevronDown :size="13" :stroke-width="2.5" class="model-chevron" :class="{ 'model-chevron--open': pickerOpen }" />
    </button>

    <!-- Dropdown -->
    <Transition name="picker">
      <div v-if="pickerOpen" class="picker-dropdown">
        <!-- Header toolbar -->
        <div class="picker-toolbar">
          <div class="picker-search-wrap">
            <Search :size="13" :stroke-width="2" class="picker-search-icon" />
            <input
              v-model="pickerSearch"
              class="picker-search"
              placeholder="Search models…"
              autofocus
            >
          </div>
        </div>

        <!-- Empty states -->
        <div v-if="enabledModels.length === 0" class="picker-empty">
          <span class="picker-empty-icon">⚡</span>
          <p class="picker-empty-title">
            No models available
          </p>
          <p class="picker-empty-hint">
            Open Settings → Providers and add a provider key.
          </p>
        </div>

        <div v-else-if="groupedModels.length === 0" class="picker-empty">
          <p class="picker-empty-title">
            No results for "{{ pickerSearch }}"
          </p>
        </div>

        <!-- Model groups -->
        <div v-else class="picker-groups">
          <div v-for="group in groupedModels" :key="group.providerId" class="picker-group">
            <span class="picker-group-header">{{ group.providerName }}</span>

            <button
              v-for="m in group.models"
              :key="m.uid"
              class="picker-model-row"
              :class="{ 'picker-model-row--active': m.uid === activeModel?.uid }"
              @click="selectModel(m.uid)"
            >
              <!-- Active indicator dot -->
              <span class="active-dot" :class="{ 'active-dot--visible': m.uid === activeModel?.uid }" />

              <!-- Model name -->
              <span class="picker-model-name">{{ m.name }}</span>

              <!-- Capability icon pills with tooltips -->
              <div class="picker-caps">
                <span v-if="(m as any).free" class="cap-badge cap-badge--free">Free</span>

                <span v-if="m.supportsThinking" class="cap-icon-wrap" data-tooltip="Extended thinking">
                  <Brain :size="11" :stroke-width="2" class="cap-icon cap-icon--thinking" />
                </span>

                <span v-if="m.supportsToolCalls" class="cap-icon-wrap" data-tooltip="Tool use">
                  <Wrench :size="11" :stroke-width="2" class="cap-icon cap-icon--tools" />
                </span>

                <span v-if="m.supportsAttachments" class="cap-icon-wrap" data-tooltip="Vision & files">
                  <Eye :size="11" :stroke-width="2" class="cap-icon cap-icon--vision" />
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="pickerOpen" class="global-backdrop" @click="closePicker" />
  </div>
</template>

<style scoped>
/* ─── Wrapper ─────────────────────────────────────────── */
.picker-wrap {
  position: relative;
}

/* ─── Trigger button ──────────────────────────────────── */
.model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding-inline: 10px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
  max-width: 260px;
}

.model-btn:hover,
.model-btn--open {
  background: var(--color-bg-hover);
  border-color: var(--color-border-subtle);
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
  transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.model-chevron--open {
  transform: rotate(180deg);
}

/* ─── Dropdown shell ──────────────────────────────────── */
.picker-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  max-height: 300px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 10px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 24px 56px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: visible;
  z-index: 10000;
}

/* Re-clip only the top corners on toolbar */
.picker-toolbar {
  border-radius: 9px 9px 0 0; /* Adjusted to fit the 10px parent */
  overflow: hidden;
}

/* ─── Toolbar row ─────────────────────────────────────── */
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
  background: color-mix(in srgb, var(--color-bg-card) 70%, transparent);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 12.5px;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
  box-sizing: border-box;
}

.picker-search:focus {
  border-color: var(--color-accent-dim);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.picker-search::placeholder {
  color: var(--color-text-tertiary);
}

/* ─── Groups & scrollable list ───────────────────────── */
.picker-groups {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding: 6px 0 8px; /* Slightly more bottom padding since legend is gone */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-mid) transparent;
}

.picker-groups::-webkit-scrollbar {
  width: 4px;
}

.picker-groups::-webkit-scrollbar-track {
  background: transparent;
}

.picker-groups::-webkit-scrollbar-thumb {
  background: var(--color-border-mid);
  border-radius: 9999px;
}

.picker-group {
  margin-bottom: 2px;
}

.picker-group-header {
  display: block;
  padding: 10px 16px 5px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  user-select: none;
}

/* ─── Model row ───────────────────────────────────────── */
.picker-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: 34px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition:
    background 90ms ease,
    border-color 90ms ease,
    color 90ms ease;
  box-sizing: border-box;
}

.picker-model-row:hover {
  background: var(--color-bg-hover);
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

/* Active indicator dot */
.active-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--color-accent-bright);
  flex-shrink: 0;
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.active-dot--visible {
  opacity: 1;
  transform: scale(1);
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

/* ─── Capability area ─────────────────────────────────── */
.picker-caps {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* "Free" text badge */
.cap-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 2px 7px;
  border-radius: 5px;
  line-height: 1.4;
  white-space: nowrap;
}

.cap-badge--free {
  color: var(--color-text-tertiary);
  background: transparent;
  border: 1px solid var(--color-border-mid);
}

/* Icon wrapper */
.cap-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  cursor: default;
  transition: background 100ms ease;
}

.cap-icon-wrap:hover {
  background: var(--color-bg-hover);
}

/* Custom tooltip text bubble */
.cap-icon-wrap::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 7px);
  right: -6px;
  transform: translateY(4px);
  white-space: nowrap;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 4px 9px;
  border-radius: 7px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 1px 3px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  z-index: 10001;
}

/* Tooltip caret */
.cap-icon-wrap::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  border: 5px solid transparent;
  border-top-color: var(--color-border-mid);
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  z-index: 10001;
}

.cap-icon-wrap:hover::after {
  opacity: 1;
  transform: translateY(0);
}

.cap-icon-wrap:hover::before {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  border-top-color: var(--color-border-mid);
}

/* Icon colors */
.cap-icon {
  display: block;
}

.cap-icon--thinking {
  color: var(--color-accent-text, #a78bfa);
}
.cap-icon--tools {
  color: var(--color-success-text, #6ee7b7);
}
.cap-icon--vision {
  color: var(--color-info-text, #7dd3fc);
}

/* ─── Empty states ────────────────────────────────────── */
.picker-empty {
  padding: 36px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.picker-empty-icon {
  font-size: 24px;
  line-height: 1;
  margin-bottom: 4px;
  opacity: 0.5;
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

/* ─── Backdrop ────────────────────────────────────────── */
.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

/* ─── Transition ──────────────────────────────────────── */
.picker-enter-active,
.picker-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.97);
}
</style>
