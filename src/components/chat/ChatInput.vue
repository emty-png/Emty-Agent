<script setup lang="ts">
import type { Attachment } from '@/stores/chat/attachment-types'
import { ArrowUp, ChevronDown, Plus, Shield, Square, WandSparkles } from 'lucide-vue-next'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import AtMentionDropdown from '@/components/chat/AtMentionDropdown.vue'
import AttachmentPreview from '@/components/chat/AttachmentPreview.vue'
import AttachmentStrip from '@/components/chat/AttachmentStrip.vue'
import ChatInputEstimator from '@/components/chat/ChatInputEstimator.vue'
import ModelPicker from '@/components/chat/ModelPicker.vue'
import PermissionOverlay from '@/components/chat/PermissionOverlay.vue'
import QuestionOverlay from '@/components/chat/QuestionOverlay.vue'
import TodoOverlay from '@/components/chat/TodoOverlay.vue'
import { useAtMention } from '@/composables/useAtMention'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/attachment-types'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { openFileDialog, readFileAsAttachment } from '@/utils/attachments'

interface TooltipState { text: string; x: number; y: number; visible: boolean }
const props = defineProps<{
  isStreaming?: boolean
}>()
const emit = defineEmits<{
  send: [value: string, attachments: Attachment[]]
  stop: []
}>()
const tooltip = ref<TooltipState>({ text: '', x: 0, y: 0, visible: false })
let _hideTimer: ReturnType<typeof setTimeout> | null = null
function showTip(e: MouseEvent, text: string) {
  if (_hideTimer) {
    clearTimeout(_hideTimer)
    _hideTimer = null
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tooltip.value = { text, x: r.left + r.width / 2, y: r.bottom + 8, visible: true }
}

function hideTip() {
  _hideTimer = setTimeout(() => {
    tooltip.value.visible = false
  }, 80)
}

const project = useProjectStore()
const settings = useSettingsStore()
const projectPath = computed(() => project.projectPath)
const chat = useChatStore()

// ── Permission mode dropdown ─────────────────────────────────────────────
const permOpen = ref(false)
function togglePerm() { permOpen.value = !permOpen.value }
function selectPerm(mode: 'ask' | 'auto') {
  settings.agent.permissionMode = mode
  permOpen.value = false
}
function onPermKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    permOpen.value = false
}
window.addEventListener('keydown', onPermKeydown)
onUnmounted(() => window.removeEventListener('keydown', onPermKeydown))

const text = computed({
  get: () => chat.activeTab.draft.text,
  set: value => chat.updateTabDraft(chat.activeTab.id, { text: value }),
})
const focused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const backdropRef = ref<HTMLElement | null>(null)

const mention = useAtMention(textareaRef, text, projectPath)

// ── Mentions syntax highlighting backdrop ─────────────────────────────────
interface MsgPart { type: 'text' | 'mention'; value: string }

function splitMentions(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  if (!text)
    return parts
  const regex = /@[\w./\-]+/g
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'mention', value: match[0] })
    lastIndex = match.index + match[0].length
    match = regex.exec(text)
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return parts
}

// Keep the invisible textarea and visual backdrop perfectly scrolled together
function syncScroll() {
  if (backdropRef.value && textareaRef.value) {
    backdropRef.value.scrollTop = textareaRef.value.scrollTop
    backdropRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

const attachments = computed({
  get: () => chat.activeTab.draft.attachments,
  set: value => chat.updateTabDraft(chat.activeTab.id, { attachments: value }),
})
const previewAttachment = ref<Attachment | null>(null)

async function addFiles(files: FileList | File[]) {
  const nextAttachments = [...attachments.value]
  for (const file of files) {
    try { nextAttachments.push(await readFileAsAttachment(file)) }
    catch (err) { console.warn('[ChatInput] Failed to read file:', file.name, err) }
  }
  attachments.value = nextAttachments
}

function removeAttachment(id: string) { attachments.value = attachments.value.filter(a => a.id !== id) }

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
  emit('send', text.value, [...attachments.value])
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
  syncScroll()
}

const canSend = computed(() => (text.value.trim().length > 0 || attachments.value.length > 0) && !props.isStreaming)

const hasPermissionPrompt = computed(() => chat.activeTab.pendingPermissions.length > 0)
const hasQuestions = computed(() => !!chat.activeTab.pendingQuestions)
const hasTodos = computed(() => chat.activeTab.todos.length > 0)
const showTodos = computed(() => hasTodos.value && !hasPermissionPrompt.value && !hasQuestions.value && !mention.isOpen.value)

watch(
  () => [chat.activeTab.id, text.value],
  async () => {
    await nextTick()
    if (!textareaRef.value)
      return
    textareaRef.value.style.height = 'auto'
    textareaRef.value.style.height = `${Math.min(textareaRef.value.scrollHeight, 180)}px`
    syncScroll()
  },
  { immediate: true },
)
</script>

<template>
  <div class="chat-input-root">
    <Transition name="overlay">
      <PermissionOverlay v-if="hasPermissionPrompt" />
    </Transition>
    <Transition name="overlay">
      <QuestionOverlay v-if="hasQuestions && !hasPermissionPrompt" />
    </Transition>
    <Transition name="overlay">
      <AtMentionDropdown
        v-if="mention.isOpen.value && !hasQuestions && !hasPermissionPrompt"
        :entries="mention.filteredEntries.value"
        :selected-idx="mention.selectedIdx.value"
        :loading="mention.loading.value"
        :query="mention.atQuery.value"
        @select="mention.selectEntry($event)"
        @hover="mention.setSelectedIdx($event)"
        @close="mention.close()"
      />
    </Transition>
    <Transition name="overlay">
      <TodoOverlay v-if="showTodos" />
    </Transition>

    <div
      class="input-shell"
      :class="{
        'input-shell--focused': focused,
        'input-shell--streaming': props.isStreaming,
      }"
    >
      <div v-if="props.isStreaming" class="input-scanner-track">
        <div class="input-scanner-head" />
      </div>

      <!-- Syntax Highlighter wrapper -->
      <div class="input-text-area">
        <!-- Colored Backdrop -->
        <div ref="backdropRef" class="input-backdrop" aria-hidden="true">
          <span v-if="!text" class="backdrop-placeholder">
            {{ 'Ask anything\u2026 (@ to link files)' }}
          </span>
          <template v-else>
            <template v-for="(part, i) in splitMentions(text)" :key="i">
              <span v-if="part.type === 'mention'" class="backdrop-mention">{{ part.value }}</span>
              <span v-else>{{ part.value }}</span>
            </template>
            <br v-if="text.endsWith('\n')">
          </template>
        </div>

        <!-- Invisible physical Textarea (sits exactly on top) -->
        <textarea
          ref="textareaRef"
          v-model="text"
          class="input-field"
          rows="1"
          :disabled="props.isStreaming"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="onKeydown"
          @input="onInput"
          @scroll="syncScroll"
          @paste="onPaste"
        />
      </div>

      <AttachmentStrip :attachments="attachments" @preview="previewAttachment = $event" @remove="removeAttachment" />

      <div class="input-toolbar">
        <button
          class="upload-btn"
          aria-label="Upload files"
          :disabled="props.isStreaming"
          @click="handleOpenFileDialog"
          @mouseenter="showTip($event, 'Attach files')"
          @mouseleave="hideTip"
        >
          <Plus :size="14" :stroke-width="2" />
        </button>

        <!-- Permission mode toggle -->
        <div class="perm-picker-wrap">
          <button
            class="perm-btn"
            :class="[
              permOpen ? 'perm-btn--open' : '',
              `perm-btn--${settings.agent.permissionMode}`,
            ]"
            aria-label="Permission mode"
            @click="togglePerm"
            @mouseenter="showTip($event, settings.agent.permissionMode === 'auto' ? 'Yolo — tools run without asking' : 'Ask — approve each tool call')"
            @mouseleave="hideTip"
          >
            <span>{{ settings.agent.permissionMode === 'auto' ? 'Yolo' : 'Ask' }}</span>
            <ChevronDown
              :size="13"
              :stroke-width="2.5"
              class="perm-chevron"
              :class="{ 'perm-chevron--open': permOpen }"
            />
          </button>
          <Transition name="perm-dd">
            <div v-if="permOpen" class="perm-dropdown">
              <button
                class="perm-option"
                :class="{ 'perm-option--active': settings.agent.permissionMode === 'ask' }"
                @click="selectPerm('ask')"
              >
                <Shield :size="13" :stroke-width="2" />
                <span>Ask Permission</span>
              </button>
              <button
                class="perm-option"
                :class="{ 'perm-option--active': settings.agent.permissionMode === 'auto' }"
                @click="selectPerm('auto')"
              >
                <WandSparkles :size="13" :stroke-width="2" />
                <span>Yolo</span>
              </button>
            </div>
          </Transition>
          <div v-if="permOpen" class="perm-backdrop" @click="permOpen = false" />
        </div>

        <div class="tool-spacer" />

        <div class="toolbar-right">
          <ChatInputEstimator :text="text" mode="build" :attachments="attachments" />
          <ModelPicker />
          <button v-if="props.isStreaming" class="action-btn action-btn--stop" aria-label="Stop generation" @click="$emit('stop')" @mouseenter="showTip($event, 'Stop generation')" @mouseleave="hideTip">
            <Square :size="11" :stroke-width="0" style="fill: currentColor" />
          </button>
          <button
            v-else
            class="action-btn action-btn--send"
            :class="{ 'action-btn--send-active': canSend }"
            aria-label="Send message"
            :disabled="!canSend"
            @click="submit"
            @mouseenter="showTip($event, 'Send message')"
            @mouseleave="hideTip"
          >
            <ArrowUp :size="15" :stroke-width="2.2" />
          </button>
        </div>
      </div>
    </div>

    <AttachmentPreview v-if="previewAttachment" :attachment="previewAttachment" @close="previewAttachment = null" />

    <Teleport to="body">
      <div
        class="chat-float-tooltip"
        :class="{ 'chat-float-tooltip--visible': tooltip.visible }"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        {{ tooltip.text }}
        <span class="chat-float-tooltip-caret" />
      </div>
    </Teleport>
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
  position: relative;
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
.input-shell--streaming {
  border-color: var(--color-accent-dim);
}

.input-scanner-track {
  box-sizing: border-box;
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  z-index: 10;
  overflow: hidden;
}
.input-scanner-head {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 300%;
  aspect-ratio: 1 / 1;
  background: conic-gradient(
    from 0deg,
    transparent 0%,
    transparent 75%,
    var(--color-accent) 95%,
    var(--color-accent-bright) 100%
  );
  transform: translate(-50%, -50%) rotate(0deg);
  animation: chat-scanner-spin 2.5s linear infinite;
}
@keyframes chat-scanner-spin {
  0% {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

/* ── Backdrop Syntax Highlighter Setup ───────────────────────────────────── */
.input-text-area {
  position: relative;
  width: 100%;
  display: flex;
}

/* Base styles must be completely identical between the two layers */
.input-backdrop,
.input-field {
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  padding: 12px 14px 4px;
  font-size: 13.5px;
  font-family: inherit;
  line-height: 1.55;
  white-space: pre-wrap;
  word-wrap: break-word;
  letter-spacing: normal;
  word-spacing: normal;
  border: none;
  box-sizing: border-box;
  margin: 0;
}

.input-backdrop {
  position: absolute;
  inset: 0;
  color: var(--color-text-primary);
  pointer-events: none; /* Let clicks pass through to textarea */
  overflow-y: auto;
  scrollbar-width: none;
}
.input-backdrop::-webkit-scrollbar {
  display: none;
}

.backdrop-placeholder {
  color: var(--color-text-tertiary);
}

.backdrop-mention {
  color: var(--color-accent-text);
  background: var(--color-accent-muted-plus);
  border-radius: 4px;
  /*
    We use box-shadow instead of padding/border to style the pill so it doesn't
    push text outwards and misalign the caret in the invisible textarea!
  */
  box-shadow:
    -2px 0 0 var(--color-accent-muted-plus),
    2px 0 0 var(--color-accent-muted-plus),
    0 0 0 1px var(--color-accent-dim);
}

.input-field {
  position: relative;
  z-index: 1;
  background: transparent;
  color: transparent; /* Makes real text invisible, revealing colored backdrop text! */
  caret-color: var(--color-accent-bright);
  outline: none;
  overflow-y: auto;
  resize: none;
}
.input-field::selection {
  color: #fff;
  background: var(--color-accent);
}
.input-field::placeholder {
  color: transparent;
}
.input-field:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ────────────────────────────────────────────────────────────────────────── */

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
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 10px 6px;
}

.upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.upload-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-mid);
  border-radius: 10px;
  color: var(--color-text-secondary);
}
.upload-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}
.upload-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.action-btn:hover {
  border-radius: 10px;
}
.action-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.action-btn--send {
  background: transparent;
  color: var(--color-text-tertiary);
  border-color: var(--color-border-subtle);
}
.action-btn--send:disabled {
  cursor: default;
  opacity: 0.3;
  transform: none;
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

.chat-float-tooltip {
  position: fixed;
  transform: translateX(-50%);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  color: var(--color-text-primary);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 5px 10px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 99999;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 1px 3px rgba(0, 0, 0, 0.2);
  opacity: 0;
  margin-top: -4px;
  transition:
    opacity 140ms ease,
    margin-top 140ms ease;
}
.chat-float-tooltip--visible {
  opacity: 1;
  margin-top: 0;
}
.chat-float-tooltip-caret {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-bottom-color: var(--color-border-bright);
}

/* ── Permission mode picker ────────────────────────────────────────────────── */
.perm-picker-wrap {
  position: relative;
}

.perm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding-inline: 10px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.perm-btn:hover,
.perm-btn--open {
  background: var(--color-bg-hover);
  border-color: var(--color-border-mid);
  border-radius: 10px;
}

.perm-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.perm-btn--auto {
  color: var(--color-warning-text);
}

.perm-btn--auto:hover,
.perm-btn--auto.perm-btn--open {
  color: var(--color-warning-text);
  background: color-mix(in srgb, var(--color-warning-text) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-warning-text) 30%, transparent);
}

.perm-chevron {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.perm-chevron--open {
  transform: rotate(180deg);
}

.perm-btn--auto .perm-chevron {
  color: color-mix(in srgb, var(--color-warning-text) 70%, transparent);
}

.perm-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 164px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 24px 56px rgba(0, 0, 0, 0.55),
    0 0 48px var(--color-accent-muted);
  padding: 6px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  will-change: transform, opacity;
}

.perm-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: 34px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.perm-option:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

.perm-option--active {
  background: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.perm-option--active:hover {
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  border-color: var(--color-accent);
}

.perm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

.perm-dd-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.perm-dd-leave-active {
  transition:
    opacity 160ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 160ms cubic-bezier(0.7, 0, 0.84, 0);
}

.perm-dd-enter-from,
.perm-dd-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.96);
  transform-origin: bottom center;
}

.perm-dd-enter-to,
.perm-dd-leave-from {
  transform: translateX(-50%);
  transform-origin: bottom center;
}
</style>
