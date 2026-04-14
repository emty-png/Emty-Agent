<script setup lang="ts">
import type { ConversationRow } from '@/db/database'
import { MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, ref } from 'vue'
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

// ── context menu ──────────────────────────────────────────────────────────────
const menuOpen = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })

function openMenu(e: MouseEvent, id: string) {
  e.stopPropagation()
  menuOpen.value = id

  const menuWidth = 170 // width + padding/shadow
  const menuHeight = 90 // height + padding/shadow

  let x = e.clientX
  let y = e.clientY

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10
  }

  menuPos.value = { x, y }
}

function closeMenu() { menuOpen.value = null }

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

function cancelRename() { renamingId.value = null }

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
      <h1 class="history-title">
        History
      </h1>
      <button class="new-btn" @click="$emit('newChat')">
        <Plus :size="13" :stroke-width="2" />
        New chat
      </button>
    </div>

    <!-- ── search ──────────────────────────────────────────────────────── -->
    <div class="search-wrap">
      <Search :size="13" :stroke-width="1.8" class="search-icon" />
      <input
        class="search-input"
        type="text"
        placeholder="Search conversations…"
        :value="searchQuery"
        @input="onSearch"
      >
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
            <div class="conv-info">
              <span class="conv-title">{{ conv.title }}</span>
              <span class="conv-meta">{{ relativeTime(conv.updated_at) }}</span>
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
          <span class="loading-dots"><span /><span /><span /></span>
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
        <button
          class="ctx-item"
          @click="startRename(conversations.find(c => c.id === menuOpen)!)"
        >
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
            This will permanently delete the conversation and all its messages.
            This cannot be undone.
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
  justify-content: space-between;
  padding: 28px 28px 16px;
  flex-shrink: 0;
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
  height: 30px;
  padding-inline: 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.new-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-color: var(--color-border-bright);
}

/* ── search ──────────────────────────────────────────────────────────────────── */
.search-wrap {
  position: relative;
  margin: 0 28px 16px;
  flex-shrink: 0;
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
  height: 34px;
  padding-left: 32px;
  padding-right: 12px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 13px;
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
  padding: 0 12px 16px;
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
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 120ms ease;
  position: relative;
  min-height: 52px;
}

.conv-item:hover,
.conv-item--menu-open {
  background: var(--color-bg-card);
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
  border: 1px solid var(--color-ember-dim);
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
  min-width: 160px;
  padding: 4px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  transform: translateY(-4px); /* open slightly above click point */
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding-inline: 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.ctx-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.ctx-item--danger {
  color: var(--color-rose-text);
}
.ctx-item--danger:hover {
  background: var(--color-rose);
  color: var(--color-text-primary);
}

.ctx-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 3px 6px;
}

/* delete confirm dialog */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  position: relative;
  width: 360px;
  padding: 24px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
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
  background: var(--color-bg-hover);
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
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.dialog-btn--delete {
  background: var(--color-rose);
  color: var(--color-text-primary);
}

.dialog-btn--delete:hover {
  background: var(--color-rose-hover);
}
</style>
