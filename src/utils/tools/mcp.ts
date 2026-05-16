import type { CallToolResult, ToolResultContent } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerConfig } from '@/stores/settings/types'
import { dynamicTool, jsonSchema } from 'ai'
import { getMcpSession } from '@/utils/mcp'
import { buildMcpAliasedTools } from './mcpAliases'

export type McpToolServerConfig = Pick<
  McpServerConfig,
  'id' | 'name' | 'enabled' | 'command' | 'argsText' | 'cwd' | 'envText'
>

function normalizeArguments(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input != null && !Array.isArray(input))
    return input as Record<string, unknown>

  return { value: input }
}

function normalizeContent(
  content: CallToolResult['content'],
): Array<Record<string, unknown>> {
  return content.map(part => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'image':
        return {
          type: 'image',
          mimeType: part.mimeType,
          bytes: part.data.length,
        }
      case 'audio':
        return {
          type: 'audio',
          mimeType: part.mimeType,
          bytes: part.data.length,
        }
      case 'resource':
        return 'text' in part.resource
          ? {
              type: 'resource',
              uri: part.resource.uri,
              mimeType: part.resource.mimeType,
              text: part.resource.text,
            }
          : {
              type: 'resource',
              uri: part.resource.uri,
              mimeType: part.resource.mimeType,
              blobBytes: part.resource.blob.length,
            }
      case 'resource_link':
        return {
          type: 'resource_link',
          uri: part.uri,
          name: part.name,
          mimeType: part.mimeType,
          description: part.description,
        }
      default:
        return {
          type: 'unknown',
          value: part satisfies ToolResultContent,
        }
    }
  })
}

export async function createMcpTools(servers: McpToolServerConfig[]) {
  const enabledServers = servers.filter(server => server.enabled && server.command.trim())
  if (enabledServers.length === 0)
    return {}

  const tools: Record<string, ReturnType<typeof dynamicTool>> = {}

  const discoveredByServer = await Promise.allSettled(enabledServers.map(async server => {
    const session = await getMcpSession(server as McpServerConfig)
    const discovered = await session.listTools()
    return { server, discovered }
  }))

  const successful: Array<{
    server: McpToolServerConfig
    discovered: Array<{
      name: string
      title?: string
      description?: string
      inputSchema: Record<string, unknown>
    }>
  }> = []

  for (const result of discoveredByServer) {
    if (result.status === 'fulfilled')
      successful.push(result.value)
  }

  const aliasEntries = buildMcpAliasedTools(
    successful.map(({ server, discovered }) => ({
      id: server.id,
      name: server.name,
      tools: discovered.map(tool => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description ?? '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      })),
    })),
  )

  for (const { server, discovered } of successful) {
    const aliasByToolName = new Map(
      aliasEntries
        .filter(entry => entry.serverId === server.id)
        .map(entry => [entry.toolName, entry.alias]),
    )

    for (const tool of discovered) {
      const alias = aliasByToolName.get(tool.name) ?? tool.name
      const descriptionParts = [
        `MCP tool from ${server.name}.`,
        tool.title ? `Title: ${tool.title}.` : '',
        tool.description || 'No description provided.',
      ].filter(Boolean)

      tools[alias] = dynamicTool({
        description: descriptionParts.join(' '),
        inputSchema: jsonSchema(tool.inputSchema),
        execute: async input => {
          const liveSession = await getMcpSession(server as McpServerConfig)
          const result = await liveSession.callTool(tool.name, normalizeArguments(input))

          return {
            server: server.name,
            tool: tool.name,
            ok: !result.isError,
            ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
            content: normalizeContent(result.content),
          }
        },
      })
    }
  }

  return tools
}

export function mcpToolDisplayLabel(toolName: string): string {
  if (!toolName.startsWith('mcp__'))
    return `Called ${toolName}`

  const [, rawServer = '', ...rawTool] = toolName.split('__')
  const server = rawServer.replace(/_/g, ' ').trim()
  const tool = rawTool.join(' ').replace(/_/g, ' ').trim()

  if (!server && !tool)
    return 'Used MCP tool'

  return `MCP ${server} - ${tool}`
}
