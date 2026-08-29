import type { ChatMode, DesignProjectType } from '@/stores/chat/core/types'
import type { McpServerConfig } from '@/stores/settings/types'
import type { ToolSet } from '@/utils/ai'
import type { OsInfo } from '@/utils/os'
import type { FileReadRegistry } from '@/utils/tools/fs/shared'
import type { QuestionAnswer, QuestionSpec } from '@/utils/tools/questions'
import type { SubAgentPersonality } from '@/utils/tools/subagent'
import type { TaskItem } from '@/utils/tools/todos'
import type { WorkspaceSnapshot } from '@/utils/worktrees'

export interface ToolRegistryContext {
  tabId: string
  conversationId: string
  mode: ChatMode
  workspacePath: string | null
  workspaceMeta: WorkspaceSnapshot | null
  readRegistry?: FileReadRegistry
  osInfo?: OsInfo | undefined
  coAuthor?: boolean
  memoryEnabled: boolean
  mcpServers: McpServerConfig[]
  disabledToolIds: string[]
  toolDescriptionOverrides: Record<string, string>

  // Callbacks
  snapshotCallback?: (relPath: string, absPath: string, content?: string | null) => Promise<void>
  questionCallback?: (questions: QuestionSpec[], resolve: (answers: QuestionAnswer[]) => void) => void
  todoCallback?: (items: TaskItem[]) => void
  initialTasks?: TaskItem[]
  subAgentSpawnCallback?: (args: { personality: SubAgentPersonality; mission: string }) => Promise<{ tabId: string; completionPromise: Promise<import('@/utils/tools/subagent').SubAgentOutcome> }>
  subAgentAbortCallback?: (tabId: string) => void
  onDesignCreate?: (artifact: import('@/stores/chat/core/types').DesignArtifact) => void
  onDesignEdit?: (id: string, patch: Partial<Omit<import('@/stores/chat/core/types').DesignArtifact, 'id' | 'createdAt'>>) => void
  onProjectScaffold?: (project: { path: string; name: string; type: DesignProjectType }) => void
  getActiveDesignProject?: () => { path: string; name: string; type: DesignProjectType } | null
  // New multi-screen design
  getActiveDesign?: () => { path: string; name: string } | null
  onScreenScaffold?: (info: { design: string; screen: string; path: string }) => void
  onDesignVersionAccumulate?: (files: Array<{ path: string; content: string }>) => void
  onScreenVersionAccumulate?: (screen: string, files: Array<{ path: string; content: string }>) => void
  onManifestChanged?: () => void
  onFilesChanged?: () => void
  onPreviewUrl?: (url: string | null) => void
  onDevServerTaskId?: (id: string | null) => void
  stopPreview?: () => Promise<void>
  runtimeEvents?: import('@/utils/tools/shell').ShellToolRuntimeEvents
}

export type ToolProfileFactory = (ctx: ToolRegistryContext) => ToolSet | Promise<ToolSet>

export class ToolRegistry {
  private profiles = new Map<ChatMode, ToolProfileFactory>()

  register(mode: ChatMode, factory: ToolProfileFactory): void {
    this.profiles.set(mode, factory)
  }

  async resolve(mode: ChatMode, ctx: ToolRegistryContext): Promise<ToolSet> {
    const factory = this.profiles.get(mode)
    if (!factory) {
      throw new Error(`No tool profile registered for mode: ${mode}`)
    }

    const tools = await factory(ctx)

    // Filter disabled tools globally for all profiles
    if (ctx.disabledToolIds.length > 0) {
      const { filterDisabledTools } = await import('@/utils/tools/catalog')
      return filterDisabledTools(tools, ctx.disabledToolIds)
    }

    return tools
  }
}

// Export a singleton instance
export const toolRegistry = new ToolRegistry()
