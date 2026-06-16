<script setup lang="ts">
import { homeDir, join } from '@tauri-apps/api/path'
import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import {
  Check,
  ChevronDown,
  FileText,
  MessageSquare,
  RefreshCw,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const plans = ref<{ name: string; path: string; mtime: number }[]>([])
const selectedPlanPath = ref<string | null>(null)
const planContent = ref<string>('')
const loading = ref(false)

// Custom Dropdown State
const dropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

// Line-by-line review state
const hoverLine = ref<number | null>(null)
const activeCommentLine = ref<number | null>(null)
const commentText = ref('')

const selectedPlanName = computed(() => {
  return plans.value.find(p => p.path === selectedPlanPath.value)?.name || ''
})

const planLines = computed(() => {
  if (!planContent.value)
    return []
  return planContent.value.split('\n')
})

function getMarkdownClass(line: string) {
  const l = line.trim()
  if (l.startsWith('#'))
    return 'md-heading'
  if (l.startsWith('- ') || l.startsWith('* ') || /^\d+\./.test(l))
    return 'md-list'
  if (l.startsWith('>'))
    return 'md-quote'
  if (l.startsWith('```'))
    return 'md-code'
  if (l.startsWith('`') || /^[A-Z][a-z\s]+:/.test(l))
    return 'md-bold'
  return 'md-text'
}

async function loadPlans() {
  loading.value = true
  try {
    const home = await homeDir()
    const plansDir = await join(home, '.emty', 'plans')

    try {
      const entries = await readDir(plansDir)
      const mdFiles = entries.filter(e => e.name?.endsWith('.md'))

      const loadedPlans = []
      for (const e of mdFiles) {
        const fullPath = await join(plansDir, e.name)
        let mtimeNum = 0
        try {
          const fileStats = await stat(fullPath)
          if (fileStats && fileStats.mtime) {
            mtimeNum = fileStats.mtime instanceof Date ? fileStats.mtime.getTime() : new Date(fileStats.mtime).getTime()
          }
        }
        catch {}
        loadedPlans.push({ name: e.name!, path: fullPath, mtime: mtimeNum })
      }

      loadedPlans.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
      plans.value = loadedPlans

      if (plans.value.length > 0) {
        const stillExists = plans.value.some(p => p.path === selectedPlanPath.value)
        const pathToSelect = stillExists && selectedPlanPath.value ? selectedPlanPath.value : plans.value[0]!.path
        await selectPlan(pathToSelect)
      }
      else {
        selectedPlanPath.value = null
        planContent.value = ''
      }
    }
    catch {
      plans.value = []
      selectedPlanPath.value = null
      planContent.value = ''
    }
  }
  finally {
    loading.value = false
  }
}

async function selectPlan(path: string) {
  selectedPlanPath.value = path
  activeCommentLine.value = null
  try {
    planContent.value = await readTextFile(path)
  }
  catch {
    planContent.value = ''
  }
}

async function toggleComment(index: number) {
  if (activeCommentLine.value === index) {
    activeCommentLine.value = null
  }
  else {
    activeCommentLine.value = index
    commentText.value = ''
    await nextTick()
    const textareas = document.querySelectorAll('.commit-textarea')
    if (textareas.length > 0) {
      ;(textareas[0] as HTMLTextAreaElement).focus()
    }
  }
}

function submitComment(lineIndex: number) {
  if (!commentText.value.trim())
    return

  const planName = plans.value.find(p => p.path === selectedPlanPath.value)?.name || 'Plan'
  const lineContent = planLines.value[lineIndex] || ''

  const text = `Regarding ${planName} (Line ${lineIndex + 1}):\n> ${lineContent.trim()}\n\n${commentText.value}`

  chat.sendMessage(text)
  commentText.value = ''
  activeCommentLine.value = null
}

function approvePlan() {
  chat.activeTab.mode = 'build'
  chat.sendMessage('I approve this plan. Please proceed with the implementation.')
}

function closeDropdown(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(() => {
  loadPlans()
  window.addEventListener('click', closeDropdown)
})

onUnmounted(() => {
  window.removeEventListener('click', closeDropdown)
})
</script>

<template>
  <div class="plan-root">
    <!-- Top Filter Bar (Seamless matching background) -->
    <div class="plan-filter-bar">
      <div
        ref="dropdownRef"
        class="custom-select-wrapper"
        :class="{ disabled: plans.length === 0 }"
      >
        <div
          class="custom-select-trigger"
          :class="{ 'is-open': dropdownOpen }"
          @click="!loading && plans.length > 0 && (dropdownOpen = !dropdownOpen)"
        >
          <FileText :size="13" class="select-icon" />
          <span class="select-text">{{ selectedPlanName || 'No plans found' }}</span>
          <ChevronDown :size="13" class="chevron-icon" :class="{ 'chevron-open': dropdownOpen }" />
        </div>

        <Transition name="dropdown">
          <div v-if="dropdownOpen" class="custom-dropdown-menu">
            <div
              v-for="plan in plans"
              :key="plan.path"
              class="custom-dropdown-item"
              :class="{ active: plan.path === selectedPlanPath }"
              @click="selectPlan(plan.path); dropdownOpen = false"
            >
              <FileText :size="12" class="dropdown-item-icon" />
              <div class="dropdown-item-details">
                <span class="dropdown-item-text">{{ plan.name }}</span>
              </div>
              <Check v-if="plan.path === selectedPlanPath" :size="13" class="dropdown-check-icon" />
            </div>
          </div>
        </Transition>
      </div>

      <button class="icon-btn" title="Refresh" :disabled="loading" @click="loadPlans">
        <RefreshCw :size="13" :class="{ spin: loading }" />
      </button>
    </div>

    <!-- Main Content Area -->
    <div v-if="loading && !planContent" class="git-empty">
      <RefreshCw :size="18" class="spin git-empty-spinner" />
      <p class="git-empty-title">
        Loading plan…
      </p>
    </div>

    <div v-else-if="!planContent" class="git-empty">
      <div class="git-empty-icon-wrap">
        <FileText :size="18" :stroke-width="1.8" />
      </div>
      <p class="git-empty-title">
        No plan selected
      </p>
      <p class="git-empty-hint">
        Use /plan to prompt the agent to create one.
      </p>
    </div>

    <!-- Line-by-line Viewer (Scrollable Container) -->
    <div v-else class="file-list">
      <div class="plan-file-wrapper">
        <!-- Sticky File Header with Blur -->
        <div class="file-row">
          <span class="file-status-badge dot-modified">P</span>
          <div class="file-name">
            <span class="file-base">{{ selectedPlanName }}</span>
          </div>
        </div>

        <div class="inline-diff">
          <div class="diff-content">
            <template v-for="(line, i) in planLines" :key="i">
              <!-- Source Line -->
              <div
                class="plan-diff-line"
                :class="{ 'line-active': activeCommentLine === i }"
                @mouseenter="hoverLine = i"
                @mouseleave="hoverLine = null"
              >
                <div class="line-gutter">
                  <span class="line-num" :class="{ 'line-num-hidden': activeCommentLine === i || hoverLine === i }">{{ i + 1 }}</span>

                  <button
                    class="line-action-btn"
                    :class="{ 'btn-visible': hoverLine === i || activeCommentLine === i }"
                    title="Add comment"
                    @click="toggleComment(i)"
                  >
                    <MessageSquare :size="11" />
                  </button>
                </div>
                <div class="line-text" :class="getMarkdownClass(line)">
                  {{ line || ' ' }}
                </div>
              </div>

              <!-- Inline Comment Entry Box -->
              <div v-if="activeCommentLine === i" class="inline-comment-row">
                <div class="inline-comment-box">
                  <textarea
                    v-model="commentText"
                    class="commit-textarea"
                    placeholder="Leave a comment for this line..."
                    @keydown.enter.exact.prevent="submitComment(i)"
                  />
                  <div class="comment-footer">
                    <button class="footer-btn footer-btn--cancel" @click="activeCommentLine = null">
                      Cancel
                    </button>
                    <button class="footer-btn footer-btn--commit" :disabled="!commentText.trim()" @click="submitComment(i)">
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Action Bar -->
    <div v-if="planContent" class="bottom-bar">
      <button class="bottom-btn bottom-btn--primary" @click="approvePlan">
        <Check :size="12" />
        Approve Plan
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Base ────────────────────────────────────────────────────── */
.plan-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  position: relative;
  overflow: hidden;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

/* ── Top Filter Bar (Solid Base Matching) ────────────────────── */
.plan-filter-bar {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-base); /* Perfectly matches tabs body */
  height: 38px;
  z-index: 10;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  transition:
    background 100ms ease,
    color 100ms ease;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

/* ── Custom Dropdown Component ───────────────────────────────── */
.custom-select-wrapper {
  position: relative;
  flex: 1;
  min-width: 0;
}

.custom-select-wrapper.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.custom-select-trigger {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 8px 0 10px;
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  gap: 8px;
  user-select: none;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.custom-select-trigger:hover,
.custom-select-trigger.is-open {
  background: var(--color-state-hover);
  border-color: var(--color-border-bright);
}

.select-icon {
  color: var(--color-text-dim);
  flex-shrink: 0;
}

.select-text {
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
}

.chevron-icon {
  color: var(--color-text-dim);
  flex-shrink: 0;
  transition: transform 150ms ease;
}

.chevron-open {
  transform: rotate(180deg);
}

.custom-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  max-height: 280px;
  overflow-y: auto;
  background: color-mix(in srgb, var(--color-bg-elevated) 85%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-md);
  box-shadow: var(--color-shadow-floating, 0 8px 24px rgba(0, 0, 0, 0.3));
  z-index: 50;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.custom-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition:
    background 100ms ease,
    color 100ms ease;
}

.custom-dropdown-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.custom-dropdown-item.active {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary);
}

.dropdown-item-icon {
  color: var(--color-text-dim);
}

.custom-dropdown-item.active .dropdown-item-icon,
.dropdown-check-icon {
  color: var(--color-text-primary);
}

.dropdown-item-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dropdown-item-text {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Scrollable File Area ────────────────────────────────────── */
.file-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 52px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.plan-file-wrapper {
  margin: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-base);
}

/* Sticky Header containing the blur */
.file-row {
  display: flex;
  align-items: center;
  padding: 0 10px;
  height: 32px;
  gap: 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  border-top-left-radius: var(--radius-md);
  border-top-right-radius: var(--radius-md);

  /* Sticky Glassmorphic Header */
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--color-bg-surface) 80%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.file-status-badge {
  font-size: 10px;
  font-weight: 700;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dot-modified {
  background: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
  color: var(--color-text-primary);
}

.file-name {
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', monospace;
  color: var(--color-text-primary);
}

/* ── Line-by-Line Viewer ─────────────────────────────────────── */
.inline-diff {
  background: var(--color-bg-base);
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}

.plan-diff-line {
  display: flex;
  align-items: stretch;
  min-height: 22px;
}

.plan-diff-line:hover,
.plan-diff-line.line-active {
  background: var(--color-state-hover);
}

.line-gutter {
  display: flex;
  width: 44px;
  flex-shrink: 0;
  border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  justify-content: center;
  align-items: flex-start;
  padding-top: 2px;
  position: relative;
}

.line-num {
  width: 100%;
  text-align: right;
  padding: 0 8px;
  color: var(--color-text-dim);
  opacity: 0.5;
  user-select: none;
  font-size: 10.5px;
  line-height: 1.55;
  font-family: ui-monospace, 'SF Mono', monospace;
  transition: opacity 100ms ease;
}

.line-num-hidden {
  opacity: 0;
}

.line-action-btn {
  position: absolute;
  top: 1px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-bright);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.9);
  transition: all 120ms ease;
  z-index: 10;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.line-action-btn.btn-visible {
  opacity: 1;
  transform: scale(1);
}

.line-action-btn:hover {
  background: var(--color-text-primary);
  color: var(--color-bg-base);
  border-color: var(--color-text-primary);
}

.line-text {
  padding: 1px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1;
  line-height: 1.55;
  font-size: 12px;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

/* Syntax Tokens */
.md-heading {
  font-weight: 600;
  color: var(--color-text-primary);
  margin-top: 6px;
}
.md-list {
  color: var(--color-text-secondary);
}
.md-quote {
  color: var(--color-text-dim);
  font-style: italic;
}
.md-code {
  font-family: ui-monospace, 'SF Mono', monospace;
  color: var(--color-text-secondary);
  opacity: 0.85;
}
.md-bold {
  font-weight: 500;
  color: var(--color-text-primary);
}
.md-text {
  color: var(--color-text-secondary);
}

/* ── Inline Comment Entry ────────────────────────────────────── */
.inline-comment-row {
  padding: 10px 12px 14px 44px;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  position: relative;
}

.inline-comment-row::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 44px;
  background: transparent;
  border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  pointer-events: none;
}

.inline-comment-box {
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 150ms ease;
  position: relative;
  z-index: 1;
}

.inline-comment-box:focus-within {
  border-color: var(--color-border-bright);
}

.commit-textarea {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
  min-height: 60px;
  line-height: 1.5;
  outline: none;
  padding: 10px 12px;
}

.commit-textarea::placeholder {
  color: var(--color-text-dim);
}

.comment-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-subtle);
}

.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.footer-btn--cancel {
  background: transparent;
  color: var(--color-text-secondary);
  border-color: var(--color-border-subtle);
}

.footer-btn--cancel:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}

.footer-btn--commit {
  background: var(--color-text-primary);
  color: var(--color-bg-base);
}

.footer-btn--commit:hover:not(:disabled) {
  opacity: 0.9;
}

.footer-btn--commit:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Bottom Action Bar ───────────────────────────────────────── */
.bottom-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-base);
  border-top: 1px solid var(--color-border-subtle);
  z-index: 5;
}

.bottom-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 100ms ease,
    opacity 100ms ease;
  white-space: nowrap;
}

.bottom-btn:active {
  transform: scale(0.97);
}

.bottom-btn--primary {
  background: var(--color-text-primary);
  color: var(--color-bg-base);
}

.bottom-btn--primary:hover {
  opacity: 0.88;
}

/* ── Empty States ────────────────────────────────────────────── */
.git-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  flex: 1;
  text-align: center;
}

.git-empty-icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 4px;
}

.git-empty-spinner {
  color: var(--color-text-dim);
}

.git-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.git-empty-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-dim);
  max-width: 200px;
  line-height: 1.5;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
