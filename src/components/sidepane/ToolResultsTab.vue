<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { Terminal, Wrench } from 'lucide-vue-next'
import { computed, markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ToolCallBlock from '@/components/chat/messages/block/ToolCallBlock.vue'

const props = defineProps<{
  messages: Message[]
}>()

// Diff AST interfaces
interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  oldLine: string
  newLine: string
  text: string
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface ParsedFileDiff {
  from: string
  to: string
  hunks: DiffHunk[]
}

interface RenderedToolEvent {
  event: ToolEvent
  kind: 'diff' | 'terminal' | 'text' | 'json' | 'image' | 'empty' | 'background'
  body: string
  parsedDiff?: ParsedFileDiff[]
  imageEntries?: { raw: string; src: string }[]
  backgroundTaskId?: string
}

const SHELL_TOOLS = new Set(['run_command', 'git_command'])
const ESC = String.fromCharCode(27)
const CSI = String.fromCharCode(155)
const ANSI_REGEX = new RegExp(`[${ESC}${CSI}][[()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-ORZcf-nqry=><]`, 'g')

function stripAnsi(str: string): string {
  return str ? str.replace(ANSI_REGEX, '') : ''
}

function isRemoteImageSource(filePath: string): boolean {
  return /^(?:https?:|data:|blob:|file:)/i.test(filePath)
}

function pathToImageSrc(filePath: string): string {
  if (isRemoteImageSource(filePath))
    return filePath

  try {
    return convertFileSrc(filePath)
  }
  catch (error) {
    console.warn('[image] convertFileSrc failed, using raw path:', filePath, error)
    return filePath
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string')
    return value
  if (value == null)
    return ''
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function liveShellOutput(event: ToolEvent): string {
  const parts: string[] = []
  const stdout = event.liveOutput?.stdout
  const stderr = event.liveOutput?.stderr
  if (stdout)
    parts.push(stdout.trimEnd())
  if (stderr)
    parts.push(`[stderr]\n${stderr.trimEnd()}`)
  return stripAnsi(parts.filter(Boolean).join('\n\n'))
}

function resultOutput(event: ToolEvent): string {
  const result = objectValue(event.result)
  if (!result)
    return stripAnsi(stringify(event.result))

  const output = typeof result.output === 'string' ? result.output : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  const results = Array.isArray(result.results) ? result.results : []
  const resultLines = results
    .map(item => {
      const record = objectValue(item)
      if (!record)
        return stringify(item)
      const chunks = [`$ ${String(record.command ?? 'command')}`]
      if (typeof record.stdout === 'string' && record.stdout)
        chunks.push(record.stdout.trimEnd())
      if (typeof record.stderr === 'string' && record.stderr)
        chunks.push(`[stderr]\n${record.stderr.trimEnd()}`)
      return chunks.join('\n')
    })
    .filter(Boolean)

  return stripAnsi([
    output,
    stdout,
    stderr ? `[stderr]\n${stderr}` : '',
    ...resultLines,
  ].filter(Boolean).join('\n\n'))
}

function diffOutput(event: ToolEvent): string {
  const result = objectValue(event.result)
  if (!result)
    return ''
  if (typeof result.diff === 'string' && result.diff.trim())
    return result.diff

  const files = Array.isArray(result.files) ? result.files : []
  const nestedDiff = files
    .map(file => {
      const record = objectValue(file)
      if (!record)
        return ''
      return typeof record.diff === 'string' && record.diff.trim() ? record.diff : ''
    })
    .filter(Boolean)
    .join('\n\n')

  if (nestedDiff)
    return nestedDiff

  const hasStats = typeof result.added === 'number' || typeof result.removed === 'number'
  return hasStats
    ? 'No diff payload was captured for this historical tool result. Run the edit again to capture the unified diff.'
    : ''
}

function readOutput(event: ToolEvent): string {
  return stringify(event.result)
}

// Caching layer for parsed diffs to mitigate layout thrashing and Vue reactivity overhead on large files.
const diffCache = new Map<string, { bodyKey: string; parsed: ParsedFileDiff[] }>()

function getCachedParsedDiff(eventId: string, body: string): ParsedFileDiff[] {
  const entry = diffCache.get(eventId)
  if (entry && entry.bodyKey === body)
    return entry.parsed
  const parsed = markRaw(parseDiff(body))
  diffCache.set(eventId, { bodyKey: body, parsed })
  return parsed
}

// Parses unified diffs into a structured AST.
function parseDiff(raw: string): ParsedFileDiff[] {
  if (!raw)
    return []
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const files: ParsedFileDiff[] = []
  let currentFile: ParsedFileDiff | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line === undefined)
      continue
    if (line.startsWith('--- ')) {
      currentFile = { from: line.slice(4).replace(/^a\//, ''), to: '', hunks: [] }
      files.push(currentFile)
      currentHunk = null
      continue
    }
    if (line.startsWith('+++ ') && currentFile) {
      currentFile.to = line.slice(4).replace(/^b\//, '')
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        if (!currentFile) {
          currentFile = { from: '', to: '', hunks: [] }
          files.push(currentFile)
        }
        oldLine = Number.parseInt(match[1]!, 10)
        newLine = Number.parseInt(match[2]!, 10)
        currentHunk = { header: line, lines: [] }
        currentFile.hunks.push(currentHunk)
      }
      continue
    }
    if (!currentHunk || line.startsWith('\\ No newline'))
      continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldLine: '', newLine: String(newLine++), text: line.substring(1) })
    }
    else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldLine: String(oldLine++), newLine: '', text: line.substring(1) })
    }
    else if (line.startsWith(' ') || line === '') {
      const text = line.startsWith(' ') ? line.substring(1) : line
      currentHunk.lines.push({ type: 'ctx', oldLine: String(oldLine++), newLine: String(newLine++), text })
    }
  }
  return files.filter(f => f.hunks.length > 0)
}

function renderEvent(event: ToolEvent): RenderedToolEvent {
  if (SHELL_TOOLS.has(event.toolName)) {
    const result = objectValue(event.result)

    // Intercept unattached background processes that rely on long-polling.
    if (event.toolName === 'run_command' && result && typeof result.task_id === 'string') {
      const taskId = result.task_id as string
      const liveBody = liveShellOutput(event)
      if (!liveBody) {
        return {
          event,
          kind: 'background',
          body: taskId,
          backgroundTaskId: taskId,
        }
      }
    }

    const body = liveShellOutput(event) || resultOutput(event)
    return {
      event,
      kind: body ? 'terminal' : 'empty',
      body,
    }
  }

  if (event.toolName === 'write_file' || event.toolName === 'edit_files' || event.toolName === 'plan') {
    const body = diffOutput(event) || stringify(event.result)
    if (body && body.startsWith('--- ')) {
      const parsedDiff = getCachedParsedDiff(event.id, body)
      if (parsedDiff.length > 0)
        return { event, kind: 'diff', body, parsedDiff }
    }
    return {
      event,
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  if (event.toolName === 'create_image') {
    const result = objectValue(event.result)
    const paths = result && Array.isArray(result.paths) ? result.paths as string[] : []

    if (paths.length > 0) {
      return {
        event,
        kind: 'image',
        body: stringify(event.result),
        imageEntries: paths.map(p => ({ raw: p, src: pathToImageSrc(p) })),
      }
    }

    const body = stringify(event.result)
    return {
      event,
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  if (event.toolName === 'read_files') {
    const body = readOutput(event)
    return {
      event,
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  const body = stringify(event.result)
  return {
    event,
    kind: body ? (typeof event.result === 'string' ? 'text' : 'json') : 'empty',
    body,
  }
}

// Graceful fallback for local images failing unconfigured Tauri asset protocols.
const blobFallbacks = new Map<string, string>()

onBeforeUnmount(() => {
  for (const url of blobFallbacks.values())
    URL.revokeObjectURL(url)
  blobFallbacks.clear()
})

function guessImageMime(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg')
    return 'image/jpeg'
  if (ext === 'webp')
    return 'image/webp'
  if (ext === 'gif')
    return 'image/gif'
  if (ext === 'svg')
    return 'image/svg+xml'
  return 'image/png'
}

async function onImageError(event: Event, originalPath: string): Promise<void> {
  const img = event.target as HTMLImageElement | null
  if (!img || blobFallbacks.has(originalPath))
    return

  try {
    const bytes = await readFile(originalPath)
    const blob = new Blob([bytes], { type: guessImageMime(originalPath) })
    const blobUrl = URL.createObjectURL(blob)
    blobFallbacks.set(originalPath, blobUrl)
    img.src = blobUrl
  }
  catch (err) {
    console.warn('[image] readFile fallback failed:', originalPath, err)
  }
}

const renderedEvents = computed(() => props.messages
  .flatMap(message => message.role === 'assistant' ? message.toolEvents ?? [] : [])
  .map(renderEvent))

const scrollEl = ref<HTMLElement | null>(null)

// Pin scroll to bottom as tool events stream in.
watch(
  () => renderedEvents.value.length,
  () => {
    nextTick(() => {
      if (scrollEl.value)
        scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    })
  },
)
</script>

<template>
  <div class="relative flex-1 min-h-0 flex flex-col">
    <div class="absolute left-0 right-0 pointer-events-none z-5 top-0 h-4 bg-gradient-to-b from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto pt-4 pr-3 pb-3 pl-3 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
      <div v-if="renderedEvents.length === 0" class="flex flex-col items-center justify-center gap-2 min-h-[220px] py-8 px-[18px] text-center">
        <div class="flex items-center justify-center w-[38px] h-[38px] rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)]">
          <Wrench :size="18" :stroke-width="1.8" />
        </div>
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
          No tool calls yet
        </p>
        <p class="m-0 text-[var(--color-text-dim)]">
          Tool outputs will appear here while the agent works.
        </p>
      </div>

      <div v-else class="flex flex-col gap-3 pb-6">
        <article
          v-for="item in renderedEvents"
          :key="item.event.id"
          v-memo="[item.event.status, item.body, item.kind]"
          class="border rounded-lg bg-[var(--color-bg-base)] overflow-hidden [contain:layout_style] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
          :class="item.event.status === 'running' ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-border-subtle))]' : ['error', 'failed'].includes(item.event.status) ? 'border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-border-subtle))]' : 'border-[var(--color-border-subtle)]'"
        >
          <header class="flex items-center justify-between gap-2.5 min-h-[38px] py-2 px-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)]">
            <ToolCallBlock :event="item.event" />
            <span
              class="shrink-0 py-0.5 px-1.5 rounded-[4px] text-[10px] font-bold leading-[1.5] uppercase"
              :class="item.event.status === 'running' ? 'text-[var(--color-accent-text)] bg-[var(--color-accent-muted)]' : ['done', 'completed'].includes(item.event.status) ? 'text-[var(--color-success)] bg-[var(--color-success-muted)]' : ['error', 'failed'].includes(item.event.status) ? 'text-[var(--color-danger)] bg-[var(--color-danger-muted)]' : 'text-[var(--color-text-dim)] bg-[var(--color-bg-elevated)]'"
            >
              {{ item.event.status }}
            </span>
          </header>

          <div v-if="item.kind === 'background'" class="flex items-center gap-2.5 p-3 bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]">
            <div class="flex items-center justify-center w-[26px] h-[26px] rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent-text)] shrink-0">
              <Terminal :size="13" />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-[11px] font-semibold text-[var(--color-text-dim)] tracking-[0.02em]">Running in background</span>
              <code class="font-mono text-[11.5px] text-[var(--color-accent-text)] bg-none border-none p-0">{{ item.backgroundTaskId }}</code>
            </div>
          </div>

          <div v-if="item.kind === 'diff' && item.parsedDiff" class="max-h-[420px] overflow-auto font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace] text-[11.5px] leading-[1.55] [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
            <div v-for="(file, fi) in item.parsedDiff" :key="fi" class="first:border-t-0 border-t border-[color-mix(in_srgb,var(--color-border-subtle)_60%,transparent)]">
              <div v-if="file.to || file.from" class="flex items-center gap-1.5 py-1.5 px-3 bg-[color-mix(in_srgb,var(--color-bg-surface)_60%,transparent)] border-b border-[color-mix(in_srgb,var(--color-border-subtle)_50%,transparent)]">
                <span class="text-[11px] font-semibold text-[var(--color-text-secondary)] font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace]">{{ file.to || file.from }}</span>
              </div>
              <div v-for="(hunk, hi) in file.hunks" :key="hi">
                <div class="py-1 px-3 text-[10.5px] text-[var(--color-text-dim)] bg-[color-mix(in_srgb,var(--color-bg-surface)_40%,transparent)] border-b border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)] select-none">
                  {{ hunk.header }}
                </div>
                <div
                  v-for="(line, li) in hunk.lines"
                  :key="li"
                  class="flex items-stretch min-w-max"
                  :class="{
                    'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]': line.type === 'add',
                    'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]': line.type === 'del',
                  }"
                >
                  <div
                    class="flex w-[72px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)]"
                    :class="{
                      'bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]': line.type === 'add',
                      'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]': line.type === 'del',
                    }"
                  >
                    <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.oldLine }}</span>
                    <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.newLine }}</span>
                  </div>
                  <div
                    class="w-[18px] shrink-0 text-center font-semibold text-[12px] select-none flex items-center justify-center"
                    :class="{
                      'text-[var(--color-success)]': line.type === 'add',
                      'text-[var(--color-danger)]': line.type === 'del',
                    }"
                  >
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}
                  </div>
                  <div
                    class="px-3 whitespace-pre flex-1"
                    :class="{
                      'text-[color-mix(in_srgb,var(--color-success)_60%,var(--color-text-primary))]': line.type === 'add',
                      'text-[color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]': line.type === 'del',
                      'text-[var(--color-text-dim)] opacity-70': line.type === 'ctx',
                    }"
                  >
                    {{ line.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="item.kind === 'image' && item.imageEntries?.length" class="flex flex-wrap gap-2 p-3">
            <img
              v-for="(entry, idx) in item.imageEntries"
              :key="idx"
              :src="blobFallbacks.get(entry.raw) ?? entry.src"
              class="max-w-full max-h-[420px] rounded-[var(--radius-md)] object-contain cursor-zoom-in hover:outline hover:outline-1 hover:outline-[var(--color-border-mid)]"
              alt="Generated image"
              @error="onImageError($event, entry.raw)"
            >
          </div>

          <pre
            v-else-if="item.body"
            class="m-0 max-h-[420px] overflow-auto p-3 font-mono text-[11.5px] leading-[1.55] whitespace-pre bg-transparent [scrollbar-width:thin]"
            :class="item.kind === 'terminal' || item.kind === 'diff' ? 'text-[var(--color-text-primary)]' : item.kind === 'json' ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-secondary)]'"
          ><code>{{ item.body }}</code></pre>
          <div v-else class="p-3 text-[11.5px] text-[var(--color-text-dim)] italic">
            {{ ['completed', 'failed', 'killed'].includes(item.event.status) ? 'No output' : 'Waiting for output...' }}
          </div>
        </article>
      </div>
    </div>

    <div class="absolute left-0 right-0 pointer-events-none z-5 bottom-0 h-6 bg-gradient-to-t from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_top,black_0%,transparent_100%)] [mask-image:linear-gradient(to_top,black_0%,transparent_100%)]" />
  </div>
</template>
