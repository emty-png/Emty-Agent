<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import FileContent from '@/components/project/FileContent.vue'
import FileFuzzyFinder from '@/components/project/FileFuzzyFinder.vue'
import FileTabBar from '@/components/project/FileTabBar.vue'
import FileTree from '@/components/project/FileTree.vue'
import { useFileFuzzyFinder } from '@/composables/file/useFileFuzzyFinder'
import { useFileTabsStore } from '@/stores/fileTabs'
import { useFileTreeStore } from '@/stores/fileTree'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const ft = useFileTreeStore()
const fileTabs = useFileTabsStore()
const { projectPath, projectName, splitPercent } = storeToRefs(project)
const { tabs } = storeToRefs(fileTabs)

const fuzzyFinder = useFileFuzzyFinder()
const showCreateDialog = ref(false)

// ── load tree when project changes ───────────────────────────────────────────
watch(projectPath, async (newPath, oldPath) => {
  if (newPath === oldPath)
    return
  ft.reset()
  if (newPath)
    await ft.loadTree()
})

// ── resizable split ───────────────────────────────────────────────────────────
const SPLIT_MIN = 18 // %
const SPLIT_MAX = 60 // %

const containerRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

function onDragStart(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value || !containerRef.value)
    return
  const rect = containerRef.value.getBoundingClientRect()
  const raw = ((e.clientX - rect.left) / rect.width) * 100
  splitPercent.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, raw))
}

function onMouseUp() {
  dragging.value = false
}

onMounted(async () => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)

  if (projectPath.value)
    await ft.loadTree()
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div class="project-root">
    <!-- ── no project open ─────────────────────────────────────────── -->
    <div v-if="!projectPath" class="project-empty">
      <div class="project-empty-icon">
        ⬡
      </div>
      <p class="project-empty-title">
        No project open
      </p>
      <p class="project-empty-sub">
        Click the folder icon in the title bar to open a project
      </p>
    </div>

    <!-- ── split view ──────────────────────────────────────────────── -->
    <div v-else ref="containerRef" class="split" :class="{ 'split--dragging': dragging }">
      <!-- left: file tree -->
      <div class="split-panel split-panel--left" :style="{ width: `${splitPercent}%` }">
        <div class="panel-header">
          <span class="panel-title">{{ projectName }}</span>
          <div class="ml-auto flex items-center gap-[2px]">
            <button
              v-if="ft.tree.length > 0"
              class="panel-header-btn"
              title="New file or folder"
              @click="showCreateDialog = true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            </button>
            <button
              v-if="ft.tree.length > 0"
              class="panel-header-btn"
              title="Collapse all folders"
              @click="ft.collapseAll()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
            </button>
          </div>
        </div>
        <div class="panel-body">
          <FileTree v-model:show-create-dialog="showCreateDialog" />
        </div>
      </div>

      <!-- drag handle -->
      <div
        class="split-handle"
        :class="{ 'split-handle--active': dragging }"
        @mousedown="onDragStart"
      />

      <!-- right: file content -->
      <div class="split-panel split-panel--right">
        <FileTabBar v-if="tabs.length > 0" />
        <FileContent />
      </div>
    </div>

    <!-- ── fuzzy finder overlay ────────────────────────────────────── -->
    <FileFuzzyFinder
      v-if="fuzzyFinder.isOpen.value"
      :query="fuzzyFinder.query.value"
      :selected-idx="fuzzyFinder.selectedIdx.value"
      :filtered-files="fuzzyFinder.filteredFiles.value"
      @update:query="fuzzyFinder.query.value = $event"
      @select="fuzzyFinder.selectFile($event)"
      @hover="fuzzyFinder.selectedIdx.value = $event"
      @close="fuzzyFinder.close()"
      @keydown="fuzzyFinder.handleKeydown($event)"
    />
  </div>
</template>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────────── */
.project-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

/* ── empty state ─────────────────────────────────────────────────────────────── */
.project-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  text-align: center;
}

.project-empty-icon {
  font-size: 32px;
  color: var(--color-accent-dim);
  opacity: 0.5;
  margin-bottom: 4px;
  line-height: 1;
}

.project-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.project-empty-sub {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  max-width: 240px;
  line-height: 1.6;
}

/* ── split container ─────────────────────────────────────────────────────────── */
.split {
  display: flex;
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.split--dragging {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}

/* ── panels ──────────────────────────────────────────────────────────────────── */
.split-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.split-panel--left {
  background: var(--color-bg-surface);
  border-right: none;
  min-width: 160px;
}

.split-panel--right {
  flex: 1;
  min-width: 200px;
}

/* ── panel header ────────────────────────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  height: 30px;
  min-height: 30px;
  padding-inline: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-header-btn {
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

.panel-header-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}

.panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── drag handle ─────────────────────────────────────────────────────────────── */
.split-handle {
  position: relative;
  width: 1px;
  background: var(--color-border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 10;
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
  z-index: 11;
}

.split-handle:hover,
.split-handle--active {
  background: var(--color-accent, #10b981);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent, #10b981) 20%, transparent);
}
</style>
