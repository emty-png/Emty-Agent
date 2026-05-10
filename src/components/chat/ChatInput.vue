<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import type { ChatMode } from '@/utils/ai'
import { ArrowUp, Check, ChevronDown, Plus, Square } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import AtMentionDropdown from '@/components/chat/AtMentionDropdown.vue'
import AttachmentPreview from '@/components/chat/AttachmentPreview.vue'
import AttachmentStrip from '@/components/chat/AttachmentStrip.vue'
import ChatInputEstimator from '@/components/chat/ChatInputEstimator.vue'
import ModelPicker from '@/components/chat/ModelPicker.vue'
import QuestionOverlay from '@/components/chat/QuestionOverlay.vue'
import TodoOverlay from '@/components/chat/TodoOverlay.vue'
import { useAtMention } from '@/composables/useAtMention'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/attachment-types'
import { useProjectStore } from '@/stores/project'
import { openFileDialog, readFileAsAttachment } from '@/utils/attachments'

const props = defineProps<{
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  send: [value: string, mode: ChatMode, attachments: Attachment[]]
  stop: []
}>()

const project = useProjectStore()
const projectPath = computed(() => project.projectPath)

const chat = useChatStore()

// mode popup
const mode = computed<ChatMode>({
  get: () => chat.activeTab.draft.mode,
  set: value => chat.updateTabDraft(chat.activeTab.id, { mode: value }),
})
const modeOpen = ref(false)
const MODES = [{ value: 'build' as ChatMode, label: 'Build' }, { value: 'plan' as ChatMode, label: 'Plan' }]
function toggleModeMenu() { modeOpen.value = !modeOpen.value }
function closeModeMenu() { modeOpen.value = false }
function selectMode(m: ChatMode) {
  mode.value = m
  closeModeMenu()
}

// input state
const text = computed({
  get: () => chat.activeTab.draft.text,
  set: value => chat.updateTabDraft(chat.activeTab.id, { text: value }),
})
const focused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// @ mention composable
const mention = useAtMention(textareaRef, text, projectPath)

// ── attachments ─────────────────────────────────────────────────────────────
const attachments = computed({
  get: () => chat.activeTab.draft.attachments,
  set: value => chat.updateTabDraft(chat.activeTab.id, { attachments: value }),
})
const previewAttachment = ref<Attachment | null>(null)

async function addFiles(files: FileList | File[]) {
  const nextAttachments = [...attachments.value]
  for (const file of files) {
    try {
      const attachment = await readFileAsAttachment(file)
      nextAttachments.push(attachment)
    }
    catch (err) {
      console.warn('[ChatInput] Failed to read file:', file.name, err)
    }
  }
  attachments.value = nextAttachments
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(a => a.id !== id)
}

/** Handle paste events — extract images from clipboard. */
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items)
    return

  const imageFiles: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        e.preventDefault()
        imageFiles.push(
          isImageMime(file.type)
            ? new File([file], `Pasted image.${file.type.split('/')[1] ?? 'png'}`, { type: file.type })
            : file,
        )
      }
    }
  }
  if (imageFiles.length > 0)
    addFiles(imageFiles)
}

async function handleOpenFileDialog() {
  const newAttachments = await openFileDialog()
  attachments.value = [...attachments.value, ...newAttachments]
}

function submit() {
  const hasText = text.value.trim().length > 0
  const hasAttachments = attachments.value.length > 0
  if ((!hasText && !hasAttachments) || props.isStreaming)
    return
  emit('send', text.value, mode.value, [...attachments.value])
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

const canSend = computed(() => (text.value.trim().length > 0 || attachments.value.length > 0) && !props.isStreaming)

// ── overlay priority: Questions > AtMention > Todos ───────────────────────────
const hasQuestions = computed(() => !!chat.activeTab.pendingQuestions)
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

watch(
  () => [chat.activeTab.id, text.value],
  async () => {
    await nextTick()
    if (!textareaRef.value)
      return
    textareaRef.value.style.height = 'auto'
    textareaRef.value.style.height = `${Math.min(textareaRef.value.scrollHeight, 180)}px`
  },
  { immediate: true },
)
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
        @paste="onPaste"
      />

      <!-- Attachment preview strip -->
      <AttachmentStrip :attachments="attachments" @preview="previewAttachment = $event" @remove="removeAttachment" />

      <div class="input-toolbar">
        <!-- Upload button -->
        <button
          class="upload-btn"
          aria-label="Upload files"
          :disabled="props.isStreaming"
          @click="handleOpenFileDialog"
        >
          <Plus :size="14" :stroke-width="2" />
        </button>

        <!-- Mode selector after + -->
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

        <div class="toolbar-right">
          <ChatInputEstimator :text="text" :mode="mode" :attachments="attachments" />

          <ModelPicker />

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
      </div>

      <div v-if="modeOpen" class="global-backdrop" @click="closeModeMenu" />
    </div>

    <!-- Attachment preview modal -->
    <AttachmentPreview
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="previewAttachment = null"
    />
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
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  transition: border-color 120ms ease;
  overflow: visible;
}
.input-shell--focused {
  border-color: var(--color-accent-dim);
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
  gap: 6px;
  padding: 6px 8px 8px;
  position: relative;
}

.tool-spacer {
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── attachment preview strip ─────────────────────────────────────────────── */
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 10px 6px;
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 5px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  cursor: pointer;
  max-width: 220px;
  transition:
    background 110ms ease,
    border-color 110ms ease;
}

.attachment-chip:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-bright);
}

.attachment-thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
}

.attachment-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 5px;
  background: var(--color-bg-card);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.attachment-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-size {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.attachment-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.attachment-remove:hover {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger-text);
}

/* ── upload button ────────────────────────────────────────────────────────── */
.upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.upload-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
}

.upload-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mode-wrap {
  position: relative;
}
.mode-trigger {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 32px;
  padding-inline: 10px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: all 120ms ease;
}
.mode-trigger:hover,
.mode-trigger--open {
  background: var(--color-bg-hover);
  border-color: var(--color-border-subtle);
}
.mode-trigger--plan .mode-trigger-label {
  color: var(--color-accent-text);
}
.mode-trigger--plan .mode-trigger-chevron {
  color: var(--color-accent-text);
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
  left: 50%;
  transform: translateX(-50%);
  width: 130px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 10px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 24px 56px rgba(0, 0, 0, 0.6);
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
    opacity 160ms ease,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.97);
}

.global-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
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
</style>
