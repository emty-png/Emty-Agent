<script setup lang="ts">
import { homeDir, join } from '@tauri-apps/api/path'
import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import {
  Check,
  FileText,
  MessageSquare,
  RefreshCw,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  tabId: string
}>()

const chat = useChatStore()
const plans = ref<{ name: string; path: string; mtime: number }[]>([])
const selectedPlanPath = ref<string | null>(null)
const planContent = ref<string>('')
const loading = ref(false)

const activeCommentLine = ref<number | null>(null)
const commentText = ref('')

interface PendingComment {
  lineIndex: number
  text: string
}

const conversationId = computed(() => {
  return chat.tabs.find(tab => tab.id === props.tabId)?.conversationId ?? null
})

const workspacePath = computed(() => {
  return chat.tabs.find(tab => tab.id === props.tabId)?.workspacePath ?? null
})

function safePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .split('')
    .map(char => char.charCodeAt(0) < 32 ? '-' : char)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(/-+/g, '-')
  return sanitized || fallback
}

function projectNameFromPath(path: string | null): string | null {
  if (!path)
    return null
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
}

const projectSegment = computed(() => {
  const fromPath = projectNameFromPath(workspacePath.value)
  if (fromPath)
    return safePathSegment(fromPath, 'global')
  if (conversationId.value)
    return safePathSegment(conversationId.value, 'global')
  return 'global'
})

function handleGlobalPlanCreated(e: Event) {
  const detail = (e as CustomEvent<{ filepath: string; tabId?: string; conversationId?: string; projectName?: string | null; workspacePath?: string | null }>).detail
  if (!detail?.filepath)
    return

  if (detail.tabId === props.tabId) {
    void loadPlans()
    return
  }
  // plans are now per-project, so any tab in same project should refresh
  const incomingProject = detail.projectName ?? (detail.workspacePath ? projectNameFromPath(detail.workspacePath) : null)
  const incomingSegment = incomingProject ? safePathSegment(incomingProject, 'global') : detail.conversationId ? safePathSegment(detail.conversationId, 'global') : null
  if (incomingSegment && incomingSegment === projectSegment.value)
    void loadPlans()
  else if (detail.conversationId && detail.conversationId === conversationId.value)
    void loadPlans()
}

const hasPlans = computed(() => plans.value.length > 0)
defineExpose({ hasPlans })

const selectedPlanName = computed(() => {
  return plans.value.find(p => p.path === selectedPlanPath.value)?.name || ''
})

function parseInlineMarkdown(text: string): string {
  // Escape HTML entities first
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Inline code — extract first to protect contents from further formatting
  const codeSpans: string[] = []
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    const i = codeSpans.length
    codeSpans.push(`<code class="[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] text-[0.875em] bg-[var(--color-bg-elevated)] text-[var(--color-code)] px-[5px] py-[1px] rounded-[var(--radius-sm)] border border-[var(--color-border-mid)]">${code}</code>`)
    return `\x00C${i}\x00`
  })

  // Bold + italic (*** or ___)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-bold text-[var(--color-text-primary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')
  s = s.replace(/___(.+?)___/g, '<strong class="font-bold text-[var(--color-text-primary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')

  // Bold (** or __)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-[var(--color-text-primary)]">$1</strong>')
  s = s.replace(/__(.+?)__/g, '<strong class="font-bold text-[var(--color-text-primary)]">$1</strong>')

  // Italic (* or _)
  s = s.replace(/\*(.+?)\*/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
  s = s.replace(/\b_(.+?)_\b/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')

  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '<del class="line-through text-[var(--color-text-tertiary)]">$1</del>')

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-[var(--color-info-text)] underline underline-offset-2 transition-colors duration-[120ms] hover:text-[var(--color-text-primary)]" target="_blank">$1</a>')

  // Restore inline code
  s = s.replace(/\0C(\d+)\0/g, (_, i) => codeSpans[Number(i)] ?? '')

  return s
}

function detectLineType(line: string, inCodeBlock: boolean): { type: string; text: string; checked?: boolean; olNumber?: number } {
  const trimmed = line.trim()

  if (inCodeBlock)
    return { type: 'code', text: line }

  // Fenced code block boundaries
  if (trimmed.startsWith('```'))
    return { type: inCodeBlock ? 'code-end' : 'code-start', text: line }

  // Horizontal rule
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed))
    return { type: 'hr', text: '' }

  // Headings
  const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/)
  if (headingMatch)
    return { type: `h${headingMatch[1]!.length}`, text: headingMatch[2]! }

  // Blockquote
  if (trimmed.startsWith('> '))
    return { type: 'quote', text: trimmed.slice(2) }

  // Task list item
  const taskMatch = trimmed.match(/^[-*]\s+\[([ x])\]\s+(.*)/i)
  if (taskMatch)
    return { type: 'task', text: taskMatch[2]!, checked: taskMatch[1] !== ' ' }

  // Unordered list
  if (/^[-*]\s+/.test(trimmed))
    return { type: 'ul', text: trimmed.replace(/^[-*]\s+/, '') }

  // Ordered list
  const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/)
  if (olMatch)
    return { type: 'ol', text: olMatch[2]!, olNumber: Number(olMatch[1]) }

  // Empty
  if (trimmed === '')
    return { type: 'empty', text: '' }

  // Pipe table row
  if (trimmed.includes('|')) {
    const isSep = /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(trimmed)
    return { type: isSep ? 'table-sep' : 'table-row', text: trimmed }
  }

  return { type: 'p', text: line }
}

interface PlanLine {
  raw: string
  text: string
  type: string
  index: number
  indent: number
  html: string
  codeLang?: string
  checked?: boolean | undefined
  olNumber?: number | undefined
  isCodeContent: boolean
  cells?: string[] | undefined
  tableRows?: PlanLine[] | undefined
}

const planLines = computed<PlanLine[]>(() => {
  if (!planContent.value)
    return []
  const rawLines = planContent.value.split('\n')
  let inCodeBlock = false
  let codeLang = ''
  let olCounter = 0

  const lines = rawLines.map((line, index): PlanLine => {
    const trimmed = line.trim()

    // Track code block state
    if (!inCodeBlock && trimmed.startsWith('```')) {
      inCodeBlock = true
      codeLang = trimmed.slice(3).trim()
      olCounter = 0
      return { raw: line, text: trimmed, type: 'code-start', index, indent: 0, html: trimmed, codeLang, isCodeContent: false }
    }
    if (inCodeBlock && trimmed.startsWith('```')) {
      inCodeBlock = false
      const result = { raw: line, text: trimmed, type: 'code-end', index, indent: 0, html: trimmed, isCodeContent: false } as PlanLine
      codeLang = ''
      return result
    }
    if (inCodeBlock) {
      return { raw: line, text: line, type: 'code', index, indent: 0, html: line, isCodeContent: true }
    }

    const { type, text } = detectLineType(line, false)

    // Reset OL counter on non-OL lines
    if (type !== 'ol')
      olCounter = 0

    const indentMatch = line.match(/^(\s+)/)
    const indent = indentMatch ? Math.floor(indentMatch[1]!.length / 2) : 0

    const olNumber = type === 'ol' ? ++olCounter : undefined

    // For task type, detectLineType returns text already stripped of [x]
    const displayText = type === 'task'
      ? trimmed.replace(/^[-*]\s+\[[ x]\]\s+/i, '')
      : text

    let cells: string[] | undefined
    if (type === 'table-row') {
      cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => parseInlineMarkdown(c.trim()))
    }

    return {
      raw: line,
      text: displayText,
      type,
      index,
      indent,
      html: parseInlineMarkdown(displayText),
      checked: type === 'task' ? trimmed.includes('[x]') || trimmed.includes('[X]') : undefined,
      olNumber,
      isCodeContent: false,
      cells,
    }
  })

  // Second pass: group tables
  const grouped: PlanLine[] = []
  let currentTable: PlanLine[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.type === 'table-row' || line.type === 'table-sep') {
      if (!currentTable) {
        currentTable = []
      }
      currentTable.push(line)
    }
    else {
      if (currentTable) {
        grouped.push({
          raw: '',
          text: '',
          type: 'table',
          index: currentTable[0]!.index,
          indent: currentTable[0]!.indent,
          html: '',
          isCodeContent: false,
          tableRows: currentTable,
        })
        currentTable = null
      }
      grouped.push(line)
    }
  }
  if (currentTable) {
    grouped.push({
      raw: '',
      text: '',
      type: 'table',
      index: currentTable[0]!.index,
      indent: currentTable[0]!.indent,
      html: '',
      isCodeContent: false,
      tableRows: currentTable,
    })
  }

  return grouped
})

async function loadPlans() {
  loading.value = true
  try {
    if (!conversationId.value && !workspacePath.value) {
      plans.value = []
      selectedPlanPath.value = null
      planContent.value = ''
      return
    }

    const home = await homeDir()
    const segment = projectSegment.value
    const plansDir = await join(home, '.emty', 'plans', segment)

    try {
      const entries = await readDir(plansDir)
      const mdFiles = entries.filter(e => e.name?.endsWith('.md'))

      const loadedPlans = []
      for (const e of mdFiles) {
        const fullPath = await join(plansDir, e.name)
        let mtimeNum = 0
        try {
          const fileStats = await stat(fullPath)
          if (fileStats && fileStats.mtime) {
            mtimeNum = fileStats.mtime instanceof Date ? fileStats.mtime.getTime() : new Date(fileStats.mtime).getTime()
          }
        }
        catch {}
        loadedPlans.push({ name: e.name!, path: fullPath, mtime: mtimeNum })
      }

      loadedPlans.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
      plans.value = loadedPlans

      if (plans.value.length > 0) {
        // ALWAYS select the latest plan
        await selectPlan(plans.value[0]!.path)
      }
      else {
        selectedPlanPath.value = null
        planContent.value = ''
      }
    }
    catch {
      plans.value = []
      selectedPlanPath.value = null
      planContent.value = ''
    }
  }
  finally {
    loading.value = false
  }
}

async function selectPlan(path: string) {
  selectedPlanPath.value = path
  activeCommentLine.value = null
  try {
    planContent.value = await readTextFile(path)
  }
  catch {
    planContent.value = ''
  }
}

const pendingComments = ref<PendingComment[]>([])

const pendingCommentsMap = computed(() => {
  const map = new Map<number, PendingComment[]>()
  for (const pc of pendingComments.value) {
    if (!map.has(pc.lineIndex))
      map.set(pc.lineIndex, [])
    map.get(pc.lineIndex)!.push(pc)
  }
  return map
})

async function toggleComment(index: number) {
  if (activeCommentLine.value === index) {
    activeCommentLine.value = null
  }
  else {
    activeCommentLine.value = index
    commentText.value = ''
    await nextTick()
    const textareas = document.querySelectorAll('.commit-textarea')
    if (textareas.length > 0) {
      ;(textareas[0] as HTMLTextAreaElement).focus()
    }
  }
}

function stageComment(lineIndex: number) {
  if (!commentText.value.trim())
    return

  pendingComments.value.push({ lineIndex, text: commentText.value.trim() })
  commentText.value = ''
  activeCommentLine.value = null
}

function removePendingComment(index: number) {
  pendingComments.value.splice(index, 1)
}

function sendAllComments() {
  if (pendingComments.value.length === 0)
    return

  const planName = selectedPlanName.value || 'Plan'

  const parts = pendingComments.value.map(c => {
    const lineContent = planLines.value[c.lineIndex]?.raw || ''
    return `Line ${c.lineIndex + 1}: > ${lineContent.trim()}\n${c.text}`
  })

  const message = `Comments on ${planName}:\n\n${parts.join('\n\n---\n\n')}`
  chat.sendMessage(message)
  pendingComments.value = []
}

function approvePlan() {
  const tab = chat.tabs.find(item => item.id === props.tabId)
  if (tab)
    tab.mode = 'build'

  const planName = selectedPlanName.value || 'the selected plan'
  const planPath = selectedPlanPath.value ? `\n\nPlan file: ${selectedPlanPath.value}` : ''
  chat.sendMessage(`I approve ${planName}. Please proceed with the implementation.${planPath}`)
}

onMounted(() => {
  loadPlans()
  window.addEventListener('emty:plan-created', handleGlobalPlanCreated)
})

onUnmounted(() => {
  window.removeEventListener('emty:plan-created', handleGlobalPlanCreated)
})

watch([conversationId, workspacePath, projectSegment], () => {
  void loadPlans()
})
</script>

<template>
  <div class="flex flex-col h-full bg-[var(--color-bg-base)] text-[var(--color-text-primary)] relative overflow-hidden font-[ui-sans-serif,system-ui,sans-serif]">
    <!-- Loading -->
    <div v-if="loading && !planContent" class="flex flex-col items-center justify-center gap-3 py-16 px-6 flex-1 text-center">
      <div class="relative">
        <RefreshCw :size="20" class="animate-[spin_0.9s_linear_infinite] text-[var(--color-accent)]" />
      </div>
      <p class="m-0 text-[12px] font-medium text-[var(--color-text-dim)] tracking-wide uppercase">
        Loading plan
      </p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!planContent" class="flex flex-col items-center justify-center gap-3 py-16 px-6 flex-1 text-center">
      <div class="w-[44px] h-[44px] rounded-[var(--radius-xl)] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]">
        <FileText :size="20" :stroke-width="1.5" />
      </div>
      <div>
        <p class="m-0 text-[13px] font-semibold text-[var(--color-text-secondary)]">
          No plan available
        </p>
        <p class="m-0 text-[11.5px] text-[var(--color-text-dim)] max-w-[220px] leading-[1.6] mt-1">
          Use <code class="px-1 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] text-[11px] font-mono">/plan</code> to prompt the agent to create one.
        </p>
      </div>
    </div>

    <!-- Plan content -->
    <div v-else class="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <div class="absolute left-0 right-0 top-0 h-4 bg-gradient-to-b from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] pointer-events-none z-10 [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />
      <div class="flex-1 min-h-0 overflow-y-auto pb-[56px] pt-4 [scrollbar-width:thin] [scrollbar-color:var(--color-border-subtle)_transparent]">
        <div class="py-3 pt-0">
          <template v-for="line in planLines" :key="line.index">
            <div>
              <!-- Empty lines: collapse -->
              <div v-if="line.type === 'empty'" class="h-[6px]" />

              <!-- Horizontal rule -->
              <div v-else-if="line.type === 'hr'" class="flex items-stretch group relative">
                <div class="flex w-[28px] shrink-0" />
                <div class="flex-1 py-[18px] pr-4">
                  <div class="h-px bg-[var(--color-border-mid)]" />
                </div>
              </div>

              <!-- Table block -->
              <div v-else-if="line.type === 'table'" class="flex items-stretch group relative my-[14px]">
                <div class="flex w-[28px] shrink-0 items-start justify-center pt-[3px] relative z-10">
                  <button
                    class="w-[18px] h-[18px] rounded flex items-center justify-center cursor-pointer opacity-0 scale-[0.8] transition-all duration-120 ease-in-out bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-text-primary)] hover:text-[var(--color-bg-base)] hover:border-[var(--color-text-primary)] group-hover:opacity-100 group-hover:scale-100"
                    :class="activeCommentLine === line.index ? '!opacity-100 !scale-100 !bg-[var(--color-text-primary)] !text-[var(--color-bg-base)] !border-[var(--color-text-primary)]' : ''"
                    title="Comment"
                    @click="toggleComment(line.index)"
                  >
                    <MessageSquare :size="10" :stroke-width="2" />
                  </button>
                </div>
                <div class="flex-1 overflow-x-auto border border-[var(--color-border-mid)] rounded-[var(--radius-md)] bg-[var(--color-bg-base)]" :style="{ marginLeft: `${0.75 + line.indent * 0.75}rem`, marginRight: '1rem' }">
                  <table class="w-full border-collapse text-[13px]">
                    <thead v-if="line.tableRows && line.tableRows.length > 0">
                      <tr>
                        <th v-for="(cell, i) in line.tableRows![0]!.cells" :key="i" class="px-[12px] py-[7px] text-left font-semibold text-[11.5px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] whitespace-nowrap" v-html="cell" />
                      </tr>
                    </thead>
                    <tbody>
                      <template v-for="(row, rowIdx) in line.tableRows" :key="row.index">
                        <tr v-if="rowIdx > 0 && row.type !== 'table-sep'" class="group/tr hover:bg-[color-mix(in_srgb,var(--color-bg-hover)_60%,transparent)] border-b border-[var(--color-border-subtle)] last:border-b-0">
                          <td v-for="(cell, i) in row.cells" :key="i" class="px-[12px] py-[7px] text-[13px] text-[var(--color-text-primary)] align-top whitespace-normal break-words [overflow-wrap:anywhere]" v-html="cell" />
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Regular lines -->
              <div
                v-else
                class="flex items-stretch group relative"
                :class="[
                  activeCommentLine === line.index ? 'bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]' : 'hover:bg-[var(--color-state-hover)]',
                  (line.type === 'h1' || line.type === 'h2') ? 'mt-6 first:mt-2' : '',
                  (line.type === 'h3' || line.type === 'h4' || line.type === 'h5' || line.type === 'h6') ? 'mt-4 first:mt-2' : '',
                  line.type === 'task' ? 'ml-0' : '',
                ]"
              >
                <!-- Gutter: comment trigger -->
                <div class="flex w-[28px] shrink-0 items-start justify-center pt-[3px] relative z-10">
                  <button
                    class="w-[18px] h-[18px] rounded flex items-center justify-center cursor-pointer opacity-0 scale-[0.8] transition-all duration-120 ease-in-out bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-text-primary)] hover:text-[var(--color-bg-base)] hover:border-[var(--color-text-primary)] group-hover:opacity-100 group-hover:scale-100"
                    :class="activeCommentLine === line.index ? '!opacity-100 !scale-100 !bg-[var(--color-text-primary)] !text-[var(--color-bg-base)] !border-[var(--color-text-primary)]' : ''"
                    title="Comment"
                    @click="toggleComment(line.index)"
                  >
                    <MessageSquare :size="10" :stroke-width="2" />
                  </button>
                </div>

                <!-- Content -->
                <div
                  class="py-[1px] pr-4 flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-[1.65]"
                  :style="{ paddingLeft: `${0.75 + line.indent * 0.75}rem` }"
                  :class="{
                    'font-bold text-[1.35em] text-[var(--color-text-primary)] leading-[1.3] mt-[10px]': line.type === 'h1',
                    'font-bold text-[1.2em] text-[var(--color-text-primary)] leading-[1.3] mt-[8px]': line.type === 'h2',
                    'font-bold text-[1.05em] text-[var(--color-text-primary)] leading-[1.3] mt-[6px]': line.type === 'h3',
                    'font-bold text-[1em] text-[var(--color-text-secondary)] mt-[4px]': line.type === 'h4' || line.type === 'h5' || line.type === 'h6',
                    'text-[var(--color-text-primary)]': line.type === 'p' || line.type === 'ul' || line.type === 'ol' || line.type === 'task',
                    'bg-[var(--color-bg-surface)] rounded-t-[var(--radius-md)] border border-[var(--color-border-mid)] border-b border-b-[var(--color-border-mid)] py-[6px] px-[8px] pl-[12px] mt-[14px] min-h-[34px] flex flex-col justify-center': line.type === 'code-start',
                    '[font-family:\'JetBrains_Mono\',\'Fira_Code\',\'Cascadia_Code\',ui-monospace,monospace] text-[12.5px] text-[var(--color-text-primary)] bg-[var(--color-bg-base)] border-x border-[var(--color-border-mid)] px-[16px] leading-[1.6]': line.type === 'code',
                    '[font-family:\'JetBrains_Mono\',\'Fira_Code\',\'Cascadia_Code\',ui-monospace,monospace] text-[12.5px] text-[var(--color-text-primary)] bg-[var(--color-bg-base)] rounded-b-[var(--radius-md)] border border-[var(--color-border-mid)] border-t-0 pt-[4px] pb-[14px] px-[16px] mb-[14px] leading-[1.6]': line.type === 'code-end',
                    'text-[var(--color-text-secondary)] italic border-l-[3px] border-[var(--color-accent-dim)] bg-[color-mix(in_srgb,var(--color-accent-muted)_40%,transparent)] rounded-r-[var(--radius-md)] pl-[16px] py-[4px] ml-0': line.type === 'quote',
                  }"
                >
                  <!-- Code block: language label + content -->
                  <template v-if="line.type === 'code-start'">
                    <div class="flex items-center justify-between">
                      <span v-if="line.codeLang" class="[font-family:'JetBrains_Mono','Fira_Code',ui-monospace,monospace] text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{{ line.codeLang }}</span>
                      <span v-else />
                    </div>
                  </template>
                  <template v-else-if="line.type === 'code'">
                    <span class="whitespace-pre-wrap">{{ line.raw }}</span>
                  </template>
                  <template v-else-if="line.type === 'code-end'">
                    <span class="whitespace-pre-wrap" />
                  </template>
                  <!-- Task checkbox -->
                  <template v-else-if="line.type === 'task'">
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px] shrink-0 border transition-colors duration-100"
                        :class="line.checked
                          ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                          : 'bg-transparent border-[var(--color-border-bright)] text-transparent'"
                      >
                        <svg v-if="line.checked" width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      </span>
                      <span :class="line.checked ? 'text-[var(--color-text-dim)] line-through' : 'text-[var(--color-text-secondary)]'" v-html="line.html" />
                    </span>
                  </template>
                  <!-- UL bullet -->
                  <template v-else-if="line.type === 'ul'">
                    <span class="inline-flex items-start gap-1.5">
                      <span class="text-[var(--color-accent)] font-bold shrink-0 leading-[1.65] text-[10px] mt-[1px]">•</span>
                      <span v-html="line.html" />
                    </span>
                  </template>
                  <!-- OL number -->
                  <template v-else-if="line.type === 'ol'">
                    <span class="inline-flex items-start gap-2">
                      <span class="font-mono text-[11px] text-[var(--color-accent)] font-semibold shrink-0 leading-[1.65] mt-[1px] min-w-[14px] text-right">{{ line.olNumber }}.</span>
                      <span v-html="line.html" />
                    </span>
                  </template>
                  <!-- Headings, paragraphs, quotes -->
                  <template v-else>
                    <span v-html="line.html" />
                  </template>
                </div>
              </div>

              <!-- Staged comments -->
              <div
                v-for="(pc, pcIdx) in pendingCommentsMap.get(line.index) || []"
                :key="`staged-${pcIdx}`"
                class="flex items-start gap-2 py-2 pr-4 pl-[36px] bg-[color-mix(in_srgb,var(--color-accent)_4%,transparent)] border-y border-[color-mix(in_srgb,var(--color-border-subtle)_40%,transparent)]"
              >
                <div class="w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 mt-[1px] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]">
                  <MessageSquare :size="10" :stroke-width="2" />
                </div>
                <span class="flex-1 text-[12px] text-[var(--color-text-secondary)] leading-[1.55] break-words">{{ pc.text }}</span>
                <button
                  class="shrink-0 mt-[1px] w-4 h-4 rounded flex items-center justify-center text-[var(--color-text-dim)] hover:text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] transition-all duration-100 bg-transparent border-none cursor-pointer p-0 leading-none"
                  title="Remove comment"
                  @click="removePendingComment(pendingComments.findIndex(c => c === pc))"
                >
                  <span class="text-[10px] font-medium">✕</span>
                </button>
              </div>

              <!-- Active comment input -->
              <div v-if="activeCommentLine === line.index" class="py-3 pr-4 pl-[36px] bg-[color-mix(in_srgb,var(--color-bg-surface)_80%,transparent)]">
                <div class="bg-[var(--color-bg-base)] border border-[var(--color-border-bright)] rounded-[8px] flex flex-col overflow-hidden transition-all duration-150 focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]">
                  <textarea
                    v-model="commentText"
                    class="commit-textarea w-full bg-transparent border-none text-[var(--color-text-primary)] font-[inherit] text-[12.5px] resize-y min-h-[64px] leading-[1.55] outline-none py-2.5 px-3 placeholder:text-[var(--color-text-dim)]"
                    placeholder="Leave a comment on this line..."
                    @keydown.enter.exact.prevent="stageComment(line.index)"
                  />
                  <div class="flex justify-end gap-1.5 py-2 px-2.5 bg-[var(--color-bg-surface)] border-t border-[var(--color-border-subtle)]">
                    <button
                      class="inline-flex items-center justify-center h-[26px] px-2.5 rounded text-[11px] font-medium cursor-pointer border border-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] transition-colors duration-100"
                      @click="activeCommentLine = null"
                    >
                      Cancel
                    </button>
                    <button
                      class="inline-flex items-center justify-center h-[26px] px-3 rounded text-[11px] font-medium cursor-pointer border border-transparent bg-[var(--color-text-primary)] text-[var(--color-bg-base)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-100"
                      :disabled="!commentText.trim()"
                      @click="stageComment(line.index)"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div class="absolute left-0 right-0 bottom-[44px] h-6 bg-gradient-to-t from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] pointer-events-none z-10 [-webkit-mask-image:linear-gradient(to_top,black_0%,transparent_100%)] [mask-image:linear-gradient(to_top,black_0%,transparent_100%)]" />
    </div>

    <!-- Footer -->
    <div v-if="planContent" class="absolute bottom-0 inset-x-0 flex items-center justify-end py-2 px-3 bg-[color-mix(in_srgb,var(--color-bg-base)_92%,transparent)] backdrop-blur-xl border-t border-[var(--color-border-subtle)] z-[5]">
      <div class="flex items-center gap-1.5">
        <button
          v-if="pendingComments.length > 0"
          class="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[6px] text-[11.5px] font-medium cursor-pointer border border-[var(--color-border-bright)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-state-hover)] transition-all duration-100 active:scale-[0.97]"
          @click="sendAllComments"
        >
          <MessageSquare :size="11" :stroke-width="2" />
          <span>{{ pendingComments.length }} {{ pendingComments.length === 1 ? 'Comment' : 'Comments' }}</span>
        </button>
        <button
          class="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] text-[11.5px] font-semibold cursor-pointer border border-transparent bg-[var(--color-text-primary)] text-[var(--color-bg-base)] hover:opacity-90 transition-all duration-100 active:scale-[0.97] shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
          @click="approvePlan"
        >
          <Check :size="12" :stroke-width="2.5" />
          <span>Approve</span>
        </button>
      </div>
    </div>
  </div>
</template>
