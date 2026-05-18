import type { ToolSet } from '@/utils/ai'
import { tool } from 'ai'

export type ToolPermissionMode = 'ask' | 'auto'
export type ToolPermissionDecision = 'allow-once' | 'allow-session' | 'deny'
const NO_PERMISSION_TOOL_NAMES = new Set(['ask_questions', 'write_todo'])

export interface ToolPermissionRequest {
  tabId: string
  toolName: string
  toolLabel: string
  actionTitle: string
  actionDetails: string[]
}

export type RequestToolPermission = (
  request: ToolPermissionRequest,
) => Promise<ToolPermissionDecision>

export class ToolPermissionDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool "${toolName}" was denied by the user.`)
    this.name = 'ToolPermissionDeniedError'
  }
}

function truncate(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

function quoted(value: unknown, max = 100): string {
  return `"${truncate(String(value ?? ''), max)}"`
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatPath(path: unknown): string {
  const value = typeof path === 'string' ? path.trim() : ''
  return !value || value === '.' ? 'project root' : value
}

function formatList(values: string[], max = 4): string {
  if (values.length <= max)
    return values.join(', ')
  return `${values.slice(0, max).join(', ')} +${values.length - max} more`
}

function formatCommand(args: string[]): string {
  return args.map(part => part.includes(' ') ? quoted(part, 60) : part).join(' ')
}

function fallbackDetailLines(args: Record<string, unknown>): string[] {
  const lines = Object.entries(args)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const items = value.map(item => truncate(typeof item === 'string' ? item : JSON.stringify(item), 60))
        return `${key}: ${formatList(items, 3)}`
      }
      if (typeof value === 'object' && value != null)
        return `${key}: ${truncate(JSON.stringify(value), 100)}`
      return `${key}: ${truncate(String(value), 100)}`
    })
    .filter(Boolean)

  return lines.length > 0 ? lines : ['No additional details provided.']
}

export function buildPermissionPreview(toolName: string, args: Record<string, unknown>): {
  actionTitle: string
  actionDetails: string[]
} {
  switch (toolName) {
    case 'list_directory':
      return {
        actionTitle: `List ${formatPath(args.path)}`,
        actionDetails: [
          `Directory: ${formatPath(args.path)}`,
          `Hidden entries: ${args.showHidden ? 'included' : 'excluded'}`,
        ],
      }

    case 'read_files': {
      const paths = asStringList(args.paths)
      const offset = typeof args.offset === 'number' ? args.offset : 0
      const limit = typeof args.limit === 'number' ? args.limit : 500
      return {
        actionTitle: `Read ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
        actionDetails: [
          `Files: ${paths.length > 0 ? formatList(paths) : 'none specified'}`,
          `Line range per file: ${offset}-${offset + limit - 1}`,
        ],
      }
    }

    case 'write_files': {
      const files = Array.isArray(args.files)
        ? args.files
            .filter((file): file is { path: string } =>
              typeof file === 'object' && file != null && 'path' in file && typeof file.path === 'string')
            .map(file => file.path)
        : []
      return {
        actionTitle: `Write ${files.length === 1 ? files[0] : `${files.length} files`}`,
        actionDetails: [
          `Targets: ${files.length > 0 ? formatList(files) : 'none specified'}`,
          'Action: create new files or fully replace existing file contents',
        ],
      }
    }

    case 'edit_files': {
      const edits = Array.isArray(args.edits)
        ? args.edits.filter((edit): edit is { path: string } =>
            typeof edit === 'object' && edit != null && 'path' in edit && typeof edit.path === 'string')
        : []
      const uniquePaths = [...new Set(edits.map(edit => edit.path))]
      return {
        actionTitle: `Edit ${uniquePaths.length === 1 ? uniquePaths[0] : `${uniquePaths.length} files`}`,
        actionDetails: [
          `Targets: ${uniquePaths.length > 0 ? formatList(uniquePaths) : 'none specified'}`,
          `Edit operations: ${edits.length}`,
        ],
      }
    }

    case 'modify_files': {
      const operations = Array.isArray(args.operations)
        ? args.operations.filter((operation): operation is Record<string, unknown> => typeof operation === 'object' && operation != null)
        : []
      return {
        actionTitle: `Apply ${operations.length} filesystem operation${operations.length === 1 ? '' : 's'}`,
        actionDetails: operations.slice(0, 5).map(operation => {
          const op = String(operation.op ?? 'operation')
          if (op === 'delete')
            return `Delete ${formatPath(operation.path)}`
          if (op === 'mkdir')
            return `Create directory ${formatPath(operation.path)}`
          if (op === 'copy' || op === 'move' || op === 'rename')
            return `${op[0]?.toUpperCase() ?? ''}${op.slice(1)} ${formatPath(operation.from)} -> ${formatPath(operation.to)}`
          return truncate(JSON.stringify(operation), 100)
        }),
      }
    }

    case 'glob':
      return {
        actionTitle: `Find files matching ${quoted(args.pattern, 72)}`,
        actionDetails: [
          `Pattern: ${quoted(args.pattern, 100)}`,
          `Search root: ${formatPath(args.path)}`,
        ],
      }

    case 'grep':
      return {
        actionTitle: `Search ${formatPath(args.path)} for ${quoted(args.pattern, 72)}`,
        actionDetails: [
          `Pattern: ${quoted(args.pattern, 100)}`,
          `Search root: ${formatPath(args.path)}`,
          ...(typeof args.fileGlob === 'string' ? [`File filter: ${args.fileGlob}`] : []),
          ...(args.caseSensitive ? ['Case-sensitive search enabled'] : []),
          ...(args.fuzzy ? ['Fuzzy matching enabled'] : []),
        ],
      }

    case 'run_command': {
      const commands = asStringList(args.commands)
      return {
        actionTitle: `Run ${commands.length === 1 ? 'shell command' : `${commands.length} shell commands`}`,
        actionDetails: commands.slice(0, 4).map((command, index) => `Step ${index + 1}: ${truncate(command, 120)}`),
      }
    }

    case 'git_command': {
      const commands = Array.isArray(args.commands)
        ? args.commands.filter((command): command is { args: string[] } =>
            typeof command === 'object' && command != null && 'args' in command && Array.isArray(command.args))
        : []
      return {
        actionTitle: `Run ${commands.length === 1 ? 'git command' : `${commands.length} git commands`}`,
        actionDetails: commands.slice(0, 4).map((command, index) => `Step ${index + 1}: git ${formatCommand(command.args)}`),
      }
    }

    case 'run_bg_command':
      return {
        actionTitle: 'Start background command',
        actionDetails: [
          `Command: ${truncate(String(args.command ?? ''), 140)}`,
          ...(typeof args.label === 'string' && args.label.trim() ? [`Label: ${args.label.trim()}`] : []),
        ],
      }

    case 'bg_command_status':
      return {
        actionTitle: 'Check background command status',
        actionDetails: [`Process id: ${String(args.id ?? 'unknown')}`],
      }

    case 'kill_bg_command':
      return {
        actionTitle: 'Stop background command',
        actionDetails: [`Process id: ${String(args.id ?? 'unknown')}`],
      }

    case 'web_search': {
      const queries = asStringList(args.queries)
      return {
        actionTitle: 'Search the web',
        actionDetails: queries.slice(0, 5).map((query, index) => `Query ${index + 1}: ${truncate(query, 120)}`),
      }
    }

    case 'web_fetch': {
      const urls = asStringList(args.urls)
      return {
        actionTitle: `Fetch ${urls.length === 1 ? 'web page' : `${urls.length} web pages`}`,
        actionDetails: urls.slice(0, 5).map((url, index) => `URL ${index + 1}: ${truncate(url, 140)}`),
      }
    }

    case 'browser_open':
      return {
        actionTitle: 'Open page in embedded browser',
        actionDetails: [
          `Target: ${truncate(String(args.url ?? ''), 140)}`,
          `Open in new tab: ${args.newTab ? 'yes' : 'no'}`,
        ],
      }

    case 'browser_tabs':
      return {
        actionTitle: 'Manage embedded browser tabs',
        actionDetails: [
          `Action: ${String(args.action ?? 'list')}`,
          ...(typeof args.pageId === 'string' ? [`Page id: ${args.pageId}`] : []),
        ],
      }

    case 'browser_read':
      return {
        actionTitle: 'Read page state from embedded browser',
        actionDetails: [
          `Mode: ${String(args.mode ?? 'snapshot')}`,
          ...(typeof args.selector === 'string' ? [`Selector: ${args.selector}`] : []),
          ...(typeof args.text === 'string' ? [`Text match: ${truncate(args.text, 100)}`] : []),
        ],
      }

    case 'browser_act':
      return {
        actionTitle: 'Interact with embedded browser',
        actionDetails: [
          `Action: ${String(args.action ?? 'unknown')}`,
          ...(typeof args.selector === 'string' ? [`Selector: ${args.selector}`] : []),
          ...(typeof args.text === 'string' ? [`Text match: ${truncate(args.text, 100)}`] : []),
          ...(typeof args.value === 'string' ? [`Input text: ${truncate(args.value, 100)}`] : []),
          ...(typeof args.key === 'string' ? [`Key: ${args.key}`] : []),
        ],
      }

    case 'browser_history':
      return {
        actionTitle: 'Navigate browser history',
        actionDetails: [`Action: ${String(args.action ?? 'reload')}`],
      }

    case 'browser_screenshot':
      return {
        actionTitle: 'Capture browser screenshot',
        actionDetails: ['Take a screenshot of the currently active browser page.'],
      }

    case 'browser_execute':
      return {
        actionTitle: 'Execute JavaScript in embedded browser',
        actionDetails: [`Script: ${truncate(String(args.script ?? ''), 160)}`],
      }

    case 'browser_cookies':
      return {
        actionTitle: 'Manage browser cookies',
        actionDetails: [
          `Action: ${String(args.action ?? 'get')}`,
          ...(typeof args.url === 'string' ? [`URL: ${truncate(args.url, 120)}`] : []),
          ...(typeof args.name === 'string' ? [`Cookie name: ${args.name}`] : []),
        ],
      }

    case 'load_skill':
      return {
        actionTitle: 'Load skill package',
        actionDetails: [`Skill id: ${String(args.skill_id ?? 'unknown')}`],
      }

    case 'load_skill_resource':
      return {
        actionTitle: 'Load skill resource',
        actionDetails: [
          `Skill id: ${String(args.skill_id ?? 'unknown')}`,
          `Resource: ${String(args.resource_path ?? 'unknown')}`,
        ],
      }

    case 'spawn_subagent':
      return {
        actionTitle: `Spawn ${String(args.personality ?? 'sub-agent')} sub-agent`,
        actionDetails: [
          `Personality: ${String(args.personality ?? 'unknown')}`,
          `Mission: ${truncate(String(args.mission ?? ''), 160)}`,
        ],
      }

    case 'ask_questions': {
      const questions = Array.isArray(args.questions)
        ? args.questions.filter((question): question is { question: string } =>
            typeof question === 'object' && question != null && 'question' in question && typeof question.question === 'string')
        : []
      return {
        actionTitle: `Ask ${questions.length} question${questions.length === 1 ? '' : 's'}`,
        actionDetails: questions.slice(0, 5).map((question, index) => `Question ${index + 1}: ${truncate(question.question, 120)}`),
      }
    }

    case 'write_todo': {
      const items = Array.isArray(args.items)
        ? args.items.filter((item): item is { text: string; done: boolean } =>
            typeof item === 'object' && item != null && 'text' in item && typeof item.text === 'string')
        : []
      return {
        actionTitle: 'Update todo list',
        actionDetails: items.slice(0, 6).map(item => `${item.done ? 'Done' : 'Open'}: ${truncate(item.text, 120)}`),
      }
    }

    case 'remember_memory':
      return {
        actionTitle: `Save ${String(args.scope ?? 'project')} memory`,
        actionDetails: [
          `Kind: ${String(args.kind ?? 'note')}`,
          `Title: ${truncate(String(args.title ?? ''), 120)}`,
          `Content: ${truncate(String(args.content ?? ''), 140)}`,
        ],
      }

    default:
      if (toolName.startsWith('mcp__')) {
        const [, rawServer = '', ...rawTool] = toolName.split('__')
        return {
          actionTitle: 'Run MCP tool',
          actionDetails: [
            `Server: ${rawServer.replace(/_/g, ' ') || 'unknown'}`,
            `Tool: ${rawTool.join(' ').replace(/_/g, ' ') || toolName}`,
            ...fallbackDetailLines(args).slice(0, 5),
          ],
        }
      }

      return {
        actionTitle: `Run ${toolName}`,
        actionDetails: fallbackDetailLines(args).slice(0, 5),
      }
  }
}

export function wrapToolSetWithPermissions(
  tools: ToolSet,
  options: {
    tabId: string
    requestPermission: RequestToolPermission
    getToolLabel: (toolName: string, args: Record<string, unknown>) => string
  },
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, toolDef]) => [
      toolName,
      tool({
        description: toolDef.description ?? '',
        inputSchema: toolDef.inputSchema,
        execute: async (args, execOptions) => {
          if (NO_PERMISSION_TOOL_NAMES.has(toolName))
            return await toolDef.execute?.(args, execOptions)

          const normalizedArgs = (args ?? {}) as Record<string, unknown>
          const preview = buildPermissionPreview(toolName, normalizedArgs)
          const decision = await options.requestPermission({
            tabId: options.tabId,
            toolName,
            toolLabel: options.getToolLabel(toolName, normalizedArgs),
            actionTitle: preview.actionTitle,
            actionDetails: preview.actionDetails,
          })

          if (decision === 'deny')
            throw new ToolPermissionDeniedError(toolName)

          return await toolDef.execute?.(args, execOptions)
        },
      }),
    ]),
  ) as ToolSet
}
