import type { Ref } from 'vue'
import { computed, nextTick, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getEnabledSkills } from '@/utils/skills'

export interface CommandEntry {
  id: string
  label: string
  description: string
  type: 'action' | 'skill'
}

const SLASH_PATTERN = /(?:^|\n)\/([\w\-]*)$/

export function useSlashCommand(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  text: Ref<string>,
  projectPath: Ref<string | null>,
) {
  const settings = useSettingsStore()
  const isOpen = ref(false)
  const slashStart = ref(-1)
  const slashQuery = ref('')
  const selectedIdx = ref(0)
  const loading = ref(false)

  const allCommands = ref<CommandEntry[]>([])

  async function loadCommands() {
    loading.value = true
    try {
      const skills = await getEnabledSkills(projectPath.value, settings.disabledSkillIds)

      const commands: CommandEntry[] = [
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
      ]

      for (const skill of skills) {
        commands.push({
          id: `skill-${skill.id}`,
          label: `/skill-${skill.name}`,
          description: skill.title,
          type: 'skill',
        })
      }

      allCommands.value = commands
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
    const trailingSpace = /^\\s/.test(after) ? '' : ' '

    text.value = `${before}${newText}${trailingSpace}${after}`
    close()

    nextTick(() => {
      const el = textareaRef.value
      if (!el)
        return
      const pos = before.length + newText.length + trailingSpace.length
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
    close,
  }
}
