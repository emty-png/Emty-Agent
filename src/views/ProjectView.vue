<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import FileContent from '@/components/project/FileContent.vue'
import FileTree from '@/components/project/FileTree.vue'
import { useFileTreeStore } from '@/stores/fileTree'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const ft = useFileTreeStore()
const { projectPath, projectName } = storeToRefs(project)

// ── load tree when project changes ───────────────────────────────────────────
// fires when the user picks a NEW folder mid-session
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
const SPLIT_DEFAULT = 38

const splitPercent = ref(SPLIT_DEFAULT)
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

  // persistence has rehydrated by the time onMounted runs —
  // load the tree if a project path was already saved
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
        </div>
        <div class="panel-body">
          <FileTree />
        </div>
      </div>

      <!-- drag handle -->
      <div
        class="split-handle"
        :class="{ 'split-handle--active': dragging }"
        @mousedown="onDragStart"
      >
        <div class="split-handle-line" />
      </div>

      <!-- right: file content -->
      <div class="split-panel split-panel--right">
        <FileContent />
      </div>
    </div>
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
  color: var(--color-ember-dim);
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
  /* prevent text selection while dragging */
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
  border-right: none; /* handle owns the border */
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

.panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── drag handle ─────────────────────────────────────────────────────────────── */
.split-handle {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 5px;
  min-width: 5px;
  cursor: col-resize;
  flex-shrink: 0;
  background: transparent;
  position: relative;
  z-index: 10;
  transition: background 120ms ease;
}

.split-handle:hover,
.split-handle--active {
  background: var(--color-ember-glow);
}

.split-handle-line {
  width: 1px;
  background: var(--color-border-subtle);
  transition: background 120ms ease;
  align-self: stretch;
}

.split-handle:hover .split-handle-line,
.split-handle--active .split-handle-line {
  background: var(--color-ember-dim);
}
</style>
