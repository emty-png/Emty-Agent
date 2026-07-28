<script setup lang="ts">
import { AlertCircle, Plug, Puzzle, Sparkles } from 'lucide-vue-next'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { getEffectiveDisabledSkillIds, getEffectiveMcpServers } from '@/utils/perTabOverrides'

type SkillSource = 'builtin' | 'global' | 'project'

const props = defineProps<{
  tabId: string
}>()

const SKILL_GROUP_LABELS: Record<SkillSource, string> = {
  builtin: 'Built-in',
  global: 'Global Skills',
  project: 'Project Skills',
}

const s = useSettingsStore()
const chat = useChatStore()
const tab = computed(() => chat.tabs.find(item => item.id === props.tabId))

const hasNothingConfigured = computed(() =>
  s.mcpServers.length === 0 && s.availableSkills.length === 0,
)

const effectiveDisabledSkillIds = computed(() => getEffectiveDisabledSkillIds(tab.value, s.disabledSkillIds))
const effectiveMcpServers = computed(() => getEffectiveMcpServers(tab.value, s.mcpServers))
const configuredSkills = computed(() => {
  const disabledSet = new Set(effectiveDisabledSkillIds.value)
  return s.availableSkills.map(skill => ({
    ...skill,
    enabled: !disabledSet.has(skill.id),
  }))
})

const activeMcpCount = computed(() => effectiveMcpServers.value.filter(server => server.enabled).length)
const activeSkillCount = computed(() => configuredSkills.value.filter(skill => skill.enabled).length)

// Renders built-in/global/project skills as ordered sections, skipping any group that's empty.
const skillGroups = computed(() =>
  (Object.keys(SKILL_GROUP_LABELS) as SkillSource[])
    .map(source => ({
      source,
      label: SKILL_GROUP_LABELS[source],
      skills: configuredSkills.value.filter(skill => skill.source === source),
    }))
    .filter(group => group.skills.length > 0),
)

function toggleMcp(id: string, currentlyEnabled: boolean) {
  if (!tab.value) {
    s.updateMcpServer(id, { enabled: !currentlyEnabled })
    return
  }

  const disabled = new Set(
    tab.value.disabledMcpServerIds
    ?? s.mcpServers.filter(server => !server.enabled).map(server => server.id),
  )
  if (currentlyEnabled)
    disabled.add(id)
  else
    disabled.delete(id)
  tab.value.disabledMcpServerIds = [...disabled]
}

function toggleSkill(id: string, currentlyEnabled: boolean) {
  if (!tab.value) {
    s.setSkillEnabled(id, !currentlyEnabled)
    return
  }

  const disabled = new Set(tab.value.disabledSkillIds ?? s.disabledSkillIds)
  if (currentlyEnabled)
    disabled.add(id)
  else
    disabled.delete(id)
  tab.value.disabledSkillIds = [...disabled]
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-[16px] bg-gradient-to-b from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />

    <div class="flex flex-1 min-h-0 flex-col gap-[14px] overflow-y-auto px-[12px] pb-[12px] pt-[16px] [scrollbar-color:var(--color-border-bright)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[var(--radius-md)] [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-bright)] [&::-webkit-scrollbar]:w-[4px]">
      <div v-if="hasNothingConfigured" class="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-[8px] px-[18px] py-[32px] text-center">
        <div class="flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)]">
          <Puzzle :size="18" :stroke-width="1.8" />
        </div>
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
          No skills or MCP servers
        </p>
        <p class="m-0 text-[12px] leading-[1.6] text-[var(--color-text-tertiary)]">
          Configure them in Settings.
        </p>
      </div>

      <template v-else>
        <section class="flex-shrink-0 overflow-hidden rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shadow-[0_1px_3px_rgba(0,0,0,0.05)] [contain:layout_style]">
          <header class="flex min-h-[38px] items-center justify-between gap-[10px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[12px] py-[8px]">
            <div class="inline-flex min-w-0 items-center gap-[6px]">
              <Plug :size="14" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-dim)]" />
              <h3 class="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold tracking-[0.01em] text-[var(--color-text-primary)]">
                MCP Servers
              </h3>
            </div>
            <span v-if="s.mcpServers.length" class="shrink-0 text-[11px] font-medium text-[var(--color-text-dim)]">
              {{ activeMcpCount }}/{{ s.mcpServers.length }} active
            </span>
          </header>

          <div class="flex flex-col py-[4px]">
            <p v-if="s.mcpServers.length === 0" class="m-0 px-[12px] py-[16px] text-[12px] leading-[1.5] text-[var(--color-text-tertiary)]">
              No MCP servers connected. Configure them in Settings.
            </p>

            <button
              v-for="server in effectiveMcpServers"
              :key="server.id"
              class="group flex w-full min-h-[36px] cursor-pointer items-center justify-between gap-[10px] border-none bg-transparent px-[12px] py-[8px] text-left text-[var(--color-text-secondary)] transition-[background,color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
              :class="{ '!text-[var(--color-text-primary)]': server.enabled }"
              @click="toggleMcp(server.id, server.enabled)"
            >
              <div class="flex min-w-0 flex-1 items-center gap-[8px]">
                <span
                  class="h-[6px] w-[6px] shrink-0 rounded-full transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                  :class="[
                    server.enabled && server.status === 'ok' ? 'bg-[var(--color-success-text)] shadow-[0_0_6px_var(--color-success-muted)]'
                    : server.enabled && server.status === 'error' ? 'bg-[var(--color-danger)] shadow-[0_0_6px_var(--color-danger-muted)]'
                      : 'bg-[var(--color-text-dim)]',
                  ]"
                />
                <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tracking-[0.01em]">{{ server.name }}</span>
                <span
                  v-if="server.enabled && server.status === 'error' && server.statusMessage"
                  class="inline-flex shrink items-center gap-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-[inherit] text-[10.5px] text-[var(--color-danger)]"
                >
                  <AlertCircle :size="10" :stroke-width="2" />
                  {{ server.statusMessage }}
                </span>
                <span v-else-if="server.enabled && server.toolCount != null" class="shrink overflow-hidden text-ellipsis whitespace-nowrap font-[var(--font-mono)] text-[10.5px] text-[var(--color-text-tertiary)]">
                  {{ server.toolCount }} tools
                </span>
              </div>

              <span
                class="relative h-[16px] w-[28px] shrink-0 rounded-full transition-[background] duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="server.enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'"
              >
                <span
                  class="absolute left-[2px] top-[2px] h-[12px] w-[12px] rounded-full bg-[var(--color-bg-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                  :class="server.enabled ? 'translate-x-[12px]' : ''"
                />
              </span>
            </button>
          </div>
        </section>

        <section class="flex-shrink-0 overflow-hidden rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shadow-[0_1px_3px_rgba(0,0,0,0.05)] [contain:layout_style]">
          <header class="flex min-h-[38px] items-center justify-between gap-[10px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[12px] py-[8px]">
            <div class="inline-flex min-w-0 items-center gap-[6px]">
              <Sparkles :size="14" :stroke-width="1.8" class="shrink-0 text-[var(--color-text-dim)]" />
              <h3 class="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold tracking-[0.01em] text-[var(--color-text-primary)]">
                Skills
              </h3>
            </div>
            <span v-if="s.availableSkills.length" class="shrink-0 text-[11px] font-medium text-[var(--color-text-dim)]">
              {{ activeSkillCount }}/{{ s.availableSkills.length }} enabled
            </span>
          </header>

          <div class="flex flex-col py-[4px]">
            <p v-if="s.availableSkills.length === 0" class="m-0 px-[12px] py-[16px] text-[12px] leading-[1.5] text-[var(--color-text-tertiary)]">
              No skills found. Configure them in Settings.
            </p>

            <template v-for="(group, index) in skillGroups" :key="group.source">
              <div class="select-none px-[12px] pb-[4px] pt-[6px] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-dim)]" :class="{ 'mt-[4px]': index > 0 }">
                {{ group.label }}
              </div>
              <button
                v-for="skill in group.skills"
                :key="skill.id"
                class="group flex w-full min-h-[36px] cursor-pointer items-center justify-between gap-[10px] border-none bg-transparent px-[12px] py-[8px] text-left text-[var(--color-text-secondary)] transition-[background,color] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
                :class="{ '!text-[var(--color-text-primary)]': skill.enabled }"
                @click="toggleSkill(skill.id, skill.enabled)"
              >
                <div class="flex min-w-0 flex-1 items-center gap-[8px]">
                  <span
                    class="h-[6px] w-[6px] shrink-0 rounded-full transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                    :class="skill.enabled ? 'bg-[var(--color-success-text)] shadow-[0_0_6px_var(--color-success-muted)]' : 'bg-[var(--color-text-dim)]'"
                  />
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tracking-[0.01em]">{{ skill.title || skill.name }}</span>
                </div>

                <span
                  class="relative h-[16px] w-[28px] shrink-0 rounded-full transition-[background] duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                  :class="skill.enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'"
                >
                  <span
                    class="absolute left-[2px] top-[2px] h-[12px] w-[12px] rounded-full bg-[var(--color-bg-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                    :class="skill.enabled ? 'translate-x-[12px]' : ''"
                  />
                </span>
              </button>
            </template>
          </div>
        </section>
      </template>
    </div>

    <div class="pointer-events-none absolute bottom-0 left-0 right-0 z-[5] h-[24px] bg-gradient-to-t from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_top,black_0%,transparent_100%)] [mask-image:linear-gradient(to_top,black_0%,transparent_100%)]" />
  </div>
</template>
