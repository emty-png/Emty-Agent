<script setup lang="ts">
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { Code, ExternalLink, File, FileText, FileWarning, Loader, Pencil, Save, WrapText, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownMessage from '@/components/chat/messages/MarkdownMessage.vue'
import { useFileTabsStore } from '@/stores/fileTabs'
import { getHighlighter, langFromPath } from '@/utils/highlighter'

const fileTabs = useFileTabsStore()
const { activeTab } = storeToRefs(fileTabs)

// ── derived state from active tab ─────────────────────────────────────────────
const selectedPath = computed(() => activeTab.value?.path ?? null)
const fileContent = computed(() => activeTab.value?.content ?? null)
const fileDisplayType = computed(() => activeTab.value?.displayType ?? null)
const imageDataUrl = computed(() => activeTab.value?.imageDataUrl ?? null)
const loadingFile = computed(() => activeTab.value?.loading ?? false)
const error = computed(() => activeTab.value?.error ?? null)

// ── file type display ────────────────────────────────────────────────────────
const isImage = computed(() => fileDisplayType.value === 'image')
const isBinary = computed(() => fileDisplayType.value === 'binary')
const isSvg = computed(() => fileDisplayType.value === 'svg')

// SVG toggle: image view (default) vs code view
const showSvgImage = ref(true)

// Word wrap toggle for code view
const wordWrap = ref(true)

// When viewing image or binary, don't show the edit button
const canEdit = computed(() => !isImage.value && !isBinary.value && !(isSvg.value && showSvgImage.value))

// ── edit mode ─────────────────────────────────────────────────────────────────
const editing = ref(false)
const editText = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

function enterEdit() {
  editText.value = fileContent.value ?? ''
  editing.value = true
  nextTick(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.file-editor')
    ta?.focus()
  })
}

function cancelEdit() {
  editing.value = false
  editText.value = ''
  saveError.value = null
}

async function saveFile() {
  if (!selectedPath.value)
    return
  saving.value = true
  saveError.value = null
  try {
    await writeTextFile(selectedPath.value, editText.value)
    // Update the tab content directly
    if (activeTab.value) {
      activeTab.value.content = editText.value
    }
    editing.value = false
  }
  catch (e) {
    saveError.value = String(e)
  }
  finally {
    saving.value = false
  }
}

async function openInSystemApp() {
  if (!selectedPath.value)
    return
  await openPath(selectedPath.value)
}

// ── markdown toggle ─────────────────────────────────────────────────────────
const isMarkdown = computed(() => selectedPath.value?.toLowerCase().endsWith('.md') ?? false)
const showRendered = ref(true)

// reset edit mode and toggles when switching tabs
watch(() => activeTab.value?.id, () => {
  editing.value = false
  editText.value = ''
  saveError.value = null
  showSvgImage.value = true
  showRendered.value = true
  wordWrap.value = true
})

// ── highlighted HTML ──────────────────────────────────────────────────────────
const highlighted = ref<string | null>(null)
const highlighting = ref(false)

watch(
  [fileContent, selectedPath],
  async ([content, path]) => {
    if (!content || !path) {
      highlighted.value = null
      return
    }

    highlighting.value = true
    try {
      const hl = await getHighlighter()
      const lang = langFromPath(path)
      highlighted.value = hl.codeToHtml(content, {
        lang,
        theme: 'ember-dark',
      })
    }
    catch {
      highlighted.value = `<pre>${escapeHtml(content)}</pre>`
    }
    finally {
      highlighting.value = false
    }
  },
  { immediate: true },
)

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── breadcrumb from path ──────────────────────────────────────────────────────
function breadcrumb(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').slice(-3)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)]">
    <!-- ── empty state ─────────────────────────────────────────────── -->
    <div v-if="!selectedPath" class="flex flex-1 flex-col items-center justify-center gap-[10px] text-[var(--color-text-tertiary)]">
      <File :size="28" :stroke-width="1.3" class="opacity-40" />
      <p class="text-[12.5px] tracking-[0.01em]">
        Select a file to view its contents
      </p>
    </div>

    <!-- ── loading file ────────────────────────────────────────────── -->
    <template v-else-if="loadingFile || highlighting">
      <div class="flex h-[30px] min-h-[30px] shrink-0 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[14px]">
        <div class="flex items-center gap-[2px] overflow-hidden whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">
          <span v-for="(part, i) in breadcrumb(selectedPath)" :key="i">
            <span v-if="i > 0" class="mx-[2px] text-[var(--color-border-bright)]">/</span>
            {{ part }}
          </span>
        </div>
      </div>
      <div class="flex flex-1 items-center justify-center text-[var(--color-text-tertiary)]">
        <Loader :size="16" :stroke-width="1.8" class="animate-spin" />
      </div>
    </template>

    <!-- ── error ───────────────────────────────────────────────────── -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center p-[24px] text-center text-[12.5px] text-[var(--color-danger-text)]">
      {{ error }}
    </div>

    <!-- ── binary file placeholder ──────────────────────────────────── -->
    <template v-else-if="isBinary">
      <div class="flex h-[30px] min-h-[30px] shrink-0 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[14px]">
        <div class="flex items-center gap-[2px] overflow-hidden whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">
          <span
            v-for="(part, i) in breadcrumb(selectedPath!)"
            :key="i"
            :class="{ 'font-medium text-[var(--color-text-secondary)]': i === breadcrumb(selectedPath!).length - 1 }"
          >
            <span v-if="i > 0" class="mx-[2px] text-[var(--color-border-bright)]">/</span>
            {{ part }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-[2px]">
          <button
            class="file-action-btn"
            title="Open in system default app"
            @click="openInSystemApp"
          >
            <ExternalLink :size="12" :stroke-width="1.8" />
          </button>
        </div>
      </div>
      <div class="flex flex-1 flex-col items-center justify-center gap-[10px] text-[var(--color-text-tertiary)]">
        <FileWarning :size="32" :stroke-width="1.2" class="opacity-40" />
        <p class="text-[12.5px] tracking-[0.01em]">
          Binary file — cannot display inline
        </p>
        <button
          class="mt-[4px] flex items-center gap-[6px] rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-surface)] px-[12px] py-[6px] text-[11.5px] text-[var(--color-text-secondary)] transition-colors duration-[120ms] hover:border-[var(--color-accent-dim)] hover:text-[var(--color-text-primary)]"
          @click="openInSystemApp"
        >
          <ExternalLink :size="12" :stroke-width="1.8" />
          Open in system app
        </button>
      </div>
    </template>

    <!-- ── image display ────────────────────────────────────────────── -->
    <template v-else-if="isImage || (isSvg && showSvgImage)">
      <div class="flex h-[30px] min-h-[30px] shrink-0 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[14px]">
        <div class="flex items-center gap-[2px] overflow-hidden whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">
          <span
            v-for="(part, i) in breadcrumb(selectedPath!)"
            :key="i"
            :class="{ 'font-medium text-[var(--color-text-secondary)]': i === breadcrumb(selectedPath!).length - 1 }"
          >
            <span v-if="i > 0" class="mx-[2px] text-[var(--color-border-bright)]">/</span>
            {{ part }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-[2px]">
          <!-- SVG toggle: image <-> code -->
          <button
            v-if="isSvg"
            class="file-action-btn"
            :class="{ 'file-action-btn--active': showSvgImage }"
            :title="showSvgImage ? 'Show SVG source' : 'Show rendered SVG'"
            @click="showSvgImage = !showSvgImage"
          >
            <Code v-if="showSvgImage" :size="12" :stroke-width="1.8" />
            <FileText v-else :size="12" :stroke-width="1.8" />
          </button>
          <button
            class="file-action-btn"
            title="Open in system default app"
            @click="openInSystemApp"
          >
            <ExternalLink :size="12" :stroke-width="1.8" />
          </button>
        </div>
      </div>
      <div class="flex flex-1 overflow-auto items-center justify-center bg-[var(--color-bg-base)] p-[24px]">
        <img
          :src="imageDataUrl!"
          :alt="selectedPath!"
          class="max-w-full max-h-full object-contain"
        >
      </div>
    </template>

    <!-- ── file content (text + SVG code view) ──────────────────────── -->
    <template v-else-if="highlighted || editing">
      <!-- header / breadcrumb + actions -->
      <div class="flex h-[30px] min-h-[30px] shrink-0 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[14px]">
        <div class="flex items-center gap-[2px] overflow-hidden whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">
          <span
            v-for="(part, i) in breadcrumb(selectedPath!)"
            :key="i"
            :class="{ 'font-medium text-[var(--color-text-secondary)]': i === breadcrumb(selectedPath!).length - 1 }"
          >
            <span v-if="i > 0" class="mx-[2px] text-[var(--color-border-bright)]">/</span>
            {{ part }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-[2px]">
          <button
            v-if="isMarkdown && !editing"
            class="file-action-btn"
            :class="{ 'file-action-btn--active': showRendered }"
            :title="showRendered ? 'Show raw source' : 'Show rendered markdown'"
            @click="showRendered = !showRendered"
          >
            <Code v-if="showRendered" :size="12" :stroke-width="1.8" />
            <FileText v-else :size="12" :stroke-width="1.8" />
          </button>
          <!-- SVG toggle: code <-> image -->
          <button
            v-if="isSvg && !editing"
            class="file-action-btn"
            :class="{ 'file-action-btn--active': !showSvgImage }"
            :title="showSvgImage ? 'Show SVG source' : 'Show rendered SVG'"
            @click="showSvgImage = !showSvgImage"
          >
            <FileText v-if="showSvgImage" :size="12" :stroke-width="1.8" />
            <Code v-else :size="12" :stroke-width="1.8" />
          </button>
          <!-- word wrap toggle -->
          <button
            v-if="!editing"
            class="file-action-btn"
            :class="{ 'file-action-btn--active': wordWrap }"
            :title="wordWrap ? 'Disable word wrap' : 'Enable word wrap'"
            @click="wordWrap = !wordWrap"
          >
            <WrapText :size="12" :stroke-width="1.8" />
          </button>
          <button
            v-if="canEdit && !editing"
            class="file-action-btn"
            title="Edit file"
            @click="enterEdit"
          >
            <Pencil :size="12" :stroke-width="1.8" />
          </button>
          <template v-else-if="editing">
            <button
              class="file-action-btn"
              :class="{ 'file-action-btn--disabled': saving }"
              title="Save (Ctrl+S)"
              :disabled="saving"
              @click="saveFile"
            >
              <Loader v-if="saving" :size="12" :stroke-width="1.8" class="animate-spin" />
              <Save v-else :size="12" :stroke-width="1.8" />
            </button>
            <button
              class="file-action-btn file-action-btn--cancel"
              title="Cancel edit"
              :disabled="saving"
              @click="cancelEdit"
            >
              <X :size="12" :stroke-width="1.8" />
            </button>
          </template>
          <button
            class="file-action-btn"
            title="Open in system default app"
            @click="openInSystemApp"
          >
            <ExternalLink :size="12" :stroke-width="1.8" />
          </button>
        </div>
      </div>

      <!-- save error -->
      <div v-if="saveError" class="shrink-0 px-[14px] py-[6px] text-[11px] text-[var(--color-danger-text)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)]">
        {{ saveError }}
      </div>

      <!-- edit mode -->
      <div v-if="editing" class="flex flex-1 overflow-hidden">
        <textarea
          v-model="editText"
          class="file-editor"
          spellcheck="false"
          @keydown.ctrl.s.prevent="saveFile"
          @keydown.meta.s.prevent="saveFile"
          @keydown.esc="cancelEdit"
        />
      </div>

      <!-- rendered markdown -->
      <div v-if="isMarkdown && showRendered && !editing" class="md-view flex-1 overflow-auto px-[24px] py-[20px]">
        <MarkdownMessage :content="fileContent!" />
      </div>

      <!-- read-only code area -->
      <div v-else-if="!editing" class="raw-code-view flex-1 overflow-auto py-[8px]" :class="{ 'raw-code-view--wrap': wordWrap }">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-html="highlighted" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── raw code view: shiki overrides (line numbers, sticky gutter) ─────────── */
.raw-code-view :deep(.shiki) {
  background: transparent !important;
  margin: 0;
  padding: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  counter-reset: line;
}

.raw-code-view :deep(.shiki code) {
  display: table;
  width: 100%;
}

.raw-code-view--wrap :deep(.shiki code) {
  white-space: pre-wrap;
  word-break: break-word;
}

.raw-code-view :deep(.shiki .line) {
  display: table-row;
}

.raw-code-view :deep(.shiki .line::before) {
  counter-increment: line;
  content: counter(line);
  display: table-cell;
  width: 48px;
  min-width: 48px;
  padding-right: 20px;
  padding-left: 8px;
  text-align: right;
  color: var(--color-border-mid);
  font-size: 12px;
  user-select: none;
  white-space: nowrap;
  position: sticky;
  left: 0;
  background: var(--color-bg-base);
  vertical-align: top;
}

.raw-code-view :deep(.shiki .line:hover::before) {
  color: var(--color-text-dim);
  background: var(--color-bg-hover);
}

.raw-code-view :deep(.shiki .line:hover) {
  background: var(--color-bg-hover);
}

/* ── markdown view: code block styling ────────────────────────────────────── */

/* code block container */
.md-view :deep(.md-code-wrap) {
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  overflow: hidden;
  background: var(--color-bg-base);
  margin-bottom: 14px;
}

.md-view :deep(.md-code-wrap:last-child) {
  margin-bottom: 0;
}

/* code block header (lang label + copy button) */
.md-view :deep(.md-code-wrap > div:first-child) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
  min-height: 34px;
  gap: 8px;
}

/* shiki pre inside code blocks */
.md-view :deep(.md-code-wrap pre) {
  margin: 0;
  padding: 14px 16px;
  background: var(--color-bg-base) !important;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}

/* disable line numbers inside markdown code blocks */
.md-view :deep(.md-code-wrap .line::before) {
  display: none !important;
  counter-increment: none !important;
}

/* normal block layout for code lines (no table rows) */
.md-view :deep(.md-code-wrap .line) {
  display: block;
}

.md-view :deep(.md-code-wrap code) {
  display: block;
  width: auto;
  background: transparent;
}

/* table styling inside markdown */
.md-view :deep(.md-table-wrap) {
  overflow-x: auto;
  margin-bottom: 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.md-view :deep(.md-table-wrap:last-child) {
  margin-bottom: 0;
}

.md-view :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.md-view :deep(.md-th) {
  padding: 7px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
  white-space: nowrap;
}

.md-view :deep(.md-td) {
  padding: 7px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  vertical-align: top;
  word-break: break-word;
}

.md-view :deep(tr:last-child .md-td) {
  border-bottom: none;
}

.md-view :deep(tbody tr:hover td) {
  background: color-mix(in srgb, var(--color-bg-hover) 60%, transparent);
}

/* blockquote */
.md-view :deep(.md-bq) {
  border-left: 3px solid var(--color-accent-dim);
  margin: 0 0 14px;
  padding: 8px 16px;
  background: color-mix(in srgb, var(--color-accent-muted) 40%, transparent);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-secondary);
  font-style: italic;
}

.md-view :deep(.md-bq:last-child) {
  margin-bottom: 0;
}

/* horizontal rule */
.md-view :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--color-border-mid);
  margin: 18px 0;
}

/* headings */
.md-view :deep(.md-h) {
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-primary);
  margin-top: 20px;
  margin-bottom: 8px;
}

.md-view :deep(.md-h:first-child) {
  margin-top: 0;
}

.md-view :deep(.md-h1) {
  font-size: 1.35em;
}

.md-view :deep(.md-h2) {
  font-size: 1.2em;
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 4px;
}

.md-view :deep(.md-h3) {
  font-size: 1.05em;
}

.md-view :deep(.md-h4),
.md-view :deep(.md-h5),
.md-view :deep(.md-h6) {
  font-size: 1em;
  color: var(--color-text-secondary);
}

/* inline code */
.md-view :deep(.md-ic) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  font-size: 0.875em;
  background: var(--color-bg-elevated);
  color: var(--color-code);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-mid);
}

/* links */
.md-view :deep(.md-a) {
  color: var(--color-info-text);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 120ms ease;
}

.md-view :deep(.md-a:hover) {
  color: var(--color-text-primary);
}

/* strong / em / del */
.md-view :deep(strong) {
  font-weight: 700;
  color: var(--color-text-primary);
}

.md-view :deep(em) {
  font-style: italic;
  color: var(--color-text-secondary);
}

.md-view :deep(del) {
  text-decoration: line-through;
  color: var(--color-text-tertiary);
}

/* SVGs */
.md-view :deep(svg:not(.md-btn svg)) {
  display: block;
  max-width: 100%;
  height: auto;
  max-height: 480px;
}

/* ── action buttons ─────────────────────────────────────────────────────────── */
.file-action-btn {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.file-action-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}

.file-action-btn--active {
  color: var(--color-accent-text);
  background: var(--color-accent-muted);
}

.file-action-btn--active:hover {
  color: var(--color-accent-bright);
  background: var(--color-state-hover);
}

.file-action-btn--cancel:hover {
  color: var(--color-danger-text);
}

.file-action-btn--disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* ── editor textarea ────────────────────────────────────────────────────────── */
.file-editor {
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 8px 14px;
  background: var(--color-bg-base);
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
  overflow: auto;
}
</style>
