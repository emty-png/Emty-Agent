<script setup lang="ts">
import type { CommandEntry } from '@/composables/useSlashCommand'
import type { Attachment } from '@/stores/chat/attachment-types'
import type { AgentStatus } from '@/stores/chat/types'
import { ArrowUp, Plus, Square } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { INIT_PROMPT } from '@/composables/ChatInput.initPrompt'
import { findTokenAfter, findTokenBefore, findTokenContaining, snapToTokenBoundary, splitMentions } from '@/composables/chatInputTokens'
import { useAtMention } from '@/composables/useAtMention'
import { useChatAttachments } from '@/composables/useChatAttachments'
import { useSlashCommand } from '@/composables/useSlashCommand'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agentStatus'
import { resolveTabWorkspacePath } from '@/stores/chat/workspace'
import { useProjectStore } from '@/stores/project'
import { serializeForSend } from '@/utils/mentionFormat'
import AtMentionOverlay from '../chat-input-overlay/AtMentionOverlay.vue'
import PermissionOverlay from '../chat-input-overlay/PermissionOverlay.vue'
import QuestionOverlay from '../chat-input-overlay/QuestionOverlay.vue'
import SlashCommandOverlay from '../chat-input-overlay/SlashCommandOverlay.vue'
import TodoOverlay from '../chat-input-overlay/TodoOverlay.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import AttachmentStrip from './AttachmentStrip.vue'
import ChatInputEstimator from './ChatInputEstimator.vue'
import ModelPicker from './ModelPicker.vue'
import PermissionModePicker from './PermissionModePicker.vue'
import ProjectPicker from './ProjectPicker.vue'

const props = defineProps<{
  agentStatus?: AgentStatus
}>()
const emit = defineEmits<{
  send: [value: string, attachments: Attachment[]]
  stop: []
}>()

const project = useProjectStore()
const chat = useChatStore()
const projectPath = computed(() => resolveTabWorkspacePath(chat.activeTab, project.projectPath))

const isStreaming = computed(() => props.agentStatus ? isStreamingStatus(props.agentStatus) : false)

const text = computed({
  get: () => chat.activeTab.draft.text,
  set: value => chat.updateTabDraft(chat.activeTab.id, { text: value }),
})

const parsedParts = computed(() => splitMentions(text.value))

const focused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const backdropRef = ref<HTMLElement | null>(null)
const inputRootRef = ref<HTMLElement | null>(null)
const compactToolbar = ref(false)
const COMPACT_THRESHOLD = 520

onMounted(() => {
  if (!inputRootRef.value)
    return
  const ro = new ResizeObserver(([entry]) => {
    if (entry)
      compactToolbar.value = entry.contentRect.width < COMPACT_THRESHOLD
  })
  ro.observe(inputRootRef.value)
  onUnmounted(() => ro.disconnect())
})

const mention = useAtMention(textareaRef, text, projectPath)
const slash = useSlashCommand(textareaRef, text, projectPath)

const { attachments, previewAttachment, onPaste, removeAttachment, handleOpenFileDialog } = useChatAttachments()

function handleSlashSelect(entry: CommandEntry) {
  if (entry.id === 'new') {
    text.value = ''
    chat.closeTab(chat.activeId)
    slash.close()
  }
  else if (entry.id === 'plan') {
    chat.activeTab.mode = 'plan'
    text.value = ''
    slash.close()
  }
  else if (entry.id === 'init') {
    slash.replaceWithText(INIT_PROMPT)
  }
  else if (entry.type === 'skill' && entry.skillId) {
    slash.insertSkillChip(entry)
  }
  else {
    slash.replaceWithText(`${entry.label} `)
  }
}

function syncScroll() {
  if (backdropRef.value && textareaRef.value) {
    backdropRef.value.scrollTop = textareaRef.value.scrollTop
    backdropRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el)
    return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function submit() {
  const hasText = text.value.trim().length > 0
  const hasAttachments = attachments.value.length > 0
  if ((!hasText && !hasAttachments) || isStreaming.value)
    return
  emit('send', serializeForSend(text.value), [...attachments.value])
  autoResize()
}

async function handleCompactSession(payload: { source: 'auto' | 'manual' }) {
  await chat.compactSession(chat.activeTab.id, payload.source)
}

function onKeydown(e: KeyboardEvent) {
  if (slash.handleKeydown(e, handleSlashSelect))
    return
  if (mention.handleKeydown(e))
    return

  // ── Arrow keys: skip over tokens atomically (chip body + padding) ────────
  if (
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    && !e.shiftKey
    && textareaRef.value
    && textareaRef.value.selectionStart === textareaRef.value.selectionEnd
  ) {
    const cursor = textareaRef.value.selectionStart ?? 0
    const next = e.key === 'ArrowLeft' ? cursor - 1 : cursor + 1
    if (next >= 0 && next <= text.value.length) {
      const tok = findTokenContaining(text.value, next)
      if (tok) {
        e.preventDefault()
        const dest = e.key === 'ArrowLeft' ? tok.outerStart : tok.outerEnd
        textareaRef.value.setSelectionRange(dest, dest)
        return
      }
    }
  }

  if (
    e.key === 'Backspace'
    && !slash.isOpen.value
    && !mention.isOpen.value
    && textareaRef.value
    && textareaRef.value.selectionStart === textareaRef.value.selectionEnd
  ) {
    const cursor = snapToTokenBoundary(text.value, textareaRef.value.selectionStart ?? 0)
    const tokenRange = findTokenBefore(text.value, cursor)
    if (tokenRange) {
      e.preventDefault()
      text.value = `${text.value.slice(0, tokenRange.outerStart)}${text.value.slice(tokenRange.outerEnd)}`
      nextTick(() => {
        const el = textareaRef.value
        if (!el)
          return
        el.setSelectionRange(tokenRange.outerStart, tokenRange.outerStart)
        el.focus()
        autoResize()
        syncScroll()
      })
      return
    }
  }

  if (
    e.key === 'Delete'
    && !slash.isOpen.value
    && !mention.isOpen.value
    && textareaRef.value
    && textareaRef.value.selectionStart === textareaRef.value.selectionEnd
  ) {
    const cursor = snapToTokenBoundary(text.value, textareaRef.value.selectionStart ?? 0)
    const tokenRange = findTokenAfter(text.value, cursor)
    if (tokenRange) {
      e.preventDefault()
      text.value = `${text.value.slice(0, tokenRange.outerStart)}${text.value.slice(tokenRange.outerEnd)}`
      nextTick(() => {
        const el = textareaRef.value
        if (!el)
          return
        el.setSelectionRange(tokenRange.outerStart, tokenRange.outerStart)
        el.focus()
        autoResize()
        syncScroll()
      })
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function onInput(e: Event) {
  autoResize()
  slash.handleInput(e)
  mention.handleInput(e)
  syncScroll()
}

/** Snap cursor/selection out of tokens after mouse interaction. */
function onMouseUp() {
  const el = textareaRef.value
  if (!el)
    return
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const snappedStart = snapToTokenBoundary(text.value, start)
  const snappedEnd = snapToTokenBoundary(text.value, end)
  if (snappedStart !== start || snappedEnd !== end)
    el.setSelectionRange(snappedStart, snappedEnd)
}

const canSend = computed(() => (text.value.trim().length > 0 || attachments.value.length > 0) && !isStreaming.value)

const hasPermissionPrompt = computed(() => chat.activeTab.pendingPermissions.length > 0)
const hasQuestions = computed(() => !!chat.activeTab.pendingQuestions)
const hasTodos = computed(() => chat.activeTab.todos.length > 0)
const showTodos = computed(() => hasTodos.value && !hasPermissionPrompt.value && !hasQuestions.value && !mention.isOpen.value && !slash.isOpen.value)

watch(
  () => [chat.activeTab.id, text.value],
  async () => {
    await nextTick()
    autoResize()
    syncScroll()
  },
  { immediate: true },
)

watch(
  () => [chat.activeTab.id, projectPath.value],
  async () => {
    if (!projectPath.value || chat.activeTab.subAgent)
      return
    if (chat.activeTab.workspaceLocked && chat.activeTab.workspacePath && chat.activeTab.workspacePath !== projectPath.value)
      return

    const { inspectWorkspace } = await import('@/utils/worktrees')
    const snapshot = await inspectWorkspace(projectPath.value)
    chat.setTabWorkspace(chat.activeTab.id, {
      workspacePath: projectPath.value,
      workspaceMeta: snapshot,
    })
  },
  { immediate: true },
)

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const overlayTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-200 ease-out',
  enterFromClass: 'opacity-0 translate-y-3',
  enterToClass: 'opacity-100 translate-y-0',
  leaveActiveClass: 'transition-[opacity,transform] duration-150 ease-out',
  leaveFromClass: 'opacity-100 translate-y-0',
  leaveToClass: 'opacity-0 translate-y-3',
}

const shellClasses = computed(() => [
  'input-shell relative w-full bg-(--color-bg-card) border rounded-(--radius-lg) flex flex-col overflow-visible transition-colors duration-[120ms] ease-out',
  (focused.value || isStreaming.value) ? 'border-(--color-accent-dim)' : 'border-(--color-border-bright)',
].join(' '))

const textAreaBase = [
  'w-full min-h-[44px] max-h-[180px] pt-3 px-[14px] pb-1',
  'text-[13.5px] font-[inherit] leading-[1.55] whitespace-pre-wrap break-words tracking-normal',
  'border-none box-border m-0',
].join(' ')

const backdropClasses = [
  textAreaBase,
  'absolute inset-0 text-(--color-text-primary) pointer-events-none overflow-y-auto select-none',
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
].join(' ')

const fieldClasses = [
  textAreaBase,
  'relative z-10 bg-transparent text-transparent caret-(--color-accent-bright) outline-none overflow-y-auto resize-none',
  'selection:text-transparent selection:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]',
  'placeholder:text-transparent disabled:opacity-45 disabled:cursor-not-allowed',
].join(' ')

const chipBase = [
  'inline-flex items-center gap-0 rounded-[4px] font-[inherit]',
  'whitespace-pre-wrap overflow-visible [text-overflow:unset] align-baseline',
  'px-[5px] py-[1px] leading-[inherit] mx-[-5px]',
].join(' ')

const mentionClasses = [
  chipBase,
  'text-(--color-accent-text)',
  'bg-[color-mix(in_srgb,var(--color-accent-text)_10%,transparent)]',
].join(' ')

const skillClasses = [
  chipBase,
  'text-(--color-success-text)',
  'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]',
].join(' ')

const btnTransition = '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]'

const uploadBtnClasses = [
  'flex items-center justify-center w-[30px] h-[30px] border border-transparent rounded-(--radius-md)',
  'bg-transparent text-(--color-text-primary) cursor-pointer shrink-0',
  btnTransition,
  'hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg) hover:text-(--color-text-secondary)',
  'active:scale-[0.97] active:duration-[80ms]',
  'disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none',
].join(' ')

const actionBtnBase = `flex items-center justify-center w-[30px] h-[30px] border rounded-(--radius-md) cursor-pointer shrink-0 ${btnTransition} hover:rounded-(--radius-lg) active:scale-[0.97] active:duration-[80ms]`

const stopBtnClasses = `${actionBtnBase} bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-(--color-danger-text) hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:border-[color-mix(in_srgb,var(--color-danger)_50%,transparent)]`

const sendBtnClasses = computed(() => {
  if (canSend.value) {
    return `${actionBtnBase} bg-(--color-accent-muted) border-(--color-accent-dim) text-(--color-accent-text) hover:bg-[color-mix(in_srgb,var(--color-accent-muted)_80%,transparent)] hover:border-(--color-accent)`
  }
  return `${actionBtnBase} bg-transparent text-(--color-text-tertiary) border-(--color-border-subtle) disabled:cursor-default disabled:opacity-30 disabled:transform-none`
})
</script>

<template>
  <div ref="inputRootRef" class="chat-input-root relative w-full flex flex-col overflow-visible">
    <Transition v-bind="overlayTransitions">
      <PermissionOverlay v-if="hasPermissionPrompt" />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <QuestionOverlay v-if="hasQuestions && !hasPermissionPrompt" />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <AtMentionOverlay
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
    <Transition v-bind="overlayTransitions">
      <SlashCommandOverlay
        v-if="slash.isOpen.value && !hasQuestions && !hasPermissionPrompt"
        :entries="slash.filteredCommands.value"
        :selected-idx="slash.selectedIdx.value"
        :loading="slash.loading.value"
        :query="slash.slashQuery.value"
        @select="handleSlashSelect"
        @hover="slash.setSelectedIdx($event)"
        @close="slash.close()"
      />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <TodoOverlay v-if="showTodos" />
    </Transition>

    <div :class="shellClasses">
      <!-- Scanner track & spinning head -->
      <div
        v-if="isStreaming"
        class="box-border absolute -inset-px rounded-[inherit] p-px pointer-events-none z-10 overflow-hidden"
        style="mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; -webkit-mask-composite: xor;"
      >
        <div class="absolute top-1/2 left-1/2 w-[300%] aspect-square -translate-x-1/2 -translate-y-1/2">
          <div class="w-full h-full animate-[spin_2.5s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0%,transparent_75%,var(--color-accent)_95%,var(--color-accent-bright)_100%)]" />
        </div>
      </div>

      <!-- Syntax Highlighter wrapper -->
      <div class="relative w-full flex">
        <!-- Colored Backdrop -->
        <div ref="backdropRef" :class="backdropClasses" aria-hidden="true">
          <span v-if="!text" class="text-(--color-text-tertiary)">
            {{ 'Ask anything\u2026 (@ to link files)' }}
          </span>
          <template v-else>
            <template v-for="(part, i) in parsedParts" :key="i">
              <span v-if="part.type === 'mention'" :class="mentionClasses" :title="part.value">
                {{ part.display }}
              </span>
              <span v-else-if="part.type === 'skill'" :class="skillClasses" :title="part.value">
                {{ part.display }}
              </span>
              <span v-else>{{ part.display }}</span>
            </template>
            <br v-if="text.endsWith('\n')">
          </template>
        </div>

        <!-- Invisible physical Textarea -->
        <textarea
          ref="textareaRef"
          v-model="text"
          :class="fieldClasses"
          rows="1"
          spellcheck="false"
          :disabled="isStreaming"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="onKeydown"
          @input="onInput"
          @scroll="syncScroll"
          @paste="onPaste"
          @mouseup="onMouseUp"
        />
      </div>

      <AttachmentStrip :attachments="attachments" @preview="previewAttachment = $event" @remove="removeAttachment" />

      <div
        class="flex items-center gap-1.5 pt-1.5 px-2 pb-2 relative"
        :class="[{ 'input-toolbar--compact': compactToolbar }]"
      >
        <button
          :class="uploadBtnClasses"
          aria-label="Upload files"
          :disabled="isStreaming"
          @click="handleOpenFileDialog"
        >
          <Plus :size="14" :stroke-width="2" />
        </button>

        <PermissionModePicker :is-plan-mode="chat.activeTab.mode === 'plan'" :compact="compactToolbar" />

        <ProjectPicker :compact="compactToolbar" />

        <div class="flex-1" />

        <div class="flex items-center gap-2 shrink-0">
          <ChatInputEstimator
            :text="text"
            mode="build"
            :attachments="attachments"
            @compact-session="handleCompactSession"
          />
          <ModelPicker />
          <button v-if="isStreaming" :class="stopBtnClasses" aria-label="Stop generation" @click="$emit('stop')">
            <Square :size="11" :stroke-width="0" style="fill: currentColor" />
          </button>
          <button
            v-else
            :class="sendBtnClasses"
            aria-label="Send message"
            :disabled="!canSend"
            @click="submit"
          >
            <ArrowUp :size="15" :stroke-width="2.2" />
          </button>
        </div>
      </div>
    </div>

    <AttachmentPreview v-if="previewAttachment" :attachment="previewAttachment" @close="previewAttachment = null" />
  </div>
</template>
