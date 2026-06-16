<script setup lang="ts">
import type { CommandEntry } from '@/composables/useSlashCommand'
import type { Attachment } from '@/stores/chat/attachment-types'
import { ArrowUp, ChevronDown, GitBranch, Hand, HandFist, Plus, Square, Terminal } from 'lucide-vue-next'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useAtMention } from '@/composables/useAtMention'
import { useSlashCommand } from '@/composables/useSlashCommand'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/attachment-types'
import { canChangeWorkspace, resolveTabWorkspacePath } from '@/stores/chat/workspace'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import { openFileDialog, readFileAsAttachment } from '@/utils/attachments'
import { commandTasks } from '@/utils/tools/shell'
import AtMentionDropdown from './AtMentionDropdown.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import AttachmentStrip from './AttachmentStrip.vue'
import BackgroundTasksPopup from './BackgroundTasksPopup.vue'
import ChatInputEstimator from './ChatInputEstimator.vue'
import ModelPicker from './ModelPicker.vue'
import PermissionOverlay from './PermissionOverlay.vue'
import QuestionOverlay from './QuestionOverlay.vue'
import SlashCommandDropdown from './SlashCommandDropdown.vue'
import TodoOverlay from './TodoOverlay.vue'
import WorktreePicker from './WorktreePicker.vue'

const props = defineProps<{
  isStreaming?: boolean
}>()
const emit = defineEmits<{
  send: [value: string, attachments: Attachment[]]
  stop: []
}>()

const project = useProjectStore()
const settings = useSettingsStore()
const chat = useChatStore()
const projectPath = computed(() => resolveTabWorkspacePath(chat.activeTab, project.projectPath))

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
const slash = useSlashCommand(textareaRef, text, projectPath)

const workspacePickerOpen = ref(false)
const bgTasksOpen = ref(false)
const runningTaskCount = computed(() => commandTasks.value.filter(t => t.status === 'running').length)
const showWorkspaceButton = computed(() => canChangeWorkspace(chat.activeTab) && !!projectPath.value)
const activeWorkspaceLabel = computed(() => {
  const path = projectPath.value
  if (!path)
    return ''
  return chat.activeTab.workspaceMeta?.label ?? path.replace(/[\\/]+$/, '').split(/[/\\]/).pop() ?? path
})
const activeWorkspaceDirty = computed(() => Boolean(chat.activeTab.workspaceMeta && !chat.activeTab.workspaceMeta.isClean))

async function handleWorkspaceSelect(path: string) {
  const { inspectWorkspace } = await import('@/utils/worktrees')
  const snapshot = await inspectWorkspace(path)
  chat.setTabWorkspace(chat.activeTab.id, {
    workspacePath: path,
    workspaceMeta: snapshot,
  })
  project.setProject(path)
  workspacePickerOpen.value = false
}

const INIT_PROMPT = `Analyse this repository and generate or update \`AGENTS.md\` at the project root.

The goal is a compact, high-signal instruction file that helps future AI agent sessions ramp up quickly and avoid common mistakes. Every sentence should answer: "Would an agent likely get this wrong without being told?" If not, leave it out.

## How to investigate

Work through the highest-value sources first:
- Root README, manifests (package.json, Cargo.toml, pyproject.toml, go.mod, build.gradle, etc.), workspace config, lockfiles
- Build, test, lint, formatter, typecheck, and codegen config
- CI workflows (.github/workflows/, .gitlab-ci.yml, Makefile, Taskfile, etc.) and pre-commit / task-runner config
- Any existing instruction files: AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md
- A small number of representative source files to understand how the system is wired together — prefer entrypoints, routers, and bootstrap files over random leaf files

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source.

## What to extract

Capture only the facts that require reading multiple files to infer:

**Commands**
- Exact commands for: dev server, build, test (full suite and single test), lint, typecheck, format, codegen, database migrations, deploy
- Non-obvious flags, required environment variables, or setup steps that must happen first
- Required ordering when it matters: e.g. "always run lint before typecheck before test"

**Architecture**
- Monorepo or multi-package structure: which directories own which concerns, real app entrypoints
- How the major pieces connect: API layer, data layer, background jobs, frontend/backend split
- Any generated code, build artifacts, or files that must never be edited by hand

**Toolchain & framework quirks**
- Non-default framework conventions or config that differ from what an agent would assume
- Special environment loading (dotenv files, secret managers, feature flags)
- Codegen or migration workflows that must be run after schema/model changes

**Testing**
- How to run a single test or a single package in isolation
- Required services, fixtures, or databases before tests can run
- Expensive, flaky, or integration-only test suites — and how to skip them during dev

**Style & conventions**
- Linting and formatting rules that differ from the language default (e.g. no semicolons, tabs vs spaces, import order)
- Naming conventions, file structure expectations, or PR/commit conventions worth preserving

## Questions

Only ask the user questions if the repository genuinely cannot answer something important. Use the questions tool for a single short batch at most.

Good reasons to ask:
- Undocumented team conventions or branch/PR/release expectations
- Missing setup steps or test prerequisites that are known but not written anywhere

Do not ask about anything the repository already makes clear.

## Writing rules

- Use short sections and bullet points — keep it scannable
- Include exact commands, not paraphrases
- Architecture notes should explain non-obvious wiring, not describe what files exist
- Omit generic advice, tutorials, exhaustive file trees, and anything speculative
- If the repo is simple, keep the file simple. If it is large, summarise the few structural facts that actually change how an agent should work

If \`AGENTS.md\` already exists at the root, improve it in place. Preserve verified, useful guidance. Remove fluff, stale claims, and anything contradicted by the current codebase. Reconcile it with what you actually find.\
`

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

// ── Mentions syntax highlighting backdrop ─────────────────────────────────
interface MsgPart { type: 'text' | 'mention' | 'skill'; value: string }

function splitMentions(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  if (!text)
    return parts
  const regex = /@\[([\w./\-]+)\]|\[skill:[^\]]+\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const type = match[0].startsWith('@[') ? 'mention' : 'skill'
    parts.push({ type, value: match[0] })
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

async function handleCompactSession(payload: { source: 'auto' | 'manual' }) {
  await chat.compactSession(chat.activeTab.id, payload.source)
}

function onKeydown(e: KeyboardEvent) {
  if (slash.handleKeydown(e, handleSlashSelect))
    return
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
  slash.handleInput(e)
  mention.handleInput(e)
  syncScroll()
}

const canSend = computed(() => (text.value.trim().length > 0 || attachments.value.length > 0) && !props.isStreaming)

const hasPermissionPrompt = computed(() => chat.activeTab.pendingPermissions.length > 0)
const hasQuestions = computed(() => !!chat.activeTab.pendingQuestions)
const hasTodos = computed(() => chat.activeTab.todos.length > 0)
const showTodos = computed(() => hasTodos.value && !hasPermissionPrompt.value && !hasQuestions.value && !mention.isOpen.value && !slash.isOpen.value)

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

watch(
  () => [chat.activeTab.id, props.isStreaming],
  () => {
    if (props.isStreaming)
      workspacePickerOpen.value = false
  },
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
      <SlashCommandDropdown
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
              <span v-else-if="part.type === 'skill'" class="backdrop-skill">{{ part.value }}</span>
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
        >
          <Plus :size="14" :stroke-width="2" />
        </button>

        <!-- Permission mode toggle -->
        <div class="perm-picker-wrap">
          <div v-if="chat.activeTab.mode === 'plan'" class="plan-mode-chip">
            <span>Plan Mode</span>
          </div>
          <button
            class="perm-btn"
            :class="[
              permOpen ? 'perm-btn--open' : '',
              `perm-btn--${settings.agent.permissionMode}`,
            ]"
            aria-label="Permission mode"
            @click="togglePerm"
          >
            <component :is="settings.agent.permissionMode === 'auto' ? HandFist : Hand" :size="12" :stroke-width="2" />
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
                class="perm-option perm-option--ask"
                :class="{ 'perm-option--active': settings.agent.permissionMode === 'ask' }"
                @click="selectPerm('ask')"
              >
                <Hand :size="13" :stroke-width="2" />
                <span>Ask Permission</span>
              </button>
              <button
                class="perm-option perm-option--auto"
                :class="{ 'perm-option--active': settings.agent.permissionMode === 'auto' }"
                @click="selectPerm('auto')"
              >
                <HandFist :size="13" :stroke-width="2" />
                <span>Yolo</span>
              </button>
            </div>
          </Transition>
          <div v-if="permOpen" class="perm-backdrop" @click="permOpen = false" />
        </div>

        <WorktreePicker
          v-if="workspacePickerOpen"
          :project-path="projectPath"
          :selected-path="chat.activeTab.workspacePath ?? projectPath"
          @select="handleWorkspaceSelect"
          @close="workspacePickerOpen = false"
        />

        <div class="tool-spacer" />

        <div class="toolbar-right">
          <ChatInputEstimator
            :text="text"
            mode="build"
            :attachments="attachments"
            @compact-session="handleCompactSession"
          />
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
    </div>
    <div v-if="showWorkspaceButton || runningTaskCount > 0" class="input-extender">
      <button
        v-if="showWorkspaceButton"
        class="extender-workspace-btn"
        :class="{ 'extender-workspace-btn--dirty': activeWorkspaceDirty, 'extender-workspace-btn--disabled': props.isStreaming }"
        aria-label="Choose worktree"
        :disabled="props.isStreaming"
        @click="workspacePickerOpen = true"
      >
        <GitBranch :size="13" :stroke-width="2" />
        <span v-if="activeWorkspaceLabel" class="workspace-name">{{ activeWorkspaceLabel }}</span>
      </button>

      <button
        v-if="runningTaskCount > 0"
        class="extender-bg-btn"
        aria-label="Background commands"
        @click="bgTasksOpen = !bgTasksOpen"
      >
        <Terminal :size="12" :stroke-width="2" />
        <span>{{ runningTaskCount }} BG command{{ runningTaskCount !== 1 ? 's' : '' }} running</span>
      </button>
    </div>

    <BackgroundTasksPopup v-if="bgTasksOpen" @close="bgTasksOpen = false" />

    <AttachmentPreview v-if="previewAttachment" :attachment="previewAttachment" @close="previewAttachment = null" />
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
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  transition: border-color 120ms ease;
  overflow: visible;
}
.input-extender {
  width: calc(100% - 24px);
  height: 35px;
  margin: 0 auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-top: none;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  display: flex;
  align-items: center;
  padding: 0 10px;
}
.extender-workspace-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 500;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.extender-workspace-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
}
.extender-workspace-btn:active {
  transform: scale(0.97);
  transition-duration: 80ms;
}
.extender-workspace-btn--dirty {
  color: var(--color-accent-text);
}
.extender-workspace-btn--disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
.extender-bg-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-accent-text);
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 500;
  margin-left: auto;
  transition: all 100ms ease;
}
.extender-bg-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  border-color: var(--color-accent-dim);
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
  border-radius: var(--radius-xs);
  border: 1px solid var(--color-accent-dim);
  padding: 0 4px;
  /*
    Negative margin zeroes out the physical width of the padding and border
    so the caret in the invisible textarea stays perfectly aligned!
  */
  margin: 0 -5px;
}

.backdrop-skill {
  color: var(--color-success-text);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  border-radius: var(--radius-xs);
  border: 1px solid color-mix(in srgb, var(--color-success) 28%, transparent);
  padding: 0 4px;
  margin: 0 -5px;
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
  color: var(--color-text-primary);
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
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.upload-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
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

.workspace-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms cubic-bezier(0.4, 0, 0.2, 1);
}

.workspace-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
}

.workspace-btn--dirty {
  color: var(--color-accent-text);
}

.workspace-name {
  font-size: 12px;
  font-weight: 600;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    color 120ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.action-btn:hover {
  border-radius: var(--radius-lg);
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

/* ── Permission mode picker ────────────────────────────────────────────────── */
.perm-picker-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan-mode-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  color: var(--color-accent);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.perm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding-inline: 10px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
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
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
  border-radius: var(--radius-lg);
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
  min-width: 148px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 12px 28px rgba(0, 0, 0, 0.35);
  padding: 4px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.perm-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
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
  background: var(--color-state-hover);
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

.perm-option--auto.perm-option--active {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  border-color: var(--color-danger);
  color: var(--color-text-primary);
}

.perm-option--auto.perm-option--active:hover {
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  border-color: var(--color-danger);
}

.perm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

.perm-dd-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.perm-dd-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 100ms cubic-bezier(0.7, 0, 0.84, 0);
}

.perm-dd-enter-from,
.perm-dd-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.96);
  transform-origin: bottom center;
}

.perm-dd-enter-to,
.perm-dd-leave-from {
  opacity: 1;
  transform: translateX(-50%);
  transform-origin: bottom center;
}
</style>
