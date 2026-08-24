import type { Ref } from 'vue'
import type { ChatTab } from '@/stores/chat/core/types'
import { computed, nextTick, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { CHIP_PADDING, packSkill } from '@/utils/mentionFormat'
import { getEnabledSkills } from '@/utils/skills'

export interface CommandEntry {
  id: string
  label: string
  description: string
  type: 'action' | 'skill'
  skillId?: string
  whenToUse?: string
}

export type CommandProvider = (tab: ChatTab, projectPath: string | null) => Promise<CommandEntry[]> | CommandEntry[]

export const baseActionProvider: CommandProvider = tab => {
  const commands: CommandEntry[] = []
  if (tab.mode !== 'design') {
    commands.push(
      {
        id: 'new',
        label: '/new',
        description: 'Open a new chat tab and close the current one',
        type: 'action',
      },
      {
        id: 'init',
        label: '/init',
        description: 'Generate or update AGENTS.md for this project',
        type: 'action',
      },
      {
        id: 'restore',
        label: '/restore',
        description: 'Browse checkpoints and restore to a previous state',
        type: 'action',
      },
    )
  }
  return commands
}

export const skillProvider: CommandProvider = async (tab, projectPath) => {
  const settings = useSettingsStore()
  const commands: CommandEntry[] = []
  try {
    const skills = await getEnabledSkills(projectPath, settings.disabledSkillIds)
    const currentMode = tab.mode

    for (const skill of skills) {
      const skillModes = skill.modes
      const skillMatchesMode = !skillModes || skillModes.length === 0 || (currentMode && skillModes.includes(currentMode))
      if (!skillMatchesMode)
        continue

      if (currentMode === 'design' && skill.name === 'skill-factory')
        continue

      // Single slash command per SKILL.md — multiple commands per file removed.
      // Nested skills (e.g. responsive-design/build) expose as /<name> to preserve /build and /audit UX.
      const isNested = skill.id.includes('/')
      const label = isNested ? `/${skill.name}` : `/skill-${skill.name}`
      commands.push({
        id: `skill-${skill.id}`,
        label,
        description: skill.description || skill.title,
        type: 'skill',
        skillId: skill.id,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      })
    }
  }
  catch {
    // ignore
  }
  return commands
}

export const planCommandProvider: CommandProvider = tab => {
  if (tab.mode === 'design')
    return []
  return tab.mode === 'plan'
    ? [{
        id: 'exit-plan',
        label: '/exit-plan',
        description: 'Exit plan mode and return to build mode',
        type: 'action',
      }]
    : [{
        id: 'plan',
        label: '/plan',
        description: 'Enter plan mode to design the implementation without making code changes',
        type: 'action',
      }]
}

const defaultProviders = [baseActionProvider, skillProvider, planCommandProvider]

const SLASH_PATTERN = /(?:^|\n)\/([\w\-]*)$/

export function useSlashCommand(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  text: Ref<string>,
  projectPath: Ref<string | null>,
  tab: Ref<ChatTab>,
  providers: CommandProvider[] = defaultProviders,
) {
  const isOpen = ref(false)
  const slashStart = ref(-1)
  const slashQuery = ref('')
  const selectedIdx = ref(0)
  const loading = ref(false)

  const allCommands = ref<CommandEntry[]>([])

  async function loadCommands() {
    loading.value = true
    try {
      const results = await Promise.all(providers.map(p => p(tab.value, projectPath.value)))
      allCommands.value = results.flat()
    }
    catch {
      // ignore
    }
    finally {
      loading.value = false
    }
  }

  const filteredCommands = computed<CommandEntry[]>(() => {
    const q = slashQuery.value.toLowerCase()
    if (!q)
      return allCommands.value.slice(0, 50)

    return allCommands.value
      .filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .slice(0, 50)
  })

  function detectSlash(el: HTMLTextAreaElement): void {
    const cursor = el.selectionStart ?? 0
    const before = text.value.slice(0, cursor)
    const match = SLASH_PATTERN.exec(before)

    if (match) {
      slashStart.value = cursor - match[1]!.length - 1 // -1 for the slash
      slashQuery.value = match[1] ?? ''
      selectedIdx.value = 0
      if (!isOpen.value) {
        isOpen.value = true
        loadCommands()
      }
    }
    else {
      close()
    }
  }

  function handleInput(e: Event): void {
    detectSlash(e.target as HTMLTextAreaElement)
  }

  function handleKeydown(e: KeyboardEvent, onSelect: (entry: CommandEntry) => void): boolean {
    if (!isOpen.value)
      return false
    const total = filteredCommands.value.length

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        selectedIdx.value = total > 0 ? (selectedIdx.value - 1 + total) % total : 0
        return true
      case 'ArrowDown':
        e.preventDefault()
        selectedIdx.value = total > 0 ? (selectedIdx.value + 1) % total : 0
        return true
      case 'Enter':
      case 'Tab': {
        e.preventDefault()
        const entry = filteredCommands.value[selectedIdx.value]
        if (entry)
          onSelect(entry)
        return true
      }
      case 'Escape':
        e.preventDefault()
        close()
        return true
    }
    return false
  }

  function setSelectedIdx(idx: number): void {
    selectedIdx.value = idx
  }

  function selectEntry(entry: CommandEntry, onSelect: (entry: CommandEntry) => void): void {
    onSelect(entry)
  }

  function replaceWithText(newText: string) {
    const before = text.value.slice(0, slashStart.value)
    const queryEnd = slashStart.value + 1 + slashQuery.value.length
    const after = text.value.slice(queryEnd)
    text.value = `${before}${CHIP_PADDING}${newText}${CHIP_PADDING}${after}`
    close()

    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      const pos = before.length + CHIP_PADDING.length + newText.length + CHIP_PADDING.length
      el.setSelectionRange(pos, pos)
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    })
  }

  function insertSkillChip(entry: CommandEntry) {
    const before = text.value.slice(0, slashStart.value)
    const queryEnd = slashStart.value + 1 + slashQuery.value.length
    const after = text.value.slice(queryEnd)
    const chipText = packSkill(entry.skillId!)
    text.value = `${before}${CHIP_PADDING}${chipText}${CHIP_PADDING}${after}`
    close()

    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      const pos = before.length + CHIP_PADDING.length + chipText.length + CHIP_PADDING.length
      el.setSelectionRange(pos, pos)
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    })
  }

  function close(): void {
    isOpen.value = false
    slashStart.value = -1
    slashQuery.value = ''
  }

  return {
    isOpen,
    slashQuery,
    filteredCommands,
    selectedIdx,
    loading,
    handleInput,
    handleKeydown,
    setSelectedIdx,
    selectEntry,
    replaceWithText,
    insertSkillChip,
    close,
  }
}
