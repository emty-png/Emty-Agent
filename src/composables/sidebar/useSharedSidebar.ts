import type { ConversationRow } from '@/db/database'
import { ref, watch } from 'vue'
import {
  dbCountConversationsByWorkspace,
  dbListConversationsByWorkspace,
  dbListConversationsByWorkspaceAll,
  dbListProjectsWithLatestChat,
} from '@/db/database'

export interface ProjectItem {
  workspace_path: string
  project_name: string
  conversations: ConversationRow[]
  totalCount: number
}

const PROJECT_CHAT_LIMIT = 5

export const sharedProjects = ref<ProjectItem[]>([])
export const sharedCollapsedProjects = ref<Set<string>>(new Set<string>())

let initialized = false

export async function loadSharedProjects(): Promise<void> {
  try {
    const { useProjectStore } = await import('@/stores/project')
    const projectStore = useProjectStore()
    const latest = await dbListProjectsWithLatestChat(50)
    const byPath = new Map<string, ProjectItem>()
    const designPaths = new Set(projectStore.designProjects)
    const projectPromises = latest
      .filter(p => !designPaths.has(p.workspace_path))
      .map(async p => {
        const [conversations, totalCount] = await Promise.all([
          dbListConversationsByWorkspace(p.workspace_path, PROJECT_CHAT_LIMIT),
          dbCountConversationsByWorkspace(p.workspace_path),
        ])
        return { p, conversations, totalCount }
      })
    const results = await Promise.all(projectPromises)
    for (const { p, conversations, totalCount } of results) {
      byPath.set(p.workspace_path, {
        workspace_path: p.workspace_path,
        project_name: p.project_name,
        conversations,
        totalCount,
      })
    }
    for (const path of projectStore.openProjects) {
      if (designPaths.has(path))
        continue
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
    sharedProjects.value = [...byPath.values()]
  }
  catch {
    sharedProjects.value = []
  }
}

export function toggleSharedProject(path: string): void {
  const next = new Set(sharedCollapsedProjects.value)
  if (next.has(path))
    next.delete(path)
  else
    next.add(path)
  sharedCollapsedProjects.value = next
}

export async function showAllSharedConversations(project: ProjectItem): Promise<void> {
  const all = await dbListConversationsByWorkspaceAll(project.workspace_path)
  project.conversations = all
}

export function ensureSharedSidebarInitialized(): void {
  if (initialized)
    return
  initialized = true
  void (async () => {
    try {
      const { useHistoryStore } = await import('@/stores/history')
      const history = useHistoryStore()
      await history.loadPinned().catch(() => {})
      await loadSharedProjects().catch(() => {})
      watch(
        () => [history.conversations.length, history.pinnedConversations.length] as const,
        () => { void loadSharedProjects() },
        { deep: false },
      )
      const { useProjectStore } = await import('@/stores/project')
      const projectStore = useProjectStore()
      watch(
        () => projectStore.openProjects.length,
        () => { void loadSharedProjects() },
      )
    }
    catch {}
  })()
}

export function useSharedSidebar() {
  ensureSharedSidebarInitialized()
  return {
    projects: sharedProjects,
    collapsedProjects: sharedCollapsedProjects,
    loadProjects: loadSharedProjects,
    toggleProject: toggleSharedProject,
    showAllConversations: showAllSharedConversations,
    PROJECT_CHAT_LIMIT,
  }
}
