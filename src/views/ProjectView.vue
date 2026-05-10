<script setup lang="ts">
import { SquarePlus } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import FileContent from '@/components/project/FileContent.vue'
import FileTree from '@/components/project/FileTree.vue'
import ScaffoldModal from '@/components/scaffold/ScaffoldModal.vue'
import { useFileTreeStore } from '@/stores/fileTree'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const ft = useFileTreeStore()
const { projectPath, projectName } = storeToRefs(project)

const scaffoldOpen = ref(false)

async function handleScaffoldSuccess(payload: { projectPath: string; templateId: string }) {
  scaffoldOpen.value = false
  if (payload.projectPath)
    await project.setProject(payload.projectPath)
}

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
const SPLIT_DEFAULT = 30

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
          <button
            class="panel-action"
            aria-label="Create new project"
            title="Scaffold new project"
            @click="scaffoldOpen = true"
          >
            <SquarePlus :size="13" :stroke-width="1.8" />
          </button>
        </div>
        <div class="panel-body">
          <FileTree />
        </div>
      </div>

      <!-- drag handle (Cleaned up, no inner line needed) -->
      <div
        class="split-handle"
        :class="{ 'split-handle--active': dragging }"
        @mousedown="onDragStart"
      />

      <!-- right: file content -->
      <div class="split-panel split-panel--right">
        <FileContent />
      </div>
    </div>

    <ScaffoldModal
      v-if="scaffoldOpen"
      @close="scaffoldOpen = false"
      @success="handleScaffoldSuccess"
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

.panel-action {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.panel-action:hover {
  background: var(--color-bg-hover);
  color: var(--color-accent-text);
}

.panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── drag handle (Fixed) ─────────────────────────────────────────────────────── */
.split-handle {
  position: relative;
  width: 1px; /* Visual width is exactly 1px for a clean look */
  background: var(--color-border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 10;
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

/* Invisible expanded hit area so it's easy to grab with the mouse */
.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
  z-index: 11;
}

/* Hover and active dragging states */
.split-handle:hover,
.split-handle--active {
  background: var(--color-accent, #10b981); /* Green accent highlight */
  /* Adds a tiny glow to make the 1px line feel more substantial when dragging */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent, #10b981) 20%, transparent);
}
</style>
