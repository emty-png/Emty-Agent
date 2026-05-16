export interface McpAliasInputTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpAliasInputServer {
  id: string
  name: string
  tools: McpAliasInputTool[]
}

export interface McpAliasedTool {
  alias: string
  serverId: string
  serverName: string
  toolName: string
  toolTitle?: string
  toolDescription: string
  inputSchema: Record<string, unknown>
}

export function slugifyToolAliasPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'server'
}

export function aliasForMcpTool(serverName: string, toolName: string): string {
  return `mcp__${slugifyToolAliasPart(serverName)}__${slugifyToolAliasPart(toolName)}`
}

export function makeUniqueToolAlias(base: string, usedAliases: Set<string>): string {
  if (!usedAliases.has(base)) {
    usedAliases.add(base)
    return base
  }

  let index = 2
  while (usedAliases.has(`${base}__${index}`))
    index++

  const alias = `${base}__${index}`
  usedAliases.add(alias)
  return alias
}

export function buildMcpAliasedTools(
  servers: McpAliasInputServer[],
): McpAliasedTool[] {
  const usedAliases = new Set<string>()

  return servers.flatMap(server =>
    server.tools.map(tool => ({
      alias: makeUniqueToolAlias(aliasForMcpTool(server.name, tool.name), usedAliases),
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      ...(tool.title ? { toolTitle: tool.title } : {}),
      toolDescription: tool.description,
      inputSchema: tool.inputSchema,
    })),
  )
}
