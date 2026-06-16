<script setup lang="ts">
import type { WorktreeEntry } from '@/utils/worktrees'
import { Check, GitBranch, LoaderCircle, Search, TriangleAlert } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  projectPath: string | null
  selectedPath: string | null
}>()

const emit = defineEmits<{
  select: [path: string]
  close: []
}>()

const loading = ref(false)
const error = ref('')
const entries = ref<WorktreeEntry[]>([])
const searchQuery = ref('')

const selectedKey = computed(() => (props.selectedPath ?? props.projectPath ?? '').toLowerCase())

const filteredEntries = computed(() => {
  if (!searchQuery.value)
    return entries.value
  const query = searchQuery.value.toLowerCase()
  return entries.value.filter(e =>
    e.label.toLowerCase().includes(query)
    || e.path.toLowerCase().includes(query),
  )
})

async function loadWorktrees() {
  if (!props.projectPath) {
    entries.value = []
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''

  try {
    const { listWorktrees } = await import('@/utils/worktrees')
    const result = await listWorktrees(props.projectPath)
    entries.value = result?.entries ?? []
    error.value = result?.error ?? ''
  }
  catch (err) {
    entries.value = []
    error.value = err instanceof Error ? err.message : 'Failed to load branches.'
  }
  finally {
    loading.value = false
  }
}

function selectEntry(path: string) {
  emit('select', path)
}

const pickerPos = ref({ x: 0, y: 0 })

function updatePos() {
  const btn = document.querySelector('.extender-workspace-btn')
  if (btn) {
    const rect = btn.getBoundingClientRect()
    pickerPos.value = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top - 8),
    }
  }
}

onMounted(() => {
  updatePos()
  window.addEventListener('resize', updatePos)
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePos)
})

watch(() => props.projectPath, loadWorktrees, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" appear>
      <div class="worktree-backdrop" @click="emit('close')" />
    </Transition>

    <Transition name="picker" appear>
      <div
        class="worktree-picker"
        :style="{ left: `${pickerPos.x}px`, top: `${pickerPos.y}px` }"
      >
        <div class="wt-search">
          <div class="wt-search-wrap">
            <Search :size="13" :stroke-width="2" class="wt-search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              class="wt-search-input"
              placeholder="Search branches…"
              autocomplete="off"
              spellcheck="false"
              autofocus
            >
          </div>
        </div>

        <div v-if="error" class="wt-empty">
          <span class="wt-empty-icon wt-empty-icon--warn">
            <TriangleAlert :size="18" :stroke-width="1.5" />
          </span>
          <p class="wt-empty-title">
            Error loading branches
          </p>
          <p class="wt-empty-hint">
            {{ error }}
          </p>
        </div>

        <div v-else-if="loading && entries.length === 0" class="wt-empty">
          <span class="wt-empty-icon">
            <LoaderCircle :size="18" :stroke-width="1.5" class="spin" />
          </span>
          <p class="wt-empty-title">
            Inspecting branches…
          </p>
        </div>

        <div v-else-if="filteredEntries.length === 0" class="wt-empty">
          <span class="wt-empty-icon">
            <GitBranch :size="18" :stroke-width="1.5" />
          </span>
          <p class="wt-empty-title">
            No branches found
          </p>
          <p class="wt-empty-hint">
            No branches matched your search.
          </p>
        </div>

        <div v-else class="wt-list">
          <button
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="wt-item"
            :class="{ 'wt-item--active': entry.path.toLowerCase() === selectedKey }"
            type="button"
            @click="selectEntry(entry.path)"
          >
            <GitBranch :size="15" :stroke-width="1.5" class="wt-item-icon" />
            <span class="wt-item-name">{{ entry.label }}</span>
            <Check v-if="entry.path.toLowerCase() === selectedKey" :size="15" :stroke-width="1.5" class="wt-item-check" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.worktree-backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 9998;
}

.worktree-picker {
  position: fixed;
  transform: translate(-50%, -100%);
  width: min(280px, calc(100vw - 40px));
  max-height: min(380px, 60vh);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  overflow: hidden;
  z-index: 9999;
}

/* ── Search ─────────────────────────────────────────────────────────────── */
.wt-search {
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.wt-search-wrap {
  position: relative;
  flex: 1;
}

.wt-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.wt-search-input {
  width: 100%;
  height: 32px;
  padding-left: 30px;
  padding-right: 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.wt-search-input::placeholder {
  color: var(--color-text-dim);
}

.wt-search-input:focus {
  border-color: var(--color-accent);
  box-shadow:
    0 0 0 3px var(--color-accent-muted),
    0 0 0 1px var(--color-accent-muted-plus);
}

/* ── List ───────────────────────────────────────────────────────────────── */
.wt-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 0 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.wt-list::-webkit-scrollbar {
  width: 4px;
}
.wt-list::-webkit-scrollbar-track {
  background: transparent;
}
.wt-list::-webkit-scrollbar-thumb {
  background: var(--color-border-bright);
  border-radius: var(--radius-md);
}

/* ── Item row ───────────────────────────────────────────────────────────── */
.wt-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: 34px;
  padding-inline: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  box-sizing: border-box;
  text-align: left;
  transition:
    background 100ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 100ms cubic-bezier(0.4, 0, 0.2, 1),
    color 100ms cubic-bezier(0.4, 0, 0.2, 1);
}

.wt-item:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-subtle);
  color: var(--color-text-primary);
}

.wt-item--active {
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.wt-item--active:hover {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  border-color: var(--color-accent);
}

.wt-item-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.wt-item--active .wt-item-icon {
  color: var(--color-accent-text);
}

.wt-item-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-item-check {
  color: var(--color-accent-text);
  flex-shrink: 0;
}

/* ── Empty states ───────────────────────────────────────────────────────── */
.wt-empty {
  padding: 16px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.wt-empty-icon {
  color: var(--color-text-dim);
  margin-bottom: 2px;
  opacity: 0.6;
  display: flex;
}

.wt-empty-icon--warn {
  color: var(--color-danger-text);
  opacity: 0.8;
}

.wt-empty-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.wt-empty-hint {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* ── Spin ───────────────────────────────────────────────────────────────── */
.spin {
  animation: wt-spin 0.9s linear infinite;
}

@keyframes wt-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ── Transitions ────────────────────────────────────────────────────────── */
.picker-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.picker-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 100ms cubic-bezier(0.7, 0, 0.84, 0);
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 8px)) scale(0.96);
}
.picker-enter-to,
.picker-leave-from {
  opacity: 1;
  transform: translate(-50%, -100%) scale(1);
}

.fade-enter-active {
  transition: opacity 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-leave-active {
  transition: opacity 100ms cubic-bezier(0.7, 0, 0.84, 0);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
