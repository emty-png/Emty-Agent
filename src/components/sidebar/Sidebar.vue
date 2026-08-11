<script setup lang="ts">
import type { Component } from 'vue'
import type { ConversationRow } from '@/db/database'
import {
  FolderOpen,
  History,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  X,
  Zap,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  dbCountConversationsByWorkspace,
  dbListConversationsByWorkspace,
  dbListConversationsByWorkspaceAll,
  dbListProjectsWithLatestChat,
} from '@/db/database'
import { useChatStore } from '@/stores/chat'
import { useHistoryStore } from '@/stores/history'
import { useProjectStore } from '@/stores/project'
import { useSidebarStore } from '@/stores/sidebar'

type ViewId = 'chat' | 'history' | 'projects' | 'hooks'

interface NavItem {
  id: ViewId
  label: string
  icon: Component
}

interface ProjectItem {
  workspace_path: string
  project_name: string
  conversations: ConversationRow[]
  totalCount: number
}

const props = defineProps<{
  activeView?: ViewId
  flyout?: boolean
}>()

const emit = defineEmits<{
  selectView: [view: ViewId]
  openSettings: []
  contextMenuOpen: []
  contextMenuClose: []
}>()

const sidebar = useSidebarStore()
const { collapsed } = storeToRefs(sidebar)

// No activeView means the chat view hasn't handed off control yet — default to it.
const activeView = computed<ViewId>(() => props.activeView ?? 'chat')

// Slightly smaller icons in the compact flyout popup than in the docked panel.
const iconSize = computed(() => (props.flyout ? 14 : 16))

const navItems: NavItem[] = [
  { id: 'chat', label: 'Conversation', icon: MessageSquareText },
  { id: 'history', label: 'Conversation History', icon: History },
  { id: 'projects', label: 'Project Viewer', icon: FolderOpen },
  { id: 'hooks', label: 'Lifecycle Hooks', icon: Zap },
]

// ── projects section ─────────────────────────────────────────────────────────
const PROJECT_CHAT_LIMIT = 5
const projects = ref<ProjectItem[]>([])
const collapsedProjects = ref(new Set<string>())
const history = useHistoryStore()
const chat = useChatStore()
const projectStore = useProjectStore()

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (mins < 1)
    return 'now'
  if (mins < 60)
    return `${mins}m`
  if (hours < 24)
    return `${hours}h`
  if (days < 7)
    return `${days}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function loadProjects() {
  try {
    // get projects from DB (have conversations)
    const latest = await dbListProjectsWithLatestChat(50)
    const byPath = new Map<string, ProjectItem>()

    for (const p of latest) {
      const [conversations, totalCount] = await Promise.all([
        dbListConversationsByWorkspace(p.workspace_path, PROJECT_CHAT_LIMIT),
        dbCountConversationsByWorkspace(p.workspace_path),
      ])
      byPath.set(p.workspace_path, {
        workspace_path: p.workspace_path,
        project_name: p.project_name,
        conversations,
        totalCount,
      })
    }

    // ensure all openProjects appear (even if no conversations yet)
    for (const path of projectStore.openProjects) {
      if (!byPath.has(path)) {
        const name = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path
        byPath.set(path, {
          workspace_path: path,
          project_name: name,
          conversations: [],
          totalCount: 0,
        })
      }
    }

    projects.value = [...byPath.values()]
  }
  catch {
    projects.value = []
  }
}

async function openConversation(conv: ConversationRow) {
  await history.openInTab(conv)
  emit('selectView', 'chat')
}

function selectProject(path: string) {
  projectStore.setProject(path)
}

function removeProject(path: string) {
  const project = projects.value.find(p => p.workspace_path === path)
  if (project && project.totalCount > 0) {
    confirmRemoveProjectPath.value = path
  }
  else {
    projectStore.removeProject(path)
    loadProjects()
  }
}

const confirmRemoveProjectPath = ref<string | null>(null)
const confirmRemoveProjectCount = computed(() => {
  if (!confirmRemoveProjectPath.value)
    return 0
  return projects.value.find(p => p.workspace_path === confirmRemoveProjectPath.value)?.totalCount ?? 0
})

async function confirmRemoveProject() {
  const path = confirmRemoveProjectPath.value
  if (!path)
    return
  await history.removeByWorkspace(path)
  projectStore.removeProject(path)
  await loadProjects()
  confirmRemoveProjectPath.value = null
  emit('contextMenuClose')
}

watch(confirmRemoveProjectPath, (val) => {
  if (val) emit('contextMenuOpen')
})

function toggleProject(path: string) {
  if (collapsedProjects.value.has(path))
    collapsedProjects.value.delete(path)
  else
    collapsedProjects.value.add(path)
}

async function showAllConversations(project: ProjectItem) {
  const allConversations = await dbListConversationsByWorkspaceAll(project.workspace_path)
  project.conversations = allConversations
}

onMounted(loadProjects)

// refresh projects when conversations change (new chat created, renamed, deleted)
watch(
  () => history.conversations.length,
  () => loadProjects(),
)

// ── context menu ──────────────────────────────────────────────────────────────
const menuOpen = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })

function openMenu(e: MouseEvent, id: string) {
  e.stopPropagation()
  menuOpen.value = id
  emit('contextMenuOpen')
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
  emit('contextMenuClose')
}

// ── rename ────────────────────────────────────────────────────────────────────
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement[]>([])

async function startRename(conv: ConversationRow) {
  closeMenu()
  renamingId.value = conv.id
  renameValue.value = conv.title
  await nextTick()
  renameInputRef.value[0]?.select()
}

async function commitRename(id: string) {
  if (renameValue.value.trim()) {
    await history.rename(id, renameValue.value)
    for (const p of projects.value) {
      const conv = p.conversations.find(c => c.id === id)
      if (conv)
        conv.title = renameValue.value.trim()
    }
  }
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
  if (confirmDeleteId.value) {
    await history.remove(confirmDeleteId.value)
    for (const p of projects.value) {
      p.conversations = p.conversations.filter(c => c.id !== confirmDeleteId.value)
      if (p.totalCount > 0)
        p.totalCount--
    }
  }
  confirmDeleteId.value = null
}

watch(confirmDeleteId, (val) => {
  if (val) emit('contextMenuOpen')
  else emit('contextMenuClose')
})

// ── computed classes ──────────────────────────────────────────────────────────

const WIDTH_TRANSITION
  = '[transition:width_200ms_cubic-bezier(0.4,0,0.2,1),min-width_200ms_cubic-bezier(0.4,0,0.2,1),max-width_200ms_cubic-bezier(0.4,0,0.2,1),opacity_160ms_ease] motion-reduce:transition-none'

const sidebarClasses = computed(() => {
  const base = 'flex flex-col bg-(--color-bg-surface) overflow-hidden shrink-0'

  if (props.flyout) {
    return `${base} w-full min-w-0 max-w-none h-auto border-none opacity-100 pointer-events-auto transition-none`
  }

  if (collapsed.value) {
    return `${base} w-0 min-w-0 max-w-0 h-full border-r-0 opacity-0 pointer-events-none ${WIDTH_TRANSITION}`
  }

  return `${base} w-[220px] min-w-[220px] max-w-[220px] h-full border-r border-(--color-border-mid) opacity-100 pointer-events-auto ${WIDTH_TRANSITION}`
})

const SCROLLBAR
  = '[scrollbar-width:thin] [scrollbar-color:var(--color-border-mid)_transparent] '
    + '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-transparent '
    + '[&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-(--color-border-mid)'

const navClasses = computed(() =>
  props.flyout
    ? `flex flex-col gap-0.5 p-1.5 flex-1 min-h-0 overflow-y-auto ${SCROLLBAR}`
    : `flex flex-col gap-1 px-2 py-3 flex-1 min-h-0 overflow-y-auto ${SCROLLBAR}`,
)

const listClasses = computed(() =>
  props.flyout
    ? 'flex flex-col gap-px m-0 p-0 list-none'
    : 'flex flex-col gap-0.5 m-0 p-0 list-none',
)

const dividerClasses = computed(() => {
  const gradient
    = 'h-px shrink-0 bg-[linear-gradient(90deg,transparent,var(--color-border-subtle)_15%,var(--color-border-subtle)_85%,transparent)]'
  return props.flyout ? `${gradient} mx-2` : `${gradient} mx-3`
})

const bottomSectionClasses = computed(() =>
  props.flyout ? 'pt-1.5 px-1.5 pb-2' : 'pt-2 px-2 pb-2.5',
)

function btnClasses(isActive: boolean) {
  const size = props.flyout ? 'h-[27px] px-2 gap-2' : 'h-[29px] px-3 gap-2.5'

  const state = isActive
    ? 'bg-(--color-accent-muted) text-(--color-accent-text) hover:bg-(--color-state-hover) hover:text-(--color-accent-bright)'
    : 'bg-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:text-(--color-text-primary)'

  return [
    'relative flex items-center justify-start w-full border-0 rounded-(--radius-sm) cursor-pointer whitespace-nowrap',
    size,
    state,
    '[transition:background_120ms_ease,color_120ms_ease,transform_100ms_ease] motion-reduce:transition-none',
    'active:bg-(--color-bg-elevated) active:scale-[0.985]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--color-accent-text) focus-visible:outline-offset-2',
  ].join(' ')
}

function labelClasses(isActive: boolean) {
  const size = props.flyout ? 'text-[12.5px]' : 'text-[13px]'
  return `${size} font-normal tracking-[0.01em] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis`
}
</script>

<template>
  <aside :class="sidebarClasses" @click="closeMenu">
    <nav :class="navClasses" aria-label="Primary">
      <ul :class="listClasses">
        <li v-for="item in navItems" :key="item.id">
          <button
            type="button"
            :class="btnClasses(activeView === item.id)"
            :aria-current="activeView === item.id ? 'page' : undefined"
            :aria-label="item.label"
            @click="emit('selectView', item.id)"
          >
            <component :is="item.icon" :size="iconSize" :stroke-width="1.7" class="shrink-0" />
            <span :class="labelClasses(activeView === item.id)">{{ item.label }}</span>
          </button>
        </li>
      </ul>

      <!-- ── projects section ────────────────────────────────────────────── -->
      <template v-if="projects.length > 0">
        <div :class="dividerClasses" />
        <div class="px-2 pt-1.5 pb-1">
          <span class="text-[10px] font-semibold tracking-[0.1em] uppercase text-(--color-text-dim) select-none">Projects</span>
        </div>
        <div v-for="project in projects" :key="project.workspace_path">
          <div class="sidebar-project-row">
            <button
              type="button"
              class="sidebar-project-btn"
              :class="{ 'sidebar-project-btn--active': projectStore.projectPath === project.workspace_path }"
              @click="selectProject(project.workspace_path); toggleProject(project.workspace_path)"
            >
              <FolderOpen :size="13" :stroke-width="1.7" class="shrink-0" />
              <span class="text-[12.5px] font-normal whitespace-nowrap overflow-hidden text-ellipsis flex-1">{{ project.project_name }}</span>
            </button>
            <button
              class="sidebar-project-remove"
              title="Remove project"
              @click.stop="removeProject(project.workspace_path)"
            >
              <X :size="11" :stroke-width="1.8" />
            </button>
          </div>

          <!-- conversation list -->
          <template v-if="!collapsedProjects.has(project.workspace_path)">
            <div v-for="conv in project.conversations" :key="conv.id">
              <!-- rename input -->
              <div v-if="renamingId === conv.id" class="flex items-center w-full h-[26px] pl-[30px] pr-2">
                <input
                  ref="renameInputRef"
                  v-model="renameValue"
                  class="sidebar-rename-input"
                  @keydown.enter="commitRename(conv.id)"
                  @keydown.escape="cancelRename"
                  @blur="commitRename(conv.id)"
                  @click.stop
                >
              </div>
              <!-- normal row -->
              <div v-else class="sidebar-conv-row">
                <button
                  type="button"
                  class="sidebar-conv-item"
                  :class="{ 'sidebar-conv-item--active': chat.tabs.some(t => t.conversationId === conv.id) }"
                  @click="openConversation(conv)"
                >
                  <span class="text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">{{ conv.title }}</span>
                </button>
                <span class="sidebar-conv-time">{{ relativeTime(conv.updated_at) }}</span>
                <button
                  class="sidebar-conv-menu"
                  @click.stop="openMenu($event, conv.id)"
                >
                  <MoreHorizontal :size="12" :stroke-width="1.8" />
                </button>
              </div>
            </div>

            <!-- empty state -->
            <div v-if="project.conversations.length === 0" class="flex items-center h-[26px] pl-[30px] pr-3">
              <span class="text-[11px] text-(--color-text-dim) italic">No conversation yet</span>
            </div>

            <!-- show more -->
            <button
              v-if="project.totalCount > PROJECT_CHAT_LIMIT && project.conversations.length === PROJECT_CHAT_LIMIT"
              type="button"
              class="sidebar-show-more"
              @click.stop="showAllConversations(project)"
            >
              Show {{ project.totalCount - PROJECT_CHAT_LIMIT }} more...
            </button>
          </template>
        </div>
      </template>

      <slot />
    </nav>

    <div class="shrink-0">
      <div :class="dividerClasses" />
      <div :class="bottomSectionClasses">
        <button type="button" :class="btnClasses(false)" aria-label="Settings" @click="emit('openSettings')">
          <Settings :size="iconSize" :stroke-width="1.7" class="shrink-0" />
          <span :class="labelClasses(false)">Settings</span>
        </button>
      </div>
    </div>
  </aside>

  <!-- ── context menu ─────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="ctx-backdrop"
      @click="closeMenu"
    />
    <div
      v-if="menuOpen"
      class="ctx-menu"
      :style="{ top: `${menuPos.y}px`, left: `${menuPos.x}px` }"
      @click.stop
    >
      <button class="ctx-item" @click="startRename(projects.flatMap(p => p.conversations).find(c => c.id === menuOpen)!)">
        <Pencil :size="13" :stroke-width="1.8" />
        Rename
      </button>
      <div class="ctx-divider" />
      <button class="ctx-item ctx-item--danger" @click="startDelete(menuOpen!)">
        <Trash2 :size="13" :stroke-width="1.8" />
        Delete
      </button>
    </div>
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

  <!-- ── project remove confirm dialog ────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="confirmRemoveProjectPath" class="dialog-backdrop" @click.self="confirmRemoveProjectPath = null">
      <div class="dialog">
        <button class="dialog-close" @click="confirmRemoveProjectPath = null">
          <X :size="14" :stroke-width="1.8" />
        </button>
        <h2 class="dialog-title">
          Delete project and all conversations?
        </h2>
        <p class="dialog-body">
          This will permanently delete {{ confirmRemoveProjectCount }} conversation{{ confirmRemoveProjectCount !== 1 ? 's' : '' }}
          and all their messages under this project. This cannot be undone.
        </p>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn--cancel" @click="confirmRemoveProjectPath = null">
            Cancel
          </button>
          <button class="dialog-btn dialog-btn--delete" @click="confirmRemoveProject">
            Delete all
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── project row ────────────────────────────────────────────────────────────── */
.sidebar-project-row {
  display: flex;
  align-items: center;
  position: relative;
}

.sidebar-project-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding-left: 12px;
  padding-right: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.sidebar-project-btn:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.sidebar-project-btn--active {
  color: var(--color-accent-text);
}

.sidebar-project-remove {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.sidebar-project-row:hover .sidebar-project-remove {
  opacity: 1;
}

.sidebar-project-remove:hover {
  background: var(--color-danger);
  color: var(--color-text-primary);
}

/* ── conversation row ───────────────────────────────────────────────────────── */
.sidebar-conv-row {
  display: flex;
  align-items: center;
  position: relative;
}

.sidebar-conv-item {
  display: flex;
  align-items: center;
  gap: 2;
  width: 100%;
  height: 26px;
  padding-left: 30px;
  padding-right: 64px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.sidebar-conv-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-secondary);
}

.sidebar-conv-item--active {
  color: var(--color-text-dim);
}

.sidebar-conv-time {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--color-text-tertiary);
  pointer-events: none;
  transition: opacity 120ms ease;
}

.sidebar-conv-row:hover .sidebar-conv-time {
  opacity: 0;
}

.sidebar-conv-menu {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.sidebar-conv-row:hover .sidebar-conv-menu {
  opacity: 1;
}

.sidebar-conv-menu:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* ── show more ──────────────────────────────────────────────────────────────── */
.sidebar-show-more {
  display: flex;
  align-items: center;
  width: 100%;
  height: 24px;
  padding-left: 30px;
  padding-right: 12px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: color 120ms ease;
}

.sidebar-show-more:hover {
  color: var(--color-text-secondary);
}

/* ── rename input ───────────────────────────────────────────────────────────── */
.sidebar-rename-input {
  flex: 1;
  height: 24px;
  padding-inline: 6px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 11.5px;
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
