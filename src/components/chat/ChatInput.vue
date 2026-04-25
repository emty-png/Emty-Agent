<script setup lang="ts">
import type { ChatMode } from '@/utils/ai'
import { ArrowUp, Check, ChevronDown, Search, Square, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref } from 'vue'
import AtMentionDropdown from '@/components/chat/AtMentionDropdown.vue'
import QuestionOverlay from '@/components/chat/QuestionOverlay.vue'
import TodoOverlay from '@/components/chat/TodoOverlay.vue'
import { useAtMention } from '@/composables/useAtMention'
import { useChatStore } from '@/stores/chat'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { pendingBatch } from '@/utils/tools/questions'

const props = defineProps<{
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  send: [value: string, mode: ChatMode]
  stop: []
}>()

const s = useSettingsStore()
const { enabledModels, activeModel } = storeToRefs(s)

const project = useProjectStore()
const projectPath = computed(() => project.projectPath)

const chat = useChatStore()

// mode popup
const mode = ref<ChatMode>('build')
const modeOpen = ref(false)
const MODES = [{ value: 'build' as ChatMode, label: 'Build' }, { value: 'plan' as ChatMode, label: 'Plan' }]
function toggleModeMenu() { modeOpen.value = !modeOpen.value }
function closeModeMenu() { modeOpen.value = false }
function selectMode(m: ChatMode) {
  mode.value = m
  closeModeMenu()
}

// input state
const text = ref('')
const focused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// @ mention composable
const mention = useAtMention(textareaRef, text, projectPath)

function submit() {
  if (!text.value.trim() || props.isStreaming)
    return
  emit('send', text.value, mode.value)
  text.value = ''
  if (textareaRef.value)
    textareaRef.value.style.height = 'auto'
}

function onKeydown(e: KeyboardEvent) {
  if (mention.handleKeydown(e))
    return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  mention.handleInput(e)
}

// model picker
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
  if (e.key === 'Escape') {
    closePicker()
    closeModeMenu()
  }
}
window.addEventListener('keydown', onKeydownGlobal)
onUnmounted(() => window.removeEventListener('keydown', onKeydownGlobal))

const activeLabel = computed(() => activeModel.value?.name ?? 'No model')
const activeBadge = computed(() => activeModel.value?.providerName ?? '')
const canSend = computed(() => text.value.trim().length > 0 && !props.isStreaming)

// ── overlay priority: Questions > AtMention > Todos ───────────────────────────
const hasQuestions = computed(() => !!pendingBatch.value)
const hasTodos = computed(() => chat.activeTab.todos.length > 0)

/**
 * Show the todo panel when there are todos and nothing higher-priority is active.
 * Questions and the @ dropdown each suppress todos while they're open.
 */
const showTodos = computed(() => hasTodos.value && !hasQuestions.value && !mention.isOpen.value)

/**
 * The input shell flattens its top corners whenever ANY overlay is stacked above it.
 */
const inputShellFlat = computed(() => hasQuestions.value || mention.isOpen.value || hasTodos.value)
</script>

<template>
  <div class="chat-input-root">
    <!-- Priority 1: agent waiting for user answers -->
    <Transition name="overlay">
      <QuestionOverlay v-if="hasQuestions" />
    </Transition>

    <!-- Priority 2: user typing @ to link a file -->
    <Transition name="overlay">
      <AtMentionDropdown
        v-if="mention.isOpen.value && !hasQuestions"
        :entries="mention.filteredEntries.value"
        :selected-idx="mention.selectedIdx.value"
        :loading="mention.loading.value"
        :query="mention.atQuery.value"
        @select="mention.selectEntry($event)"
        @hover="mention.setSelectedIdx($event)"
        @close="mention.close()"
      />
    </Transition>

    <!-- Priority 3: live task progress (background — no exclusive ownership) -->
    <Transition name="overlay">
      <TodoOverlay v-if="showTodos" />
    </Transition>

    <div
      class="input-shell"
      :class="{
        'input-shell--focused': focused,
        'input-shell--flat-top': inputShellFlat,
      }"
    >
      <textarea
        ref="textareaRef"
        v-model="text"
        class="input-field"
        :placeholder="mode === 'plan' ? 'Describe what you want to plan\u2026' : 'Ask anything\u2026 (@ to link files)'"
        rows="1"
        :disabled="props.isStreaming"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="onKeydown"
        @input="onInput"
      />

      <div class="input-toolbar">
        <div class="mode-wrap">
          <button
            class="mode-trigger"
            :class="{ 'mode-trigger--plan': mode === 'plan', 'mode-trigger--open': modeOpen }"
            @click="toggleModeMenu"
          >
            <span class="mode-trigger-label">{{ mode === 'build' ? 'Build' : 'Plan' }}</span>
            <ChevronDown :size="11" :stroke-width="2.2" class="mode-trigger-chevron" :class="{ rotated: modeOpen }" />
          </button>
          <Transition name="popup">
            <div v-if="modeOpen" class="mode-popup">
              <button
                v-for="opt in MODES"
                :key="opt.value"
                class="mode-opt"
                :class="{ 'mode-opt--active': mode === opt.value }"
                @click="selectMode(opt.value)"
              >
                <span class="mode-opt-label">{{ opt.label }}</span>
                <Check v-if="mode === opt.value" :size="12" :stroke-width="2.5" class="mode-opt-check" />
              </button>
            </div>
          </Transition>
        </div>

        <div class="tool-spacer" />

        <div class="picker-wrap">
          <button class="model-btn" :class="{ 'model-btn--open': pickerOpen }" aria-label="Select model" @click="openPicker">
            <Zap v-if="!activeModel" :size="12" :stroke-width="1.8" class="model-btn-icon--empty" />
            <span class="model-name">{{ activeLabel }}</span>
            <span v-if="activeBadge" class="model-badge">{{ activeBadge }}</span>
            <ChevronDown :size="12" :stroke-width="2" class="model-chevron" :class="{ 'model-chevron--open': pickerOpen }" />
          </button>
          <Transition name="picker">
            <div v-if="pickerOpen" class="picker-dropdown">
              <div class="picker-search-wrap">
                <Search :size="12" :stroke-width="1.8" class="picker-search-icon" />
                <input v-model="pickerSearch" class="picker-search" placeholder="Search models\u2026" autofocus>
              </div>
              <div v-if="enabledModels.length === 0" class="picker-empty">
                <p>No models available.</p>
                <p class="picker-empty-hint">
                  Open Settings &rarr; Providers and test a connection.
                </p>
              </div>
              <div v-else-if="groupedModels.length === 0" class="picker-empty">
                <p>No models match "{{ pickerSearch }}"</p>
              </div>
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
                    <span v-if="m.supportsThinking" class="picker-cap-tag picker-cap-tag--thinking">thinking</span>
                    <span v-if="m.supportsToolCalls" class="picker-cap-tag picker-cap-tag--tools">tools</span>
                    <span v-if="m.supportsAttachments" class="picker-cap-tag picker-cap-tag--vision">vision</span>
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <button v-if="props.isStreaming" class="action-btn action-btn--stop" aria-label="Stop generation" @click="$emit('stop')">
          <Square :size="11" :stroke-width="0" style="fill: currentColor" />
        </button>
        <button
          v-else
          class="action-btn action-btn--send"
          :class="{ 'action-btn--send-active': canSend }"
          aria-label="Send message"
          :disabled="!canSend"
          @click="submit"
        >
          <ArrowUp :size="15" :stroke-width="2.2" />
        </button>
      </div>

      <Teleport to="body">
        <div v-if="modeOpen" class="global-backdrop" @click="closeModeMenu" />
        <div v-if="pickerOpen" class="global-backdrop" @click="closePicker" />
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.chat-input-root {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.overlay-enter-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.overlay-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.input-shell {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  transition: border-color 120ms ease;
  overflow: visible;
}
.input-shell--focused {
  border-color: var(--color-border-bright);
}
.input-shell--flat-top {
  border-radius: 0 0 12px 12px;
}

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
  caret-color: var(--color-accent-bright);
  outline: none;
}
.input-field::placeholder {
  color: var(--color-text-tertiary);
}
.input-field:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.input-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px 6px;
  position: relative;
}
.tool-spacer {
  flex: 1;
}

.mode-wrap {
  position: relative;
}
.mode-trigger {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding-inline: 8px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition:
    background 110ms ease,
    border-color 110ms ease;
}
.mode-trigger:hover {
  background: var(--color-bg-hover);
}
.mode-trigger--open {
  background: var(--color-bg-hover);
  border-color: var(--color-border-bright);
}
.mode-trigger--plan {
  border-color: var(--color-accent-dim);
  background: var(--color-accent-muted);
}
.mode-trigger--plan:hover {
  background: var(--color-accent-muted);
  border-color: var(--color-accent);
}
.mode-trigger-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}
.mode-trigger--plan .mode-trigger-label {
  color: var(--color-accent-text);
}
.mode-trigger-chevron {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: transform 150ms ease;
}
.mode-trigger--plan .mode-trigger-chevron {
  color: var(--color-accent-text);
  opacity: 0.7;
}
.rotated {
  transform: rotate(180deg);
}

.mode-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 130px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  z-index: 10000;
  padding: 3px;
}
.mode-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 30px;
  padding-inline: 10px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 100ms ease;
}
.mode-opt:hover {
  background: var(--color-bg-hover);
}
.mode-opt--active {
  background: var(--color-bg-card);
}
.mode-opt--active:hover {
  background: var(--color-bg-hover);
}
.mode-opt-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.mode-opt-check {
  color: var(--color-accent-text);
  flex-shrink: 0;
}
.popup-enter-active,
.popup-leave-active {
  transition:
    opacity 110ms ease,
    transform 110ms ease;
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 110ms ease,
    border-color 110ms ease,
    color 110ms ease;
}
.action-btn--send {
  background: transparent;
  color: var(--color-text-tertiary);
  border-color: var(--color-border-subtle);
}
.action-btn--send:disabled {
  cursor: default;
  opacity: 0.3;
}
.action-btn--send-active {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}
.action-btn--send-active:hover {
  background: color-mix(in srgb, var(--color-accent-muted) 180%, transparent);
  border-color: var(--color-accent);
}
.action-btn--stop {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
  color: var(--color-danger-text);
}
.action-btn--stop:hover {
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
}

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
  flex-shrink: 0;
  transition: transform 150ms ease;
}
.model-chevron--open {
  transform: rotate(180deg);
}

.picker-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  width: 260px;
  max-height: 320px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
}
.picker-search-wrap {
  position: relative;
  padding: 7px 7px 5px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.picker-search-icon {
  position: absolute;
  left: 17px;
  top: 50%;
  transform: translateY(-3px);
  color: var(--color-text-tertiary);
  pointer-events: none;
}
.picker-search {
  width: 100%;
  height: 28px;
  padding-left: 26px;
  padding-right: 8px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: 5px;
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color 120ms ease;
}
.picker-search:focus {
  border-color: var(--color-accent-dim);
}
.picker-search::placeholder {
  color: var(--color-text-tertiary);
}
.picker-groups {
  overflow-y: auto;
  flex: 1;
  padding: 3px 0 5px;
}
.picker-group {
  margin-bottom: 1px;
}
.picker-group-header {
  display: block;
  padding: 7px 11px 3px;
  font-size: 10px;
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
  height: 30px;
  padding-inline: 11px 9px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
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
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}
.picker-model-row--active:hover {
  background: var(--color-accent-muted);
}
.picker-model-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-cap-tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}
.picker-cap-tag--thinking {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
  border: 1px solid var(--color-accent-dim);
}
.picker-cap-tag--tools {
  background: var(--color-success-muted);
  color: var(--color-success-text);
  border: 1px solid var(--color-success-muted);
}
.picker-cap-tag--vision {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info-text);
  border: 1px solid color-mix(in srgb, var(--color-info) 25%, transparent);
}
.picker-empty {
  padding: 18px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
.picker-empty-hint {
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.7;
}
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
</style>

<style>
.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
</style>
