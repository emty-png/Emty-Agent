<script setup lang="ts">
import type { ConversationRow } from '@/db/database'
import { CheckSquare, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Square, Trash2, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useHistoryStore } from '@/stores/history'

// ── open ──────────────────────────────────────────────────────────────────────
const emit = defineEmits<{
  (e: 'newChat'): void
  (e: 'openChat'): void
}>()
const history = useHistoryStore()
const { conversations, loading, hasMore, isEmpty, searchQuery } = storeToRefs(history)

// ── load on mount ─────────────────────────────────────────────────────────────
onMounted(() => history.load(true))

// ── search ────────────────────────────────────────────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch(e: Event) {
  const q = (e.target as HTMLInputElement).value
  if (searchTimer)
    clearTimeout(searchTimer)
  searchTimer = setTimeout(() => history.search(q), 220)
}

// ── infinite scroll ───────────────────────────────────────────────────────────
function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (!hasMore.value || loading.value)
    return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    history.load(false)
  }
}

// ── multi-select ──────────────────────────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set())
const isSelecting = computed(() => selectedIds.value.size > 0)

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id))
    next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(conversations.value.map(c => c.id))
}

function clearSelection() {
  selectedIds.value = new Set()
}

const confirmBulkDelete = ref(false)

function startBulkDelete() {
  confirmBulkDelete.value = true
}

async function confirmBulkDeleteAction() {
  const ids = [...selectedIds.value]
  clearSelection()
  confirmBulkDelete.value = false
  for (const id of ids) {
    await history.remove(id)
  }
}

// ── context menu ──────────────────────────────────────────────────────────────
const menuOpen = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })

function openMenu(e: MouseEvent, id: string) {
  e.stopPropagation()
  menuOpen.value = id

  const btn = e.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  const menuW = 140
  let x = rect.left
  if (x + menuW > window.innerWidth)
    x = window.innerWidth - menuW - 8
  let y = rect.bottom + 4
  if (y + 80 > window.innerHeight)
    y = rect.top - 80

  menuPos.value = { x, y }
}

function closeMenu() {
  menuOpen.value = null
}

// ── rename ────────────────────────────────────────────────────────────────────
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

async function startRename(conv: ConversationRow) {
  closeMenu()
  renamingId.value = conv.id
  renameValue.value = conv.title
  await nextTick()
  renameInputRef.value?.select()
}

async function commitRename(id: string) {
  if (renameValue.value.trim())
    await history.rename(id, renameValue.value)
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

// ── delete ────────────────────────────────────────────────────────────────────
const confirmDeleteId = ref<string | null>(null)

function startDelete(id: string) {
  closeMenu()
  confirmDeleteId.value = id
}

async function confirmDelete() {
  if (confirmDeleteId.value)
    await history.remove(confirmDeleteId.value)
  confirmDeleteId.value = null
}

function open(conv: ConversationRow) {
  if (renamingId.value === conv.id)
    return
  history.openInTab(conv)
  emit('openChat')
}

// ── relative time ──────────────────────────────────────────────────────────────
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (mins < 1)
    return 'just now'
  if (mins < 60)
    return `${mins}m ago`
  if (hours < 24)
    return `${hours}h ago`
  if (days < 7)
    return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="history-root" @click="closeMenu">
    <!-- ── header ──────────────────────────────────────────────────────── -->
    <div class="history-header">
      <div class="header-content">
        <h1 class="history-title">
          History
        </h1>
        <div class="header-actions">
          <button v-if="isSelecting" class="select-action-btn" @click="selectAll">
            Select all
          </button>
          <button v-if="isSelecting" class="select-action-btn select-action-btn--danger" @click="startBulkDelete">
            <Trash2 :size="13" :stroke-width="1.8" />
            Delete {{ selectedIds.size }}
          </button>
          <button v-if="isSelecting" class="select-action-btn" @click="clearSelection">
            Cancel
          </button>
          <button class="new-btn" @click="$emit('newChat')">
            <Plus :size="13" :stroke-width="2" />
            New chat
          </button>
        </div>
      </div>
    </div>

    <!-- ── search ──────────────────────────────────────────────────────── -->
    <div class="search-wrap">
      <div class="search-inner">
        <Search :size="13" :stroke-width="1.8" class="search-icon" />
        <input
          class="search-input"
          type="text"
          placeholder="Search your chats..."
          :value="searchQuery"
          @input="onSearch"
        >
      </div>
    </div>

    <!-- ── list ────────────────────────────────────────────────────────── -->
    <div class="conv-list" @scroll="onScroll">
      <!-- empty -->
      <div v-if="isEmpty" class="list-empty">
        <MessageSquare :size="22" :stroke-width="1.3" class="empty-icon" />
        <p>No conversations yet</p>
      </div>

      <template v-else>
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="conv-item"
          :class="{ 'conv-item--menu-open': menuOpen === conv.id }"
          @click="open(conv)"
        >
          <!-- rename input -->
          <template v-if="renamingId === conv.id">
            <input
              ref="renameInputRef"
              v-model="renameValue"
              class="rename-input"
              @keydown.enter="commitRename(conv.id)"
              @keydown.escape="cancelRename"
              @blur="commitRename(conv.id)"
              @click.stop
            >
          </template>

          <!-- normal row -->
          <template v-else>
            <!-- checkbox (visible on hover or when selecting) -->
            <button
              class="conv-checkbox"
              :class="{ 'conv-checkbox--checked': selectedIds.has(conv.id), 'conv-checkbox--visible': isSelecting }"
              @click.stop="toggleSelect(conv.id)"
            >
              <CheckSquare v-if="selectedIds.has(conv.id)" :size="16" :stroke-width="1.8" />
              <Square v-else :size="16" :stroke-width="1.8" />
            </button>

            <div class="conv-info">
              <span class="conv-title">{{ conv.title }}</span>
              <span class="conv-meta">Last message {{ relativeTime(conv.updated_at) }}</span>
            </div>

            <!-- actions (visible on hover / menu open) -->
            <div class="conv-actions" @click.stop>
              <button
                class="action-btn"
                aria-label="More options"
                @click="openMenu($event, conv.id)"
              >
                <MoreHorizontal :size="14" :stroke-width="1.8" />
              </button>
            </div>
          </template>
        </div>

        <!-- load more spinner -->
        <div v-if="loading" class="list-loading">
          <span class="loading-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      </template>
    </div>

    <!-- ── context menu ─────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="ctx-menu"
        :style="{ top: `${menuPos.y}px`, left: `${menuPos.x}px` }"
        @click.stop
      >
        <button class="ctx-item" @click="startRename(conversations.find(c => c.id === menuOpen)!)">
          <Pencil :size="13" :stroke-width="1.8" />
          Rename
        </button>
        <div class="ctx-divider" />
        <button class="ctx-item ctx-item--danger" @click="startDelete(menuOpen!)">
          <Trash2 :size="13" :stroke-width="1.8" />
          Delete
        </button>
      </div>

      <!-- click outside to close -->
      <div v-if="menuOpen" class="ctx-backdrop" @click="closeMenu" />
    </Teleport>

    <!-- ── delete confirm dialog ────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="confirmDeleteId" class="dialog-backdrop" @click.self="confirmDeleteId = null">
        <div class="dialog">
          <button class="dialog-close" @click="confirmDeleteId = null">
            <X :size="14" :stroke-width="1.8" />
          </button>
          <h2 class="dialog-title">
            Delete conversation?
          </h2>
          <p class="dialog-body">
            This will permanently delete the conversation and all its messages. This cannot be
            undone.
          </p>
          <div class="dialog-actions">
            <button class="dialog-btn dialog-btn--cancel" @click="confirmDeleteId = null">
              Cancel
            </button>
            <button class="dialog-btn dialog-btn--delete" @click="confirmDelete">
              Delete
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── bulk delete confirm dialog ───────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="confirmBulkDelete" class="dialog-backdrop" @click.self="confirmBulkDelete = false">
        <div class="dialog">
          <button class="dialog-close" @click="confirmBulkDelete = false">
            <X :size="14" :stroke-width="1.8" />
          </button>
          <h2 class="dialog-title">
            Delete {{ selectedIds.size }} conversations?
          </h2>
          <p class="dialog-body">
            This will permanently delete all selected conversations and their messages. This cannot
            be undone.
          </p>
          <div class="dialog-actions">
            <button class="dialog-btn dialog-btn--cancel" @click="confirmBulkDelete = false">
              Cancel
            </button>
            <button class="dialog-btn dialog-btn--delete" @click="confirmBulkDeleteAction">
              Delete all
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────────── */
.history-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base);
  overflow: hidden;
}

/* ── header ──────────────────────────────────────────────────────────────────── */
.history-header {
  display: flex;
  align-items: center;
  justify-content: center; /* Center the internal block */
  padding: 60px 28px 24px;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 800px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding-inline: 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms ease;
}

.select-action-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.select-action-btn--danger {
  color: var(--color-danger-text);
  border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
}

.select-action-btn--danger:hover {
  background: var(--color-danger);
  color: var(--color-text-primary);
}

.history-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  line-height: 1;
}

.new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding-inline: 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-text-primary);
  color: var(--color-bg-base);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.new-btn:hover {
  opacity: 0.9;
}

/* ── search ──────────────────────────────────────────────────────────────────── */
.search-wrap {
  display: flex;
  justify-content: center;
  padding-inline: 28px;
  margin-bottom: 32px;
  flex-shrink: 0;
}

.search-inner {
  position: relative;
  width: 100%;
  max-width: 800px;
}

.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 42px;
  padding-left: 36px;
  padding-right: 12px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 14px;
  transition: border-color 120ms ease;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--color-text-tertiary);
}

.search-input:focus {
  border-color: var(--color-border-bright);
}

/* ── list ────────────────────────────────────────────────────────────────────── */
.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 28px 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* items and empty state inside the list */
.conv-item,
.list-empty,
.list-loading {
  width: 100%;
  max-width: 680px; /* Sweeter, slimmer width than the 800px search bar */
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding-top: 60px;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.empty-icon {
  opacity: 0.4;
}

/* ── conversation item ───────────────────────────────────────────────────────── */
.conv-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border-subtle);
  border-top: 1px solid var(--color-border-subtle);
  margin-top: -1px; /* collapse borders */
  cursor: pointer;
  transition: background 120ms ease;
  position: relative;
  min-height: 60px;
}

.conv-item:last-child {
  border-bottom: none;
}

.conv-item:hover,
.conv-item--menu-open {
  background: transparent;
}

/* checkbox — visible on hover or when selecting */
.conv-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  opacity: 0;
  flex-shrink: 0;
  transition:
    opacity 100ms ease,
    color 100ms ease;
  padding: 0;
}

.conv-item:hover .conv-checkbox,
.conv-checkbox--visible {
  opacity: 1;
}

.conv-checkbox--checked {
  opacity: 1;
  color: var(--color-accent);
}

.conv-checkbox:hover {
  color: var(--color-text-secondary);
}

/* show actions only on hover or when menu is open */
.conv-item .conv-actions {
  opacity: 0;
  transition: opacity 120ms ease;
  flex-shrink: 0;
}

.conv-item:hover .conv-actions,
.conv-item--menu-open .conv-actions {
  opacity: 1;
}

.conv-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.conv-title {
  font-size: 13.5px;
  font-weight: 450;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.conv-meta {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1;
}

/* ── action button ───────────────────────────────────────────────────────────── */
.action-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.action-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* ── rename input ────────────────────────────────────────────────────────────── */
.rename-input {
  flex: 1;
  height: 28px;
  padding-inline: 8px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 13px;
}

/* ── loading dots ────────────────────────────────────────────────────────────── */
.list-loading {
  display: flex;
  justify-content: center;
  padding: 12px;
}

.loading-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}

.loading-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  animation: bounce 1.1s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.18s;
}
.loading-dots span:nth-child(3) {
  animation-delay: 0.36s;
}
</style>

<!-- ── global styles for teleported elements ─────────────────────────────────── -->
<style>
/* context menu */
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  padding: 4px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 12px 28px rgba(0, 0, 0, 0.35);
}

.ctx-item {
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
  cursor: pointer;
  text-align: left;
  transition:
    background 100ms ease,
    color 100ms ease;
}

.ctx-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.ctx-item--danger {
  color: var(--color-danger-text);
}
.ctx-item--danger:hover {
  background: var(--color-danger);
  color: var(--color-text-primary);
}

.ctx-divider {
  height: 1px;
  background: var(--color-border-mid);
  margin: 2px 5px;
}

/* delete confirm dialog */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: color-mix(in srgb, var(--color-bg-base) 65%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  position: relative;
  width: 360px;
  padding: 24px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.3);
}

.dialog-close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: background 120ms ease;
}

.dialog-close:hover {
  background: var(--color-state-hover);
}

.dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 10px;
}

.dialog-body {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-btn {
  height: 32px;
  padding-inline: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.dialog-btn--cancel {
  background: var(--color-bg-card);
  border-color: var(--color-border-mid);
  color: var(--color-text-secondary);
}

.dialog-btn--cancel:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.dialog-btn--delete {
  background: var(--color-danger);
  color: var(--color-text-primary);
}

.dialog-btn--delete:hover {
  background: var(--color-danger-hover);
}
</style>
