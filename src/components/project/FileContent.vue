<script setup lang="ts">
import { File, Loader } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useFileTreeStore } from '@/stores/fileTree'
import { getHighlighter, langFromPath } from '@/utils/highlighter'

const ft = useFileTreeStore()
const { selectedPath, fileContent, loadingFile, error } = storeToRefs(ft)

function clearSelection() {
  selectedPath.value = null
  fileContent.value = null
}

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
  <div class="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)]" @click.self="clearSelection">
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

    <!-- ── file content ────────────────────────────────────────────── -->
    <template v-else-if="highlighted">
      <!-- header / breadcrumb -->
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
      </div>

      <!-- code area -->
      <div class="flex-1 overflow-auto py-[8px]">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="min-w-max" v-html="highlighted" />
      </div>
    </template>
  </div>
</template>

<style scoped>
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
  color: var(--color-border-mid);
  font-size: 12px;
  user-select: none;
  white-space: nowrap;
  position: sticky;
  left: 0;
  background: var(--color-bg-base);
  vertical-align: top;
}

:deep(.shiki .line:hover::before) {
  color: var(--color-text-dim);
  background: var(--color-bg-hover);
}

:deep(.shiki .line:hover) {
  background: var(--color-bg-hover);
}
</style>
