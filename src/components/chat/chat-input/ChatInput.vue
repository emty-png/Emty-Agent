<script setup lang="ts">
import type { FsEntry } from '@/composables/chat/useAtMention'
import type { CommandEntry } from '@/composables/chat/useSlashCommand'
import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import type { AgentStatus } from '@/stores/chat/core/types'
import type { DictationContext } from '@/utils/voicePostProcess'
import type { VoiceStreamSession } from '@/utils/voiceStreamApi'
import { AlertTriangle, ArrowUp, Eye, ListPlus, Mic, Plus, Square } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { INIT_PROMPT } from '@/composables/chat/initPrompt'
import { useAtMention } from '@/composables/chat/useAtMention'
import { useChatAttachments } from '@/composables/chat/useChatAttachments'
import { findTokenAfter, findTokenBefore, findTokenContaining, snapToTokenBoundary, splitMentions } from '@/composables/chat/useChatTokens'
import { useRestoreOverlay } from '@/composables/chat/useRestoreOverlay'
import { useSlashCommand } from '@/composables/chat/useSlashCommand'
import { useDragDrop } from '@/composables/ui/useDragDrop'
import { useVoiceRecorder } from '@/composables/voice/useVoiceRecorder'
import { useChatStore } from '@/stores/chat'
import { isStreamingStatus } from '@/stores/chat/agent/status'
import { resolveTabWorkspacePath } from '@/stores/chat/utils/workspace'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { readFileFromPath } from '@/utils/attachments'
import { serializeForSend } from '@/utils/mentionFormat'
import { transcribeAudio } from '@/utils/voiceApi'
import { processTranscript } from '@/utils/voicePostProcess'
import { isStreamingSupported, startStreamingSession } from '@/utils/voiceStreamApi'
import AtMentionOverlay from '../chat-input-overlay/AtMentionOverlay.vue'
import DragOverlay from '../chat-input-overlay/DragOverlay.vue'
import ChatInputEstimator from '../chat-input-overlay/EstimatorOverlay.vue'
import PermissionOverlay from '../chat-input-overlay/PermissionOverlay.vue'
import QuestionOverlay from '../chat-input-overlay/QuestionOverlay.vue'
import RestoreOverlay from '../chat-input-overlay/RestoreOverlay.vue'
import SlashCommandOverlay from '../chat-input-overlay/SlashCommandOverlay.vue'
import TodoOverlay from '../chat-input-overlay/TodoOverlay.vue'
import VoiceOverlay from '../chat-input-overlay/VoiceOverlay.vue'
import ModelPicker from '../pickers/ModelPicker.vue'
import PermissionModePicker from '../pickers/PermissionModePicker.vue'
import ProjectPicker from '../pickers/ProjectPicker.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import AttachmentStrip from './AttachmentStrip.vue'
import MessageQueue from './MessageQueue.vue'

const props = defineProps<{
  agentStatus?: AgentStatus
  showProjectPicker?: boolean
  showEstimator?: boolean
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

const mode = computed(() => chat.activeTab.mode)
const activeTab = computed(() => chat.activeTab)
const mention = useAtMention(textareaRef, text, projectPath, activeTab)
const slash = useSlashCommand(textareaRef, text, projectPath, activeTab)
const restoreOverlay = useRestoreOverlay()

const settings = useSettingsStore()
const {
  attachments,
  previewAttachment,
  activeModelSupportsAttachments,
  hasImageAttachments,
  onPaste,
  removeAttachment,
  handleOpenFileDialog,
  handleDomDrop,
  handleDomDragOver,
} = useChatAttachments()
const { isDragging, dragPreviews, isReading } = useDragDrop({
  onFilesDropped(dropped) {
    // Allow dropping for any model — including text-only ones — and warn
    // via showVisionWarning instead of blocking.
    attachments.value = [...attachments.value, ...dropped]
  },
})

// Vision warning: images attached while active model is text-only. We still
// allow the images (requirement) and the serializer will fall back to text.
const showVisionWarning = computed(() => hasImageAttachments.value && !activeModelSupportsAttachments.value)

// For DOM drag fallback we also want to warn while dragging images over a
// non-vision model. Track the current drag's image presence.
const dragHasImages = computed(() =>
  dragPreviews.value.some(p => {
    const ext = p.name.split('.').pop()?.toLowerCase() ?? ''
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'tiff', 'heic', 'heif'].includes(ext)
  }),
)
const showDragVisionWarning = computed(() => isDragging.value && dragHasImages.value && !activeModelSupportsAttachments.value)
const voice = useVoiceRecorder()
const voiceOverlayOpen = ref(false)
const voiceTranscribing = ref(false)
const voiceError = ref<string | null>(null)
const voiceUploadingFile = ref<string | null>(null)
const streamingTranscript = ref('')
let activeStreamSession: VoiceStreamSession | null = null

const dictationContext = computed<DictationContext>(() => {
  const t = text.value
  if (t.startsWith('/'))
    return 'command'
  if (t.startsWith('```'))
    return 'code'
  return 'chat'
})

async function startVoiceRecording() {
  if (!settings.showSttMic)
    return
  voiceError.value = null
  voiceTranscribing.value = false
  streamingTranscript.value = ''
  voiceOverlayOpen.value = true
  try {
    await voice.start()
    if (isStreamingSupported(settings.sttProvider)) {
      const config = settings.stt[settings.sttProvider]
      activeStreamSession = startStreamingSession(settings.sttProvider, config, event => {
        if (event.isFinal)
          streamingTranscript.value += (streamingTranscript.value ? ' ' : '') + event.text
        else
          streamingTranscript.value = (streamingTranscript.value ? `${streamingTranscript.value} ` : '') + event.text
      })
      voice.setOnAudioChunk(chunk => {
        activeStreamSession?.sendAudio(chunk)
      })
    }
  }
  catch (e: unknown) {
    voiceOverlayOpen.value = false
    voiceError.value = e instanceof DOMException && e.name === 'NotAllowedError'
      ? 'Microphone permission denied. Please allow microphone access in your browser settings.'
      : `Could not start recording: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function stopVoiceRecording() {
  if (!voice.recording.value) {
    cancelVoiceRecording()
    return
  }
  voiceTranscribing.value = true
  voice.setOnAudioChunk(null)
  const streamSession = activeStreamSession
  activeStreamSession = null
  try {
    const blob = await voice.stop()
    if (streamSession && streamSession.finalTranscript.trim()) {
      streamSession.close()
      const transcript = processTranscript(streamSession.finalTranscript, settings.voiceProcessing, dictationContext.value, settings.voiceDictionary, settings.voiceSnippets)
      if (transcript) {
        text.value = text.value ? `${text.value.trimEnd()} ${transcript}` : transcript
        await nextTick()
        autoResize()
        syncScroll()
      }
      voiceOverlayOpen.value = false
      voiceTranscribing.value = false
      return
    }
    streamSession?.close()
    if (blob.size === 0) {
      cancelVoiceRecording()
      return
    }
    const config = settings.stt[settings.sttProvider]
    const rawTranscript = await transcribeAudio(blob, settings.sttProvider, config)
    const transcript = processTranscript(rawTranscript, settings.voiceProcessing, dictationContext.value, settings.voiceDictionary, settings.voiceSnippets)
    if (transcript) {
      text.value = text.value ? `${text.value.trimEnd()} ${transcript}` : transcript
      await nextTick()
      autoResize()
      syncScroll()
    }
    voiceOverlayOpen.value = false
    voiceTranscribing.value = false
  }
  catch (e: unknown) {
    voiceError.value = e instanceof Error ? e.message : String(e)
    voiceTranscribing.value = false
  }
}

function cancelVoiceRecording() {
  voice.setOnAudioChunk(null)
  activeStreamSession?.close()
  activeStreamSession = null
  streamingTranscript.value = ''
  voice.cancel()
  voiceOverlayOpen.value = false
  voiceTranscribing.value = false
  voiceError.value = null
  voiceUploadingFile.value = null
}

function pauseVoiceRecording() {
  voice.cancel()
}

const pushToTalkHeld = ref(false)
const voiceStarting = ref(false)
let pendingStop = false

async function onPushToTalkDown(e: KeyboardEvent) {
  if (!settings.showSttMic)
    return
  if (e.code !== 'Space' || !e.ctrlKey)
    return
  if (pushToTalkHeld.value || voiceOverlayOpen.value || voiceTranscribing.value || isStreaming.value)
    return
  e.preventDefault()
  pushToTalkHeld.value = true
  pendingStop = false
  voiceStarting.value = true
  await startVoiceRecording()
  voiceStarting.value = false
  // If the key was released while getUserMedia was resolving
  if (pendingStop) {
    pendingStop = false
    if (voiceOverlayOpen.value && !voiceTranscribing.value)
      stopVoiceRecording()
  }
}

function onPushToTalkUp(e: KeyboardEvent) {
  if (e.code !== 'Space' || !e.ctrlKey)
    return
  if (!pushToTalkHeld.value)
    return
  e.preventDefault()
  pushToTalkHeld.value = false
  // Recording not yet active — defer stop until start resolves
  if (voiceStarting.value) {
    pendingStop = true
    return
  }
  if (voiceOverlayOpen.value && !voiceTranscribing.value)
    stopVoiceRecording()
}

onMounted(() => {
  document.addEventListener('keydown', onPushToTalkDown)
  document.addEventListener('keyup', onPushToTalkUp)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onPushToTalkDown)
  document.removeEventListener('keyup', onPushToTalkUp)
})

async function handleVoiceUpload(file: File) {
  voiceUploadingFile.value = file.name
  voiceError.value = null
  voiceTranscribing.value = true
  voiceOverlayOpen.value = true
  try {
    const config = settings.stt[settings.sttProvider]
    const rawTranscript = await transcribeAudio(file, settings.sttProvider, config)
    const transcript = processTranscript(rawTranscript, settings.voiceProcessing, dictationContext.value, settings.voiceDictionary, settings.voiceSnippets)
    if (transcript) {
      text.value = text.value ? `${text.value.trimEnd()} ${transcript}` : transcript
      await nextTick()
      autoResize()
      syncScroll()
    }
    voiceOverlayOpen.value = false
    voiceTranscribing.value = false
    voiceUploadingFile.value = null
  }
  catch (e: unknown) {
    voiceError.value = e instanceof Error ? e.message : String(e)
    voiceTranscribing.value = false
    voiceUploadingFile.value = null
  }
}

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
  else if (entry.id === 'exit-plan') {
    chat.activeTab.mode = 'build'
    text.value = ''
    slash.close()
  }
  else if (entry.id === 'init') {
    slash.replaceWithText(INIT_PROMPT)
  }
  else if (entry.id === 'restore') {
    slash.close()
    restoreOverlay.open()
  }
  else if (entry.type === 'skill' && entry.skillId) {
    slash.insertSkillChip(entry)
  }
  else {
    slash.replaceWithText(`${entry.label} `)
  }
}

async function handleMentionSelect(entry: FsEntry) {
  if (entry.kind === 'image') {
    try {
      const absPath = projectPath.value ? `${projectPath.value}/${entry.path}` : entry.path
      const attachment = await readFileFromPath(absPath)
      attachments.value = [...attachments.value, attachment]
    }
    catch (err: unknown) {
      console.warn('Failed to attach image:', err instanceof Error ? err.message : err)
    }
    mention.removeQuery()
  }
  else {
    mention.selectEntry(entry)
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
  if (!hasText && !hasAttachments)
    return
  if (isStreaming.value) {
    queueMessage()
    return
  }
  emit('send', serializeForSend(text.value), [...attachments.value])
  autoResize()
}

function queueMessage() {
  const hasText = text.value.trim().length > 0
  const hasAttachments = attachments.value.length > 0
  if ((!hasText && !hasAttachments) || !isStreaming.value)
    return
  chat.enqueueMessage(text.value, [...attachments.value])
  text.value = ''
  attachments.value = []
  autoResize()
}

async function handleCompactSession(payload: { source: 'auto' | 'manual' }) {
  await chat.compactSession(chat.activeTab.id, payload.source)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && restoreOverlay.isOpen.value) {
    e.preventDefault()
    restoreOverlay.close()
    return
  }
  if (slash.handleKeydown(e, handleSlashSelect))
    return
  if (mention.handleKeydown(e))
    return

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
    if (e.repeat)
      return
    e.preventDefault()
    if (isStreaming.value) {
      queueMessage()
    }
    else {
      submit()
    }
  }
}

function onInput(e: Event) {
  autoResize()
  slash.handleInput(e)
  mention.handleInput(e)
  syncScroll()
}

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

const canSend = computed(() => (text.value.trim().length > 0 || attachments.value.length > 0))
const hasQueuedMessages = computed(() => chat.activeTab.messageQueue.length > 0)

const hasPermissionPrompt = computed(() => chat.activeTab.pendingPermissions.length > 0)
const hasQuestions = computed(() => !!chat.activeTab.pendingQuestions)
const hasTodos = computed(() => chat.activeTab.todos.length > 0)
const todosAllDone = computed(() => hasTodos.value && chat.activeTab.todos.every(t => t.status === 'completed'))
const showTodos = computed(() => hasTodos.value && !todosAllDone.value && !hasPermissionPrompt.value && !hasQuestions.value && !mention.isOpen.value && !slash.isOpen.value)

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
  isDragging.value
    ? 'border-[var(--color-accent)] shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]'
    : (focused.value || isStreaming.value) ? 'border-(--color-accent-dim)' : 'border-(--color-border-bright)',
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

const btnTransition = '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]'

const uploadBtnClasses = [
  'flex items-center justify-center w-[30px] h-[30px] border border-transparent rounded-(--radius-md)',
  'bg-transparent text-(--color-text-primary) cursor-pointer shrink-0',
  btnTransition,
  'hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg) hover:text-(--color-text-secondary)',
  'active:scale-[0.97] active:duration-[80ms]',
  'disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none',
].join(' ')

const micBtnClasses = [
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
  <div
    ref="inputRootRef"
    class="chat-input-root relative w-full flex flex-col overflow-visible"
    @dragover="handleDomDragOver"
    @drop="handleDomDrop"
  >
    <Transition v-bind="overlayTransitions">
      <PermissionOverlay v-if="hasPermissionPrompt" />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <QuestionOverlay v-if="hasQuestions && !hasPermissionPrompt" />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <AtMentionOverlay
        v-if="mention.isOpen.value && !hasQuestions && !hasPermissionPrompt && !restoreOverlay.isOpen.value"
        :entries="mention.filteredEntries.value"
        :selected-idx="mention.selectedIdx.value"
        :loading="mention.loading.value"
        :query="mention.atQuery.value"
        :header-label="mode === 'design' ? 'Link a design' : 'Link file or folder'"
        @select="handleMentionSelect"
        @hover="mention.setSelectedIdx($event)"
        @close="mention.close()"
      />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <SlashCommandOverlay
        v-if="slash.isOpen.value && !hasQuestions && !hasPermissionPrompt && !restoreOverlay.isOpen.value"
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
      <RestoreOverlay
        v-if="restoreOverlay.isOpen.value"
        :checkpoints="restoreOverlay.checkpoints.value"
        :loading="restoreOverlay.loading.value"
        :expanded-id="restoreOverlay.expandedId.value"
        :file-diffs="restoreOverlay.fileDiffs.value"
        :loading-diffs="restoreOverlay.loadingDiffs.value"
        :selected-mode="restoreOverlay.selectedMode.value"
        @close="restoreOverlay.close()"
        @toggle="restoreOverlay.toggleCheckpoint($event)"
        @restore="restoreOverlay.restore($event)"
        @update:mode="restoreOverlay.setMode($event)"
      />
    </Transition>
    <Transition v-bind="overlayTransitions">
      <TodoOverlay v-if="showTodos && !restoreOverlay.isOpen.value" />
    </Transition>

    <Transition v-bind="overlayTransitions">
      <VoiceOverlay
        v-if="voiceOverlayOpen"
        :frequency-data="voice.frequencyData.value"
        :duration="voice.duration.value"
        :transcribing="voiceTranscribing"
        :error="voiceError"
        :uploading-file-name="voiceUploadingFile ?? ''"
        :streaming-transcript="streamingTranscript"
        @stop="stopVoiceRecording"
        @cancel="cancelVoiceRecording"
        @pause="pauseVoiceRecording"
        @upload="handleVoiceUpload"
      />
    </Transition>

    <Transition v-bind="overlayTransitions">
      <DragOverlay v-if="isDragging" :previews="dragPreviews" :reading="isReading" />
    </Transition>

    <!-- Drag vision warning: image dragged over text-only model -->
    <Transition v-bind="overlayTransitions">
      <div
        v-if="showDragVisionWarning"
        class="flex items-center gap-2 rounded-(--radius-md) border border-[color-mix(in_srgb,var(--color-warning,#f59e0b)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning,#f59e0b)_12%,transparent)] px-3 py-2 mb-2"
      >
        <AlertTriangle :size="13" :stroke-width="2" class="shrink-0 text-[var(--color-warning,#f59e0b)]" />
        <span class="text-[12px] leading-tight text-(--color-text-secondary)">This model doesn’t support images — drop will still attach, but image will be sent as text fallback. Switch to a vision model (<Eye :size="11" :stroke-width="2" class="inline align-[-1px] text-(--color-info-text)" />) for analysis.</span>
      </div>
    </Transition>

    <!-- Attached vision warning: images present for non-vision model -->
    <Transition v-bind="overlayTransitions">
      <div
        v-if="showVisionWarning && !isDragging"
        class="flex items-center gap-2 rounded-(--radius-md) border border-[color-mix(in_srgb,var(--color-warning,#f59e0b)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning,#f59e0b)_10%,transparent)] px-3 py-2 mb-2"
      >
        <AlertTriangle :size="13" :stroke-width="2" class="shrink-0 text-[var(--color-warning,#f59e0b)]" />
        <span class="text-[12px] leading-tight text-(--color-text-secondary)">Images attached — current model doesn’t support vision. They’ll be sent as text context (image not analyzed). Use the model picker to switch to a vision model.</span>
      </div>
    </Transition>

    <div :class="shellClasses">
      <div
        v-if="isStreaming"
        class="box-border absolute -inset-px rounded-[inherit] p-px pointer-events-none z-10 overflow-hidden"
        style="mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; -webkit-mask-composite: xor;"
      >
        <div class="absolute top-1/2 left-1/2 w-[300%] aspect-square -translate-x-1/2 -translate-y-1/2">
          <div class="w-full h-full animate-[spin_2.5s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0%,transparent_75%,var(--color-accent)_95%,var(--color-accent-bright)_100%)]" />
        </div>
      </div>

      <div
        class="relative w-full flex"
        style="mask-image: linear-gradient(to bottom, transparent, black 12px); -webkit-mask-image: linear-gradient(to bottom, transparent, black 12px);"
      >
        <div ref="backdropRef" :class="backdropClasses" aria-hidden="true">
          <span v-if="!text" class="text-(--color-text-tertiary)">
            {{ 'Ask anything\u2026 (@ to link files)' }}
          </span>
          <template v-else>
            <template v-for="part in parsedParts" :key="part.display">
              <span>{{ part.display }}</span>
            </template>
            <br v-if="text.endsWith('\n')">
          </template>
        </div>

        <textarea
          ref="textareaRef"
          v-model="text"
          :class="fieldClasses"
          rows="1"
          spellcheck="false"
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

      <MessageQueue v-if="hasQueuedMessages" />

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

        <button
          v-if="settings.showSttMic"
          :class="micBtnClasses"
          aria-label="Voice input"
          :disabled="isStreaming || voiceTranscribing"
          @click="startVoiceRecording"
        >
          <Mic :size="14" :stroke-width="2" />
        </button>

        <PermissionModePicker :is-plan-mode="chat.activeTab.mode === 'plan'" :compact="compactToolbar" />

        <ProjectPicker v-if="props.showProjectPicker !== false" :compact="compactToolbar" />

        <div class="flex-1" />

        <div class="flex items-center gap-2 shrink-0">
          <ChatInputEstimator
            v-if="showEstimator"
            :text="text"
            mode="build"
            :attachments="attachments"
            @compact-session="handleCompactSession"
          />
          <ModelPicker />
          <button
            v-if="isStreaming && !canSend"
            :class="stopBtnClasses"
            aria-label="Stop generation"
            @click="$emit('stop')"
          >
            <Square :size="11" :stroke-width="0" style="fill: currentColor" />
          </button>
          <button
            v-else-if="isStreaming"
            :class="sendBtnClasses"
            aria-label="Add to queue"
            :disabled="!canSend"
            @click="submit"
          >
            <ListPlus :size="15" :stroke-width="2" />
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
