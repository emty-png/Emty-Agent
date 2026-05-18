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
  const btn = document.querySelector('.workspace-btn')
  if (btn) {
    const rect = btn.getBoundingClientRect()
    // Math.round prevents fractional pixel placement which causes blurriness
    pickerPos.value = {
      x: Math.round(rect.left),
      y: Math.round(rect.top - 10),
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
    <!-- Render with an 'appear' transition to animate when conditionally mounted by the parent -->
    <Transition name="fade" appear>
      <div class="worktree-backdrop" @click="emit('close')" />
    </Transition>

    <Transition name="picker" appear>
      <div
        class="worktree-picker"
        :style="{ left: `${pickerPos.x}px`, top: `${pickerPos.y}px` }"
      >
        <!-- Search Header -->
        <div class="worktree-search">
          <Search :size="15" :stroke-width="1.5" class="worktree-search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            class="worktree-search-input"
            placeholder="Search branches"
            autocomplete="off"
            spellcheck="false"
            autofocus
          >
        </div>

        <div class="worktree-section">
          Branches
        </div>

        <!-- Empty/State handling -->
        <div v-if="error" class="worktree-empty">
          <span class="worktree-empty-icon worktree-empty-icon--warn">
            <TriangleAlert :size="22" :stroke-width="1.5" />
          </span>
          <p class="worktree-empty-title">
            Error loading branches
          </p>
          <p class="worktree-empty-hint">
            {{ error }}
          </p>
        </div>

        <div v-else-if="loading && entries.length === 0" class="worktree-empty">
          <span class="worktree-empty-icon">
            <LoaderCircle :size="22" :stroke-width="1.5" class="spin" />
          </span>
          <p class="worktree-empty-title">
            Inspecting branches…
          </p>
        </div>

        <div v-else-if="filteredEntries.length === 0" class="worktree-empty">
          <span class="worktree-empty-icon">
            <GitBranch :size="22" :stroke-width="1.5" />
          </span>
          <p class="worktree-empty-title">
            No branches found
          </p>
          <p class="worktree-empty-hint">
            No branches matched your search.
          </p>
        </div>

        <!-- Main List -->
        <div v-else class="worktree-list">
          <button
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="worktree-item"
            type="button"
            @click="selectEntry(entry.path)"
          >
            <GitBranch :size="15" :stroke-width="1.5" class="worktree-item-icon" />

            <div class="worktree-item-content">
              <div class="worktree-item-name">
                {{ entry.label }}
              </div>
              <div v-if="entry.status && !entry.status.isClean" class="worktree-item-subtitle">
                {{ entry.status.caution || 'Uncommitted changes' }}
              </div>
            </div>

            <Check v-if="entry.path.toLowerCase() === selectedKey" :size="15" :stroke-width="1.5" class="worktree-item-check" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Backdrops & Wrappers ────────────────────────────────────────────────── */
.worktree-backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 9998;
}

.worktree-picker {
  position: fixed;
  transform: translateY(-100%);
  width: min(360px, calc(100vw - 40px));
  max-height: min(420px, 60vh);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px; /* lg */
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 24px 56px rgba(0, 0, 0, 0.55),
    0 0 48px var(--color-accent-muted);
  overflow: hidden;
  z-index: 9999;
  transform-origin: bottom left;
  /* Removed will-change to prevent hardware acceleration blurriness */
}

/* ── Search Header ───────────────────────────────────────────────────────── */
.worktree-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 8px;
  flex-shrink: 0;
}

.worktree-search-icon {
  color: var(--color-text-tertiary);
}

.worktree-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary);
  font-size: 13px;
}

.worktree-search-input::placeholder {
  color: var(--color-text-tertiary);
}

/* ── Section Header ──────────────────────────────────────────────────────── */
.worktree-section {
  padding: 4px 14px 8px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

/* ── Groups & Lists ──────────────────────────────────────────────────────── */
.worktree-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 0 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.worktree-list::-webkit-scrollbar {
  width: 4px;
}
.worktree-list::-webkit-scrollbar-track {
  background: transparent;
}
.worktree-list::-webkit-scrollbar-thumb {
  background: var(--color-border-bright);
  border-radius: 9999px;
}

/* ── Worktree Item Row ───────────────────────────────────────────────────── */
.worktree-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px; /* md */
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.worktree-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.worktree-item-icon {
  color: var(--color-text-tertiary);
  margin-top: 2px;
  flex-shrink: 0;
}

.worktree-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.worktree-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.worktree-item-subtitle {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.worktree-item-check {
  color: var(--color-text-primary);
  margin-top: 2px;
  flex-shrink: 0;
}

/* ── Empty States ────────────────────────────────────────────────────────── */
.worktree-empty {
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.worktree-empty-icon {
  color: var(--color-text-dim);
  margin-bottom: 4px;
  opacity: 0.6;
  display: flex;
}

.worktree-empty-icon--warn {
  color: var(--color-danger-text);
  opacity: 0.8;
}

.worktree-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.worktree-empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

/* ── Spin Animation ──────────────────────────────────────────────────────── */
.spin {
  animation: worktree-spin 0.9s linear infinite;
}

@keyframes worktree-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ── Transitions ─────────────────────────────────────────────────────────── */
.picker-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.picker-leave-active {
  transition:
    opacity 160ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 160ms cubic-bezier(0.7, 0, 0.84, 0);
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateY(calc(-100% + 8px)) scale(0.96);
}

.picker-enter-to,
.picker-leave-from {
  opacity: 1;
  transform: translateY(-100%) scale(1);
}

.fade-enter-active {
  transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-leave-active {
  transition: opacity 160ms cubic-bezier(0.7, 0, 0.84, 0);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
