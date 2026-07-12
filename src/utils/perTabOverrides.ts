import type { ChatTab } from '@/stores/chat'
import type { McpServerConfig } from '@/stores/settings/types'

/**
 * Resolve the effective disabled skill IDs for a given tab.
 * If the tab has per-tab overrides, use those.
 * Otherwise, fall back to the global disabledSkillIds from settings.
 */
export function getEffectiveDisabledSkillIds(
  tab: ChatTab | undefined,
  globalDisabledSkillIds: string[],
): string[] {
  if (tab?.disabledSkillIds)
    return tab.disabledSkillIds
  return globalDisabledSkillIds
}

/**
 * Resolve the effective MCP servers for a given tab, applying per-tab overrides.
 * If the tab has per-tab overrides, server enabled state is resolved from that
 * disabled list. Otherwise, use global settings.
 */
export function getEffectiveMcpServers(
  tab: ChatTab | undefined,
  globalMcpServers: McpServerConfig[],
): McpServerConfig[] {
  if (!tab?.disabledMcpServerIds)
    return globalMcpServers

  const disabledSet = new Set(tab.disabledMcpServerIds)
  return globalMcpServers.map(server => ({
    ...server,
    enabled: !disabledSet.has(server.id),
  }))
}
