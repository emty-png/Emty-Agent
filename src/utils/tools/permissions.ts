import type { ToolSet } from '@/utils/ai'
import { tool } from 'ai'

export type ToolPermissionMode = 'ask' | 'auto'
export type ToolPermissionDecision = 'allow-once' | 'allow-session' | 'deny'
const NO_PERMISSION_TOOL_NAMES = new Set(['ask_questions', 'create_task', 'update_task', 'list_tasks', 'get_task', 'sleep', 'write_plan'])

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
    case 'list_directory': {
      const ignore = asStringList(args.ignore)
      return {
        actionTitle: `List ${formatPath(args.path)}`,
        actionDetails: [
          `Directory: ${formatPath(args.path)}`,
          ...(ignore.length > 0 ? [`Ignore: ${formatList(ignore)}`] : []),
        ],
      }
    }

    case 'read_files': {
      const paths = Array.isArray(args.file_paths)
        ? args.file_paths.filter((p): p is string => typeof p === 'string')
        : []
      const offset = typeof args.offset === 'number' ? args.offset : 1
      const limit = typeof args.limit === 'number' ? args.limit : 300
      return {
        actionTitle: `Read ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
        actionDetails: [
          `Files: ${paths.length > 0 ? formatList(paths) : 'none specified'}`,
          `Line range per file: ${offset}-${offset + limit - 1}`,
        ],
      }
    }

    case 'write_files':
    case 'write_file': {
      if (toolName === 'write_file') {
        const path = typeof args.file_path === 'string' ? args.file_path : 'none specified'
        return {
          actionTitle: `Write ${path}`,
          actionDetails: [
            `Target: ${path}`,
            'Action: create a new file or fully replace the existing contents',
          ],
        }
      }

      const files = Array.isArray(args.files)
        ? args.files
            .filter((file): file is { path: string; createOnly?: boolean } =>
              typeof file === 'object' && file != null && 'path' in file && typeof file.path === 'string')
            .map(file => file.createOnly ? `${file.path} (create only)` : file.path)
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
        ? args.edits.filter((edit): edit is Record<string, unknown> =>
            typeof edit === 'object' && edit != null)
        : []
      const uniquePaths = [...new Set(
        edits
          .map(edit => typeof edit.file_path === 'string' ? edit.file_path : '')
          .filter(Boolean),
      )]
      return {
        actionTitle: `Edit ${uniquePaths.length === 1 ? uniquePaths[0] : `${uniquePaths.length} files`}`,
        actionDetails: [
          `Targets: ${uniquePaths.length > 0 ? formatList(uniquePaths) : 'none specified'}`,
          `Edit operations: ${edits.length}`,
        ],
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
          ...(typeof args.glob === 'string' ? [`File filter: ${args.glob}`] : []),
          ...(args.case_sensitive === false ? ['Case-insensitive'] : []),
          ...(args.files_only ? ['Files only'] : []),
        ],
      }

    case 'run_command': {
      const isBg = args.is_background === true
      const command = typeof args.command === 'string' ? args.command : ''
      const timeout = typeof args.timeout_ms === 'number' ? Math.round(args.timeout_ms / 1000) : 120

      if (isBg) {
        return {
          actionTitle: 'Start background command',
          actionDetails: [`Command: ${truncate(command, 140)}`],
        }
      }

      return {
        actionTitle: 'Run shell command',
        actionDetails: [
          `Command: ${truncate(command, 120)}`,
          ...(timeout !== 120 ? [`Timeout: ${timeout}s`] : []),
        ],
      }
    }

    case 'git_command': {
      const action = typeof args.action === 'string' ? args.action : 'exec'
      if (action === 'status') {
        return {
          actionTitle: 'Check git task status',
          actionDetails: [`Task id: ${String(args.id ?? 'unknown')}`],
        }
      }
      if (action === 'kill') {
        return {
          actionTitle: 'Stop git task',
          actionDetails: [`Task id: ${String(args.id ?? 'unknown')}`],
        }
      }
      if (action === 'list') {
        return {
          actionTitle: 'List command tasks',
          actionDetails: ['Show all tracked shell and git tasks.'],
        }
      }

      const commands = [
        ...(typeof args.command === 'string'
          ? [{ args: args.command.split(/\s+/).filter(Boolean) }]
          : Array.isArray(args.command)
            ? [{ args: args.command.filter((part: unknown): part is string => typeof part === 'string' && part.trim().length > 0) }]
            : []),
        ...(Array.isArray(args.commands)
          ? args.commands.flatMap(command => {
              if (typeof command === 'string')
                return [{ args: command.split(/\s+/).filter(Boolean) }]
              if (typeof command === 'object' && command != null && 'args' in command && Array.isArray(command.args))
                return [{ args: command.args.filter((part: unknown): part is string => typeof part === 'string' && part.trim().length > 0) }]
              return []
            })
          : []),
      ].filter(command => command.args.length > 0)
      return {
        actionTitle: `Run ${commands.length === 1 ? 'git command' : `${commands.length} git commands`}`,
        actionDetails: [
          ...commands.slice(0, 4).map((command, index) => `Step ${index + 1}: git ${formatCommand(command.args)}`),
          ...(typeof args.waitForMs === 'number' ? [`Wait before returning: ${args.waitForMs} ms`] : []),
        ],
      }
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

    case 'create_task':
      return {
        actionTitle: `Create task: ${truncate(String(args.subject ?? ''), 80)}`,
        actionDetails: [
          `Subject: ${truncate(String(args.subject ?? ''), 120)}`,
          ...(typeof args.description === 'string'
            ? [`Description: ${truncate(args.description, 120)}`]
            : []),
        ],
      }

    case 'update_task':
      return {
        actionTitle: args.status === 'deleted'
          ? `Delete task #${String(args.taskId ?? '?')}`
          : `Update task #${String(args.taskId ?? '?')}`,
        actionDetails: [
          `Task: #${String(args.taskId ?? '?')}`,
          ...(typeof args.status === 'string' ? [`Status → ${args.status}`] : []),
          ...(typeof args.subject === 'string'
            ? [`Subject: ${truncate(args.subject, 100)}`]
            : []),
        ],
      }

    case 'list_tasks':
      return {
        actionTitle: 'List all tasks',
        actionDetails: ['Read the current task list.'],
      }

    case 'get_task':
      return {
        actionTitle: `Get task #${String(args.taskId ?? '?')}`,
        actionDetails: [`Task: #${String(args.taskId ?? '?')}`],
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
    onToolExecutionStart?: (event: {
      toolName: string
      args: Record<string, unknown>
      toolCallId?: string
    }) => void
  },
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, toolDef]) => [
      toolName,
      tool({
        description: toolDef.description ?? '',
        inputSchema: toolDef.inputSchema,
        execute: async (args, execOptions) => {
          const normalizedArgs = (args ?? {}) as Record<string, unknown>
          const toolCallId = typeof (execOptions as { toolCallId?: unknown }).toolCallId === 'string'
            ? (execOptions as { toolCallId: string }).toolCallId
            : undefined
          const notifyExecutionStart = () => {
            options.onToolExecutionStart?.({
              toolName,
              args: normalizedArgs,
              ...(toolCallId ? { toolCallId } : {}),
            })
          }

          if (NO_PERMISSION_TOOL_NAMES.has(toolName)) {
            notifyExecutionStart()
            return await toolDef.execute?.(args, execOptions)
          }

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

          notifyExecutionStart()
          return await toolDef.execute?.(args, execOptions)
        },
      }),
    ]),
  ) as ToolSet
}
