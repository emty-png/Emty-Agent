import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  CallToolResult,
  JSONRPCMessage,
  ListToolsResult,
  MessageExtraInfo,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServerConfig, McpToolSummary } from '@/stores/settings/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { platform as getOsPlatform } from '@tauri-apps/plugin-os'
import { Command } from '@tauri-apps/plugin-shell'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CONNECT_TIMEOUT_MS = 30_000
const TOOL_CALL_TIMEOUT_MS = 120_000
const STDERR_BUFFER_SIZE = 100

// ---------------------------------------------------------------------------
// Debug logger
// ---------------------------------------------------------------------------
const DEBUG = (import.meta.env?.DEV ?? false) || (import.meta.env?.VITE_MCP_DEBUG === 'true')

function dbg(scope: string, message: string, ...data: unknown[]): void {
  if (!DEBUG)
    return
  if (data.length > 0)
    console.warn(`%c[MCP:${scope}]`, 'color:#7c9ef5;font-weight:bold', message, ...data)
  else
    console.warn(`%c[MCP:${scope}]`, 'color:#7c9ef5;font-weight:bold', message)
}

function dbgWarn(scope: string, message: string, ...data: unknown[]): void {
  console.warn(`[MCP:${scope}]`, message, ...data)
}

function dbgError(scope: string, message: string, ...data: unknown[]): void {
  console.error(`[MCP:${scope}]`, message, ...data)
}

// ---------------------------------------------------------------------------
// OS detection (cached)
// ---------------------------------------------------------------------------
let _isWindows: boolean | null = null

async function isWindows(): Promise<boolean> {
  if (_isWindows !== null)
    return _isWindows
  try {
    const p = await getOsPlatform()
    _isWindows = p === 'windows'
    dbg('platform', `OS: "${p}", isWindows=${_isWindows}`)
  }
  catch (err) {
    _isWindows = navigator.userAgent.toLowerCase().includes('windows')
    dbgWarn('platform', `plugin-os failed, fell back to userAgent. isWindows=${_isWindows}`, err)
  }
  return _isWindows
}

// ---------------------------------------------------------------------------
// Command resolution
//
// On Windows we route every command through `cmd /c <command> [...args]`.
// This gives us:
//   • Full environment / PATH inheritance (no missing .cmd extensions)
//   • No need for a name-mapping table in the Tauri shell scope
//   • cmd.exe is already in the capability scope as name="cmd" cmd="cmd.exe"
//
// On Unix we invoke the binary directly; PATH is inherited automatically
// by Tauri's spawn implementation.
// ---------------------------------------------------------------------------
interface ResolvedCommand {
  /** The scope `name` to pass to Command.create() */
  scopeName: string
  /** The final args array (may be prepended with /c <command> on Windows) */
  args: string[]
}

async function resolveCommand(command: string, args: string[]): Promise<ResolvedCommand> {
  if (await isWindows()) {
    // Route through cmd.exe so PATH, .cmd/.exe resolution all work out of the
    // box without enumerating every possible Windows tool variant in the scope.
    dbg('resolve', `Windows: routing "${command}" through cmd /c`)
    return { scopeName: 'cmd', args: ['/c', command, ...args] }
  }

  dbg('resolve', `Unix: direct invocation of "${command}"`)
  return { scopeName: command, args }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface McpServerParameters {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface McpConnectionSnapshot {
  tools: McpToolSummary[]
  stderr: string[]
}

interface McpSession {
  client: Client
  close: () => Promise<void>
  listTools: () => Promise<McpToolSummary[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
  fingerprint: string
}

interface CachedSession {
  fingerprint: string
  promise: Promise<McpSession>
}

// ---------------------------------------------------------------------------
// Parsers (public — used by UI layer)
// ---------------------------------------------------------------------------
export function parseMcpArgs(argsText: string): string[] {
  return argsText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

export function parseMcpEnv(envText: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line)
      continue
    const idx = line.indexOf('=')
    if (idx <= 0)
      throw new Error(`Invalid environment line: "${line}". Expected KEY=value format.`)
    const key = line.slice(0, idx).trim()
    if (!key)
      throw new Error(`Invalid environment line: "${line}". Missing variable name.`)
    env[key] = line.slice(idx + 1)
  }
  return env
}

function buildServerParameters(
  server: Pick<McpServerConfig, 'command' | 'argsText' | 'cwd' | 'envText'>,
): McpServerParameters {
  const command = server.command.trim()
  if (!command)
    throw new Error('MCP server command is required.')

  const params: McpServerParameters = {
    command,
    args: parseMcpArgs(server.argsText),
    ...(server.cwd.trim() ? { cwd: server.cwd.trim() } : {}),
    ...(server.envText.trim() ? { env: parseMcpEnv(server.envText) } : {}),
  }

  dbg('params', 'Built server parameters', {
    command: params.command,
    args: params.args,
    cwd: params.cwd ?? '(none)',
    envKeys: params.env ? Object.keys(params.env) : [],
  })

  return params
}

function configFingerprint(
  server: Pick<McpServerConfig, 'command' | 'argsText' | 'cwd' | 'envText'>,
): string {
  return JSON.stringify([server.command.trim(), server.argsText, server.cwd.trim(), server.envText])
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP operation timed out after ${ms}ms: ${label}`)),
      ms,
    )
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ---------------------------------------------------------------------------
// TauriStdioTransport
// ---------------------------------------------------------------------------
function extractJsonRpcLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed)
    return null

  // Fast path: the line is already a pure JSON-RPC payload.
  if (trimmed.startsWith('{'))
    return trimmed

  // Windows shells and wrapper scripts can prepend prompts or banners before
  // the actual JSON payload. In that case, extract the JSON object from the
  // first opening brace onward and discard the prefix noise.
  const start = trimmed.indexOf('{')
  if (start === -1)
    return null

  const end = trimmed.lastIndexOf('}')
  if (end === -1 || end < start)
    return null

  return trimmed.slice(start, end + 1)
}

function parseMessage(line: string): JSONRPCMessage | null {
  const payload = extractJsonRpcLine(line)
  if (!payload)
    return null
  return JSON.parse(payload) as JSONRPCMessage
}

function serializeMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`
}

class TauriStdioTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  private child: Awaited<ReturnType<Command<string>['spawn']>> | null = null
  private buffer = ''
  private isClosed = false

  constructor(
    private readonly params: McpServerParameters,
    private readonly onStderr?: (line: string) => void,
  ) {}

  async start(): Promise<void> {
    if (this.child)
      throw new Error('MCP transport already started.')

    const { scopeName, args } = await resolveCommand(this.params.command, this.params.args)

    dbg('transport', `Spawning scope="${scopeName}"`, { args, cwd: this.params.cwd ?? '(none)' })

    const command = Command.create(scopeName, args, {
      ...(this.params.cwd ? { cwd: this.params.cwd } : {}),
      ...(this.params.env ? { env: this.params.env } : {}),
    })

    this.isClosed = false

    command.stdout.on('data', (chunk: string) => {
      dbg('stdout', `← ${chunk.trimEnd()}`)
      this.buffer += chunk
      this.flushBuffer()
    })

    command.stderr.on('data', (chunk: string) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk)
      dbg('stderr', `⚠ ${text.trimEnd()}`)
      this.onStderr?.(text)
    })

    command.on('error', (error: string) => {
      const err = new Error(error)
      dbgError('transport', 'Child process error', err)
      this.onerror?.(err)
    })

    command.on('close', () => {
      dbg('transport', 'Child process closed')
      this.child = null
      this.buffer = ''
      if (!this.isClosed) {
        this.isClosed = true
        this.onclose?.()
      }
    })

    try {
      this.child = await command.spawn()
      dbg('transport', `Process spawned (pid: ${this.child.pid})`)
    }
    catch (err) {
      dbgError('transport', `Failed to spawn scope="${scopeName}"`, err)
      throw err
    }
  }

  private flushBuffer(): void {
    while (true) {
      const nl = this.buffer.indexOf('\n')
      if (nl === -1)
        return

      const rawLine = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)

      if (!rawLine.trim())
        continue

      try {
        const msg = parseMessage(rawLine)
        if (!msg) {
          dbg('message', 'Ignoring non-JSON stdout line', rawLine)
          continue
        }
        dbg('message', '↓ recv', msg)
        this.onmessage?.(msg)
      }
      catch (error) {
        dbgError('message', 'Failed to parse JSON-RPC message', rawLine, error)
        this.onerror?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child)
      throw new Error('MCP transport is not connected.')
    dbg('message', '↑ send', message)
    await this.child.write(serializeMessage(message))
  }

  async close(): Promise<void> {
    dbg('transport', 'Closing transport')
    this.buffer = ''

    if (!this.child) {
      if (!this.isClosed) {
        this.isClosed = true
        this.onclose?.()
      }
      return
    }

    const child = this.child
    this.child = null

    try {
      await child.kill()
      dbg('transport', 'Child process killed')
    }
    catch (err) {
      dbgWarn('transport', 'Failed to kill child (may have already exited)', err)
    }

    if (!this.isClosed) {
      this.isClosed = true
      this.onclose?.()
    }
  }
}

// ---------------------------------------------------------------------------
// Tool summarisation
// ---------------------------------------------------------------------------
function summarizeTools(tools: ListToolsResult['tools']): McpToolSummary[] {
  return tools.map(tool => {
    const summary: McpToolSummary = {
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    }
    if (tool.title)
      summary.title = tool.title
    return summary
  })
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
function augmentError(error: unknown, stderr: string[]): Error {
  const base = error instanceof Error ? error : new Error(String(error))
  if (stderr.length === 0)
    return base
  return new Error(`${base.message}\n\nServer stderr (last ${stderr.length} lines):\n${stderr.join('\n')}`)
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------
async function createMcpSession(server: McpServerConfig): Promise<McpSession> {
  dbg('session', `Creating session for server "${server.id}" (command: "${server.command}")`)

  const stderrBuffer: string[] = []
  const params = buildServerParameters(server)

  const transport = new TauriStdioTransport(params, line => {
    const trimmed = line.trim()
    if (!trimmed)
      return
    stderrBuffer.push(trimmed)
    if (stderrBuffer.length > STDERR_BUFFER_SIZE)
      stderrBuffer.shift()
  })

  const client = new Client(
    { name: 'Emty Agent', version: '0.1.0' },
    { capabilities: {} },
  )

  // Wire up transport-level close so we know if the server crashes
  let sessionDead = false
  transport.onclose = () => {
    if (!sessionDead) {
      sessionDead = true
      dbgWarn('session', `Server "${server.id}" closed unexpectedly`)
    }
  }

  dbg('session', 'Connecting MCP client...')
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect to "${server.id}"`)
  }
  catch (err) {
    await transport.close().catch(() => {})
    throw augmentError(err, stderrBuffer)
  }
  dbg('session', `MCP client connected to "${server.id}"`)

  const close = async (): Promise<void> => {
    sessionDead = true
    dbg('session', `Closing session for server "${server.id}"`)
    await transport.close()
  }

  const listTools = async (): Promise<McpToolSummary[]> => {
    if (sessionDead)
      throw new Error(`Session for "${server.id}" is no longer alive.`)
    dbg('session', `Listing tools for "${server.id}"`)
    const result = await withTimeout(
      client.listTools(),
      TOOL_CALL_TIMEOUT_MS,
      `listTools on "${server.id}"`,
    )
    dbg('session', `Got ${result.tools.length} tool(s)`, result.tools.map(t => t.name))
    return summarizeTools(result.tools)
  }

  const callTool = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    if (sessionDead)
      throw new Error(`Session for "${server.id}" is no longer alive.`)
    dbg('session', `Calling tool "${name}" on "${server.id}"`, args)
    const result = await withTimeout(
      client.callTool({ name, arguments: args }, CallToolResultSchema),
      TOOL_CALL_TIMEOUT_MS,
      `callTool "${name}" on "${server.id}"`,
    )
    dbg('session', `Tool "${name}" returned`, result)
    return result as CallToolResult
  }

  return {
    client,
    close,
    listTools,
    callTool,
    fingerprint: configFingerprint(server),
  }
}

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------
const sessionCache = new Map<string, CachedSession>()
// Tab-scoped association: which tabs have used which serverIds (for kill-all)
const tabServerMap = new Map<string, Set<string>>()

function associateTabServer(tabId: string, serverId: string): void {
  let set = tabServerMap.get(tabId)
  if (!set) {
    set = new Set()
    tabServerMap.set(tabId, set)
  }
  set.add(serverId)
}

export function invalidateMcpSessionsForTab(tabId: string): void {
  const servers = tabServerMap.get(tabId)
  if (!servers || servers.size === 0)
    return
  for (const serverId of [...servers])
    invalidateMcpServerSession(serverId)
  tabServerMap.delete(tabId)
}

export async function getMcpSession(server: McpServerConfig, tabId?: string): Promise<McpSession> {
  if (tabId)
    associateTabServer(tabId, server.id)
  const fingerprint = configFingerprint(server)
  const cached = sessionCache.get(server.id)

  if (cached?.fingerprint === fingerprint) {
    dbg('cache', `Cache hit for server "${server.id}"`)
    return cached.promise
  }

  if (cached) {
    dbg('cache', `Config changed for "${server.id}", invalidating old session`)
    invalidateMcpServerSession(server.id)
  }
  else {
    dbg('cache', `No cached session for "${server.id}", creating new one`)
  }

  const promise = createMcpSession(server).catch(error => {
    dbgError('cache', `Session creation failed for "${server.id}", removing from cache`, error)
    sessionCache.delete(server.id)
    throw error
  })

  sessionCache.set(server.id, { fingerprint, promise })
  return promise
}

export function invalidateMcpServerSession(serverId: string): void {
  const cached = sessionCache.get(serverId)
  if (!cached) {
    dbg('cache', `invalidate: no session found for "${serverId}"`)
    return
  }
  dbg('cache', `Invalidating session for "${serverId}"`)
  sessionCache.delete(serverId)
  cached.promise
    .then(session => session.close())
    .catch(err => dbgWarn('cache', `Error closing invalidated session for "${serverId}"`, err))
}

export function disconnectAllMcpSessions(): void {
  dbg('cache', `Disconnecting all sessions (${sessionCache.size} active)`)
  for (const serverId of [...sessionCache.keys()])
    invalidateMcpServerSession(serverId)
}

// ---------------------------------------------------------------------------
// One-shot inspection (no caching — used by the "Test connection" button)
// ---------------------------------------------------------------------------
export async function inspectMcpServer(server: McpServerConfig): Promise<McpConnectionSnapshot> {
  dbg('inspect', `Inspecting server "${server.id}" (command: "${server.command}")`)

  const stderrLines: string[] = []
  const params = buildServerParameters(server)

  const transport = new TauriStdioTransport(params, line => {
    const trimmed = line.trim()
    if (trimmed)
      stderrLines.push(trimmed)
  })

  const client = new Client(
    { name: 'Emty Agent', version: '0.1.0' },
    { capabilities: {} },
  )

  try {
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `inspect connect to "${server.id}"`,
    )
    dbg('inspect', 'Connected, listing tools...')

    const result = await withTimeout(
      client.listTools(),
      TOOL_CALL_TIMEOUT_MS,
      `inspect listTools on "${server.id}"`,
    )
    dbg('inspect', `Discovered ${result.tools.length} tool(s)`, result.tools.map(t => t.name))

    return { tools: summarizeTools(result.tools), stderr: stderrLines }
  }
  catch (error) {
    dbgError('inspect', `Inspection failed for "${server.id}"`, error, { stderr: stderrLines })
    throw augmentError(error, stderrLines)
  }
  finally {
    await transport.close().catch(err =>
      dbgWarn('inspect', 'Error closing transport after inspect', err),
    )
  }
}
