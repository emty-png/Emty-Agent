import type { McpServerConfig } from '@/stores/settings/types'
import { buildMcpAliasedTools } from './mcpAliases'

export type BuiltinToolGroupId
  = | 'agent'
    | 'skills'
    | 'browser'
    | 'web'
    | 'filesystem'
    | 'shell'

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
      { id: 'write_todo', label: 'write_todo', description: 'Maintain the live todo list in the chat UI.' },
      { id: 'spawn_subagent', label: 'spawn_subagent', description: 'Delegate focused work to a sub-agent tab.' },
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
    description: 'Inspect, read, write, and modify files in the project workspace.',
    tools: [
      { id: 'list_directory', label: 'list_directory', description: 'List files and folders in a directory.' },
      { id: 'read_files', label: 'read_files', description: 'Read one or more files from the workspace.' },
      { id: 'write_files', label: 'write_files', description: 'Create or overwrite files in the workspace.' },
      { id: 'edit_files', label: 'edit_files', description: 'Apply targeted search-and-replace edits to files.' },
      { id: 'modify_files', label: 'modify_files', description: 'Move, copy, rename, delete, or create paths.' },
      { id: 'glob', label: 'glob', description: 'Find files by glob pattern.' },
      { id: 'grep', label: 'grep', description: 'Search file contents by pattern.' },
    ],
  },
  {
    id: 'shell',
    label: 'Shell',
    description: 'Run commands, git operations, and long-lived background processes.',
    tools: [
      { id: 'run_command', label: 'run_command', description: 'Run shell commands in the project directory.' },
      { id: 'git_command', label: 'git_command', description: 'Run git operations in the project directory.' },
      { id: 'run_bg_command', label: 'run_bg_command', description: 'Start a background shell command.' },
      { id: 'bg_command_status', label: 'bg_command_status', description: 'Check status and output of a background command.' },
      { id: 'kill_bg_command', label: 'kill_bg_command', description: 'Stop a running background command.' },
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
