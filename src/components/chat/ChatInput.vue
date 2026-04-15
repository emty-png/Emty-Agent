<script setup lang="ts">
import { AudioLines, ChevronDown, Plus, Search, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{ send: [value: string] }>()

const s = useSettingsStore()
const { enabledModels, activeModel } = storeToRefs(s)

// ── input state ───────────────────────────────────────────────────────────────
const text = ref('')
const focused = ref(false)

function submit() {
  if (!text.value.trim())
    return
  emit('send', text.value)
  text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

// ── model picker ──────────────────────────────────────────────────────────────
const pickerOpen = ref(false)
const pickerSearch = ref('')

function openPicker() {
  pickerOpen.value = true
  pickerSearch.value = ''
}
function closePicker() { pickerOpen.value = false }

function selectModel(uid: string) {
  s.setActiveModel(uid)
  closePicker()
}

// Group enabled models by provider, filtered by search
const groupedModels = computed(() => {
  const query = pickerSearch.value.toLowerCase().trim()
  const models = enabledModels.value.filter(m =>
    !query || m.name.toLowerCase().includes(query) || m.providerName.toLowerCase().includes(query),
  )
  const groups = new Map<string, { providerName: string; models: typeof models }>()
  for (const m of models) {
    if (!groups.has(m.providerId)) {
      groups.set(m.providerId, { providerName: m.providerName, models: [] })
    }
    groups.get(m.providerId)!.models.push(m)
  }
  return [...groups.entries()].map(([id, g]) => ({ providerId: id, ...g }))
})

// Close on click outside
function onBackdropClick() { closePicker() }

// Close on Escape
function onKeydownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape' && pickerOpen.value)
    closePicker()
}
window.addEventListener('keydown', onKeydownGlobal)
onUnmounted(() => window.removeEventListener('keydown', onKeydownGlobal))

// Active model display label
const activeLabel = computed(() => {
  if (!activeModel.value)
    return 'No model'
  return activeModel.value.name
})

const activeBadge = computed(() => {
  if (!activeModel.value)
    return ''
  return activeModel.value.providerName
})
</script>

<template>
  <div class="input-shell" :class="[{ 'input-shell--focused': focused }]">
    <!-- ── textarea ───────────────────────────────────────────────────── -->
    <textarea
      v-model="text"
      class="input-field"
      placeholder="Type / for skills"
      rows="1"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onKeydown"
      @input="onInput"
    />

    <!-- ── toolbar ────────────────────────────────────────────────────── -->
    <div class="input-toolbar">
      <button class="tool-btn" aria-label="Add attachment">
        <Plus :size="15" :stroke-width="1.7" />
      </button>

      <div class="tool-spacer" />

      <!-- model picker trigger -->
      <div class="picker-wrap">
        <button
          class="model-btn"
          :class="{ 'model-btn--open': pickerOpen }"
          aria-label="Select model"
          @click="openPicker"
        >
          <Zap
            v-if="!activeModel"
            :size="12"
            :stroke-width="1.8"
            class="model-btn-icon model-btn-icon--empty"
          />
          <span class="model-name">{{ activeLabel }}</span>
          <span v-if="activeBadge" class="model-badge">{{ activeBadge }}</span>
          <ChevronDown
            :size="12"
            :stroke-width="2"
            class="model-chevron"
            :class="{ 'model-chevron--open': pickerOpen }"
          />
        </button>

        <!-- dropdown -->
        <Transition name="picker">
          <div v-if="pickerOpen" class="picker-dropdown">
            <!-- search -->
            <div class="picker-search-wrap">
              <Search :size="12" :stroke-width="1.8" class="picker-search-icon" />
              <input
                v-model="pickerSearch"
                class="picker-search"
                placeholder="Search models…"
                autofocus
              >
            </div>

            <!-- no models at all -->
            <div v-if="enabledModels.length === 0" class="picker-empty">
              <p>No models available.</p>
              <p class="picker-empty-hint">
                Open Settings → Providers and test a connection to discover models.
              </p>
            </div>

            <!-- no search results -->
            <div v-else-if="groupedModels.length === 0" class="picker-empty">
              <p>No models match "{{ pickerSearch }}"</p>
            </div>

            <!-- groups -->
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
                  <span class="picker-model-name">{{ m.name }}</span>
                  <span v-if="m.supportsThinking" class="picker-thinking-tag">
                    thinking
                  </span>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- voice -->
      <button class="tool-btn tool-btn--voice" aria-label="Voice input">
        <AudioLines :size="15" :stroke-width="1.7" />
      </button>
    </div>

    <!-- backdrop (closes picker) -->
    <Teleport to="body">
      <div v-if="pickerOpen" class="picker-backdrop" @click="onBackdropClick" />
    </Teleport>
  </div>
</template>

<style scoped>
/* ── shell ────────────────────────────────────────────────────────────────── */
.input-shell {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  transition: border-color 120ms ease;
  overflow: visible; /* allow dropdown to overflow */
}

.input-shell--focused {
  border-color: var(--color-border-bright);
}

/* ── textarea ─────────────────────────────────────────────────────────────── */
.input-field {
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  padding: 12px 14px 4px;
  background: transparent;
  border: none;
  resize: none;
  color: var(--color-text-primary);
  font-size: 13.5px;
  font-family: inherit;
  line-height: 1.55;
  caret-color: var(--color-ember-bright);
  outline: none;
}
.input-field::placeholder {
  color: var(--color-text-tertiary);
}

/* ── toolbar ──────────────────────────────────────────────────────────────── */
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 6px;
  position: relative;
}
.tool-spacer {
  flex: 1;
}

/* ── generic tool button ──────────────────────────────────────────────────── */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.tool-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}
.tool-btn--voice {
  color: var(--color-text-secondary);
}

/* ── picker wrap + trigger ────────────────────────────────────────────────── */
.picker-wrap {
  position: relative;
}

.model-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-inline: 8px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease;
  max-width: 220px;
}
.model-btn:hover,
.model-btn--open {
  background: var(--color-bg-hover);
}

.model-btn-icon--empty {
  color: var(--color-text-tertiary);
}

.model-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.model-badge {
  font-size: 11px;
  font-weight: 400;
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.model-chevron {
  color: var(--color-text-tertiary);
  margin-left: 1px;
  flex-shrink: 0;
  transition: transform 150ms ease;
}
.model-chevron--open {
  transform: rotate(180deg);
}

/* ── dropdown ─────────────────────────────────────────────────────────────── */
.picker-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  width: 280px;
  max-height: 340px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
}

/* ── search ───────────────────────────────────────────────────────────────── */
.picker-search-wrap {
  position: relative;
  padding: 8px 8px 6px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.picker-search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-3px);
  color: var(--color-text-tertiary);
  pointer-events: none;
}
.picker-search {
  width: 100%;
  height: 30px;
  padding-left: 28px;
  padding-right: 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12.5px;
  outline: none;
  transition: border-color 120ms ease;
}
.picker-search:focus {
  border-color: var(--color-ember-dim);
}
.picker-search::placeholder {
  color: var(--color-text-tertiary);
}

/* ── groups ───────────────────────────────────────────────────────────────── */
.picker-groups {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0 6px;
}

.picker-group {
  margin-bottom: 2px;
}

.picker-group-header {
  display: block;
  padding: 8px 12px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.picker-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding-inline: 12px 10px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition:
    background 100ms ease,
    color 100ms ease;
  gap: 8px;
}
.picker-model-row:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.picker-model-row--active {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}
.picker-model-row--active:hover {
  background: var(--color-ember-glow);
}

.picker-model-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-thinking-tag {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
  border: 1px solid var(--color-ember-dim);
  flex-shrink: 0;
}

/* ── empty ────────────────────────────────────────────────────────────────── */
.picker-empty {
  padding: 20px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
.picker-empty-hint {
  font-size: 11.5px;
  margin-top: 4px;
  opacity: 0.7;
}

/* ── transition ───────────────────────────────────────────────────────────── */
.picker-enter-active,
.picker-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}

/* ── backdrop ─────────────────────────────────────────────────────────────── */
</style>

<style>
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
</style>
