<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, FolderPlus } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

// ── project picker (file tree header) ────────────────────────────────────────
const pickerOpen = ref(false)
const picking = ref(false)

// design folders opened via the canvas "show code" action are not selectable projects
const selectableProjects = computed(() =>
  project.openProjects.filter(path => !project.designProjects.includes(path)),
)

function toggleProjectPicker() {
  pickerOpen.value = !pickerOpen.value
}

function closeProjectPicker() {
  pickerOpen.value = false
}

function selectProject(path: string) {
  project.setProject(path)
  closeProjectPicker()
}

async function pickNewProjectFolder() {
  if (picking.value)
    return
  picking.value = true
  try {
    const selected = await open({
      directory: true,
      recursive: true,
      multiple: false,
      title: 'Open project folder',
    })
    if (typeof selected === 'string') {
      project.addProject(selected)
      closeProjectPicker()
    }
  }
  finally {
    picking.value = false
  }
}

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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closeProjectPicker()
}

onMounted(async () => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeydown)

  if (projectPath.value)
    await ft.loadTree()
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeydown)
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
            <div class="relative">
              <button
                class="panel-header-btn"
                title="Change project"
                aria-label="Select project"
                @click="toggleProjectPicker"
              >
                <FolderOpen :size="12" :stroke-width="1.8" />
              </button>

              <div class="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-[10000]">
                <Transition
                  enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top"
                  enter-from-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
                  enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
                  leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-top"
                  leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
                  leave-to-class="opacity-0 [transform:translateY(-8px)_scale(0.96)]"
                >
                  <div v-if="pickerOpen" class="pp-menu">
                    <button
                      class="pp-item pp-item--new"
                      :disabled="picking"
                      @click="pickNewProjectFolder"
                    >
                      <FolderPlus :size="13" :stroke-width="1.8" class="shrink-0" />
                      <span>New Project</span>
                    </button>

                    <template v-if="selectableProjects.length > 0">
                      <div class="pp-divider" />
                      <button
                        v-for="path in selectableProjects"
                        :key="path"
                        class="pp-item"
                        :class="{ 'pp-item--active': project.projectPath === path }"
                        @click="selectProject(path)"
                      >
                        <FolderOpen :size="13" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-tertiary)]" />
                        <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() }}</span>
                      </button>
                    </template>
                  </div>
                </Transition>
              </div>
            </div>
            <button
              v-if="ft.tree.length > 0 && !project.isDesignProject"
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

    <!-- ── project picker backdrop ─────────────────────────────────── -->
    <div v-if="pickerOpen" class="fixed inset-0 z-[9999]" @click="closeProjectPicker" />

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
  overflow: visible;
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

/* ── project picker menu ─────────────────────────────────────────────────────── */
.pp-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 210px;
  padding: 4px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 12px 28px rgba(0, 0, 0, 0.35);
}

.pp-divider {
  height: 1px;
  margin: 2px 4px;
  background: var(--color-border-mid);
}

.pp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding-inline: 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.pp-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.pp-item--active {
  background: var(--color-accent-muted-plus);
  color: var(--color-text-primary);
}

.pp-item--new {
  color: var(--color-accent-text);
}

.pp-item--new:hover {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent-text);
}

.pp-item:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
