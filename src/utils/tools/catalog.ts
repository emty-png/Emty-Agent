import type { McpServerConfig } from '@/stores/settings/types'
import { buildMcpAliasedTools } from './mcpAliases'

export type BuiltinToolGroupId
  = | 'agent'
    | 'memory'
    | 'skills'
    | 'browser'
    | 'web'
    | 'filesystem'
    | 'shell'
    | 'image'
    | 'design-scaffold'
    | 'design-files'
    | 'design-build'

export type ToolGroupId = BuiltinToolGroupId | `mcp:${string}`

export interface ToolCatalogItem {
  id: string
  label: string
  description: string
  groupId: ToolGroupId
  groupLabel: string
  groupDescription: string
  kind: 'builtin' | 'mcp'
  serverId?: string
  serverName?: string
}

export interface ToolCatalogGroup {
  id: ToolGroupId
  label: string
  description: string
  kind: 'builtin' | 'mcp'
  serverId?: string
  serverName?: string
  tools: ToolCatalogItem[]
}

interface BuiltinToolDefinition {
  id: string
  label: string
  description: string
}

interface BuiltinGroupDefinition {
  id: BuiltinToolGroupId
  label: string
  description: string
  tools: BuiltinToolDefinition[]
}

const BUILTIN_GROUPS: BuiltinGroupDefinition[] = [
  {
    id: 'agent',
    label: 'Agent',
    description: 'Conversation and delegation tools the agent uses to coordinate work.',
    tools: [
      { id: 'ask_questions', label: 'ask_questions', description: 'Pause to ask the user clarifying questions.' },
      { id: 'create_task', label: 'create_task', description: 'Add a new task to the live task list.' },
      { id: 'update_task', label: 'update_task', description: 'Update or delete an existing task.' },
      { id: 'list_tasks', label: 'list_tasks', description: 'List all current tasks with IDs and status.' },
      { id: 'get_task', label: 'get_task', description: 'Get full details of a single task.' },
      { id: 'plan', label: 'plan', description: 'Write an implementation plan for the user to review.' },
      { id: 'sleep', label: 'sleep', description: 'Pause execution for a specified duration.' },
      { id: 'spawn_subagent', label: 'spawn_subagent', description: 'Delegate focused work to a sub-agent tab.' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Persist stable preferences and project notes for future chats.',
    tools: [
      { id: 'remember_memory', label: 'remember_memory', description: 'Save durable global or project-scoped memory.' },
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    description: 'Load skill instructions and packaged skill resources on demand.',
    tools: [
      { id: 'load_skill', label: 'load_skill', description: 'Load a skill package and its SKILL.md instructions.' },
      { id: 'load_skill_resource', label: 'load_skill_resource', description: 'Load a specific file from a skill package.' },
    ],
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'Control the embedded browser and inspect live pages.',
    tools: [
      { id: 'browser_open', label: 'browser_open', description: 'Open a URL or search query in the embedded browser.' },
      { id: 'browser_tabs', label: 'browser_tabs', description: 'List, create, switch, or close browser tabs.' },
      { id: 'browser_read', label: 'browser_read', description: 'Read structured page state from the active browser tab.' },
      { id: 'browser_act', label: 'browser_act', description: 'Click, type, press keys, scroll, or wait in the browser.' },
      { id: 'browser_history', label: 'browser_history', description: 'Go back, forward, or reload the active page.' },
      { id: 'browser_screenshot', label: 'browser_screenshot', description: 'Capture a screenshot of the active page.' },
      { id: 'browser_execute', label: 'browser_execute', description: 'Run custom JavaScript inside the active page.' },
      { id: 'browser_cookies', label: 'browser_cookies', description: 'Read, set, or delete cookies for the active page.' },
    ],
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Search the web and fetch readable page content.',
    tools: [
      { id: 'web_search', label: 'web_search', description: 'Search the web for up-to-date information.' },
      { id: 'web_fetch', label: 'web_fetch', description: 'Fetch and extract readable text from specific URLs.' },
    ],
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Inspect, read, search, and safely update files in the project workspace.',
    tools: [
      { id: 'list_directory', label: 'list_directory', description: 'List files and directories at an absolute path, with optional ignore patterns.' },
      { id: 'read_files', label: 'read_files', description: 'Read one or more files with line numbers. Supports offset/limit pagination.' },
      { id: 'write_file', label: 'write_file', description: 'Create, append to, or overwrite a file in the workspace.' },
      { id: 'edit_files', label: 'edit_files', description: 'Apply transactional search-and-replace edits to existing files. Supports batch edits per file with rollback on failure.' },
      { id: 'glob', label: 'glob', description: 'Fast file search by glob pattern. Respects .gitignore by default, supports dotfile control and custom ignore patterns.' },
      { id: 'grep', label: 'grep', description: 'Fast text/regex search across file contents. Respects .gitignore, supports glob filtering, files-only mode, and multiline matching.' },
    ],
  },
  {
    id: 'shell',
    label: 'Shell',
    description: 'Run shell commands and git operations in the project directory.',
    tools: [
      { id: 'run_command', label: 'run_command', description: 'Run shell commands in the project directory. Supports command sequences, background mode, and large output truncation.' },
      { id: 'git_command', label: 'git_command', description: 'Run tracked git operations in the project directory.' },
    ],
  },
  {
    id: 'image',
    label: 'Image Generation',
    description: 'Generate images from text descriptions using AI models.',
    tools: [
      { id: 'create_image', label: 'create_image', description: 'Generate images from a text prompt using configured image generation provider.' },
    ],
  },
  {
    id: 'design-scaffold',
    label: 'Screens',
    description: 'Create and manage screens within a design (multi-screen).',
    tools: [
      { id: 'create_screen', label: 'create_screen', description: 'Create a new screen inside a design with index.html, styles.css, script.js.' },
      { id: 'delete_screens', label: 'delete_screens', description: 'Delete one or more screens and their files from a design.' },
    ],
  },
  {
    id: 'design-files',
    label: 'Files',
    description: 'Edit and read screen files (batch across screens supported).',
    tools: [
      { id: 'edit_design', label: 'edit_design', description: 'Edit index.html, styles.css or script.js in one or more screens (batch edits).' },
      { id: 'read_design', label: 'read_design', description: 'Read screen files with line numbers. Supports batch reads across screens.' },
    ],
  },
  {
    id: 'design-build',
    label: 'Preview & Console',
    description: 'Refresh the grid preview, capture screenshots, and read console output (per-screen filter optional).',
    tools: [
      { id: 'refresh_preview', label: 'refresh_preview', description: 'Reload the grid preview for the active design.' },
      { id: 'screenshot_screen', label: 'screenshot_screen', description: 'Capture a 1× PNG screenshot of a single screen for visual verification.' },
      { id: 'get_console', label: 'get_console', description: 'Read captured console logs, warnings and errors (aggregate or per-screen).' },
    ],
  },
]

export function buildToolCatalogGroups(mcpServers: McpServerConfig[]): ToolCatalogGroup[] {
  const builtinGroups: ToolCatalogGroup[] = BUILTIN_GROUPS.map(group => ({
    id: group.id,
    label: group.label,
    description: group.description,
    kind: 'builtin',
    tools: group.tools.map(tool => ({
      ...tool,
      groupId: group.id,
      groupLabel: group.label,
      groupDescription: group.description,
      kind: 'builtin' as const,
    })),
  }))

  const aliasedMcpTools = buildMcpAliasedTools(
    mcpServers.filter(server => server.command.trim()),
  )

  const mcpGroups = mcpServers
    .filter(server => server.command.trim())
    .map(server => {
      const groupId = `mcp:${server.id}` as const
      const groupLabel = server.name.trim() || 'MCP Server'
      const groupDescription = 'Tools discovered from this MCP server.'
      const tools = aliasedMcpTools
        .filter(tool => tool.serverId === server.id)
        .map(tool => ({
          id: tool.alias,
          label: tool.toolTitle || tool.toolName,
          description: tool.toolDescription || 'No description provided by this MCP server.',
          groupId,
          groupLabel,
          groupDescription,
          kind: 'mcp' as const,
          serverId: server.id,
          serverName: server.name,
        }))

      return {
        id: groupId,
        label: groupLabel,
        description: groupDescription,
        kind: 'mcp' as const,
        serverId: server.id,
        serverName: server.name,
        tools,
      }
    })

  return [...builtinGroups, ...mcpGroups]
}

export function filterDisabledTools<T extends Record<string, unknown>>(
  toolSet: T,
  disabledToolIds: string[],
): T {
  const disabled = new Set(disabledToolIds)

  return Object.fromEntries(
    Object.entries(toolSet).filter(([toolName]) => !disabled.has(toolName)),
  ) as T
}
