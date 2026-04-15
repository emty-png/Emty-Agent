<script setup lang="ts">
import { File, Loader } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useFileTreeStore } from '@/stores/fileTree'
import { getHighlighter, langFromPath } from '@/utils/highlighter'

const ft = useFileTreeStore()
const { selectedPath, fileContent, loadingFile, error } = storeToRefs(ft)

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
      // fallback: wrap in pre as plain text
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
  <div class="content-root">
    <!-- ── empty state ─────────────────────────────────────────────── -->
    <div v-if="!selectedPath" class="content-empty">
      <File :size="28" :stroke-width="1.3" class="empty-icon" />
      <p class="empty-label">
        Select a file to view its contents
      </p>
    </div>

    <!-- ── loading file ────────────────────────────────────────────── -->
    <template v-else-if="loadingFile || highlighting">
      <div class="content-header">
        <div class="breadcrumb">
          <span v-for="(part, i) in breadcrumb(selectedPath)" :key="i" class="breadcrumb-part">
            <span v-if="i > 0" class="breadcrumb-sep">/</span>
            {{ part }}
          </span>
        </div>
      </div>
      <div class="content-loading">
        <Loader :size="16" :stroke-width="1.8" class="spin" />
      </div>
    </template>

    <!-- ── error ───────────────────────────────────────────────────── -->
    <div v-else-if="error" class="content-error">
      {{ error }}
    </div>

    <!-- ── file content ────────────────────────────────────────────── -->
    <template v-else-if="highlighted">
      <!-- header / breadcrumb -->
      <div class="content-header">
        <div class="breadcrumb">
          <span
            v-for="(part, i) in breadcrumb(selectedPath!)"
            :key="i"
            class="breadcrumb-part"
            :class="{ 'breadcrumb-part--file': i === breadcrumb(selectedPath!).length - 1 }"
          >
            <span v-if="i > 0" class="breadcrumb-sep">/</span>
            {{ part }}
          </span>
        </div>
      </div>

      <!-- code area -->
      <div class="code-scroll">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="code-wrap" v-html="highlighted" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────────── */
.content-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

/* ── empty ───────────────────────────────────────────────────────────────────── */
.content-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-tertiary);
}

.empty-icon {
  opacity: 0.4;
}

.empty-label {
  font-size: 12.5px;
  letter-spacing: 0.01em;
}

/* ── header / breadcrumb ─────────────────────────────────────────────────────── */
.content-header {
  display: flex;
  align-items: center;
  height: 30px;
  min-height: 30px;
  padding-inline: 14px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

.breadcrumb-sep {
  margin-inline: 2px;
  color: var(--color-border-bright);
}

.breadcrumb-part--file {
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* ── loading ─────────────────────────────────────────────────────────────────── */
.content-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}

/* ── error ───────────────────────────────────────────────────────────────────── */
.content-error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-size: 12.5px;
  color: var(--color-rose-text);
  text-align: center;
}

/* ── code scroll ─────────────────────────────────────────────────────────────── */
.code-scroll {
  flex: 1;
  overflow: auto;
  padding: 8px 0;
}

.code-wrap {
  min-width: max-content;
}

/* ── shiki output overrides ──────────────────────────────────────────────────── */
:deep(.shiki) {
  background: transparent !important;
  margin: 0;
  padding: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  counter-reset: line;
}

:deep(.shiki code) {
  display: table;
  width: 100%;
}

/* each line is just an inline-block — no flex, no min-height */
:deep(.shiki .line) {
  display: table-row;
}

/* line number cell */
:deep(.shiki .line::before) {
  counter-increment: line;
  content: counter(line);
  display: table-cell;
  width: 48px;
  min-width: 48px;
  padding-right: 20px;
  padding-left: 8px;
  text-align: right;
  color: #2e2618;
  font-size: 12px;
  user-select: none;
  white-space: nowrap;
  position: sticky;
  left: 0;
  background: var(--color-bg-base);
  vertical-align: top;
}

:deep(.shiki .line:hover::before) {
  color: #504438;
}

:deep(.shiki .line:hover) {
  background: #111009;
}

/* spinner */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
