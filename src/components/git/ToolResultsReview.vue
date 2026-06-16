<script setup lang="ts">
import type { Message, ToolEvent } from '@/stores/chat'
import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { Terminal, Wrench } from 'lucide-vue-next'
import { computed, markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ToolCallBadge from '@/components/chat/messages/ToolCallBadge.vue'

const props = defineProps<{
  messages: Message[]
}>()

// ── Diff types (mirrored from GitPane) ───────────────────────
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
  title: string
  kind: 'diff' | 'terminal' | 'text' | 'json' | 'image' | 'empty'
  body: string
  parsedDiff?: ParsedFileDiff[]
  imageEntries?: { raw: string; src: string }[]
}

const SHELL_TOOLS = new Set(['run_command', 'git_command'])

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
  return parts.filter(Boolean).join('\n\n')
}

function resultOutput(event: ToolEvent): string {
  const result = objectValue(event.result)
  if (!result)
    return stringify(event.result)

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

  return [
    output,
    stdout,
    stderr ? `[stderr]\n${stderr}` : '',
    ...resultLines,
  ].filter(Boolean).join('\n\n')
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

// ── Diff parse cache ─────────────────────────────────────────
// parseDiff is expensive on large files. This cache ensures it only runs
// once per event result — not on every live-output reactive tick.
const diffCache = new Map<string, { bodyKey: string; parsed: ParsedFileDiff[] }>()

function getCachedParsedDiff(eventId: string, body: string): ParsedFileDiff[] {
  const entry = diffCache.get(eventId)
  if (entry && entry.bodyKey === body)
    return entry.parsed
  // markRaw prevents Vue from adding deep reactivity to thousands of DiffLine
  // objects that are never mutated after creation.
  const parsed = markRaw(parseDiff(body))
  diffCache.set(eventId, { bodyKey: body, parsed })
  return parsed
}

// ── Diff parser (ported from GitPane) ────────────────────────
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
    const body = liveShellOutput(event) || resultOutput(event)
    return {
      event,
      title: 'Terminal output',
      kind: body ? 'terminal' : 'empty',
      body,
    }
  }

  if (event.toolName === 'write_file' || event.toolName === 'edit_files') {
    const body = diffOutput(event) || stringify(event.result)
    if (body && body.startsWith('--- ')) {
      const parsedDiff = getCachedParsedDiff(event.id, body)
      if (parsedDiff.length > 0)
        return { event, title: 'File changes', kind: 'diff', body, parsedDiff }
    }
    return {
      event,
      title: 'File changes',
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  if (event.toolName === 'create_image') {
    const result = objectValue(event.result)
    const paths = result && Array.isArray(result.paths) ? result.paths as string[] : []
    console.warn('[image] renderEvent create_image paths:', paths)
    if (paths.length > 0) {
      return {
        event,
        title: `${paths.length} image${paths.length > 1 ? 's' : ''} generated`,
        kind: 'image',
        body: stringify(event.result),
        imageEntries: paths.map(p => ({ raw: p, src: pathToImageSrc(p) })),
      }
    }
    const body = stringify(event.result)
    return {
      event,
      title: 'Image generation',
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  if (event.toolName === 'read_files') {
    const body = readOutput(event)
    return {
      event,
      title: 'Read output',
      kind: body ? 'text' : 'empty',
      body,
    }
  }

  const body = stringify(event.result)
  return {
    event,
    title: 'Tool result',
    kind: body ? (typeof event.result === 'string' ? 'text' : 'json') : 'empty',
    body,
  }
}

// ── Image blob-URL fallback ────────────────────────────────
// When convertFileSrc fails (e.g. no assetProtocol config), we read the
// file via Tauri's FS plugin and serve it as a blob: URL.
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

// ── Auto-scroll ───────────────────────────────────────────────
const scrollEl = ref<HTMLElement | null>(null)

// Scroll to bottom whenever a new tool call is appended.
// Fires only on count changes, not on every live-output tick.
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
  <div class="tools-container">
    <div class="scroll-blur-top" />

    <div ref="scrollEl" class="tools-review">
      <div v-if="renderedEvents.length === 0" class="tools-empty">
        <div class="tools-empty-icon-wrap">
          <Wrench :size="18" :stroke-width="1.8" />
        </div>
        <p class="tools-empty-title">
          No tool calls yet
        </p>
        <p class="tools-empty-hint">
          Tool outputs will appear here while the agent works.
        </p>
      </div>

      <div v-else class="tools-list">
        <article
          v-for="item in renderedEvents"
          :key="item.event.id"
          v-memo="[item.event.status, item.body, item.kind]"
          class="tool-card"
          :class="`tool-card--${item.event.status}`"
        >
          <header class="tool-card-header">
            <ToolCallBadge :event="item.event" />
            <span class="tool-card-status" :class="`tool-card-status--${item.event.status}`">
              {{ item.event.status }}
            </span>
          </header>

          <div class="tool-card-meta">
            <Terminal v-if="item.kind === 'terminal'" :size="12" />
            <span>{{ item.title }}</span>
          </div>

          <!-- Colored diff viewer (write_file / edit_files) -->
          <div v-if="item.kind === 'diff' && item.parsedDiff" class="tool-diff">
            <div v-for="(file, fi) in item.parsedDiff" :key="fi" class="diff-file">
              <div v-if="file.to || file.from" class="diff-file-header">
                <span class="diff-file-name">{{ file.to || file.from }}</span>
              </div>
              <div v-for="(hunk, hi) in file.hunks" :key="hi" class="diff-hunk">
                <div class="hunk-header">
                  {{ hunk.header }}
                </div>
                <div
                  v-for="(line, li) in hunk.lines"
                  :key="li"
                  class="diff-line"
                  :class="`diff-${line.type}`"
                >
                  <div class="line-gutter">
                    <span class="line-num">{{ line.oldLine }}</span>
                    <span class="line-num">{{ line.newLine }}</span>
                  </div>
                  <div class="line-sign">
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}
                  </div>
                  <div class="line-text">
                    {{ line.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Generated images -->
          <div v-else-if="item.kind === 'image' && item.imageEntries?.length" class="tool-images">
            <img
              v-for="(entry, idx) in item.imageEntries"
              :key="idx"
              :src="blobFallbacks.get(entry.raw) ?? entry.src"
              class="tool-image"
              alt="Generated image"
              @error="onImageError($event, entry.raw)"
            >
          </div>

          <!-- Terminal / text / JSON output -->
          <pre
            v-else-if="item.body"
            class="tool-output"
            :class="`tool-output--${item.kind}`"
          ><code>{{ item.body }}</code></pre>
          <div v-else class="tool-output-empty">
            Waiting for output...
          </div>
        </article>
      </div>
    </div>

    <div class="scroll-blur-bottom" />
  </div>
</template>

<style scoped>
.tools-container {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.scroll-blur-top,
.scroll-blur-bottom {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 5;
}

.scroll-blur-top {
  top: 0;
  height: 32px;
  background: linear-gradient(to bottom, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
}

.scroll-blur-bottom {
  bottom: 0;
  height: 48px;
  background: linear-gradient(to top, var(--color-bg-base) 0%, transparent 100%);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  -webkit-mask-image: linear-gradient(to top, black 0%, transparent 100%);
  mask-image: linear-gradient(to top, black 0%, transparent 100%);
}

.tools-review {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
}

.tool-card {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  overflow: hidden;
  /* Tells the browser each card's layout is independent — speeds up
     incremental rendering when only the last card is being updated. */
  contain: layout style;
}

.tool-card--running {
  border-color: color-mix(in srgb, var(--color-accent) 28%, var(--color-border-subtle));
}

.tool-card--error {
  border-color: color-mix(in srgb, var(--color-danger) 36%, var(--color-border-subtle));
}

.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  padding: 6px 9px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
}

.tool-card-status {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  text-transform: uppercase;
  color: var(--color-text-dim);
  background: var(--color-bg-elevated);
}

.tool-card-status--running {
  color: var(--color-accent-text);
  background: var(--color-accent-muted);
}

.tool-card-status--done {
  color: var(--color-success);
  background: var(--color-success-muted);
}

.tool-card-status--error {
  color: var(--color-danger);
  background: var(--color-danger-muted);
}

.tool-card-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-dim);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
}

.tool-output {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre;
  color: var(--color-text-secondary);
  background: var(--color-bg-base);
  scrollbar-width: thin;
}

.tool-output--terminal {
  color: var(--color-text-primary);
}

.tool-output--diff {
  color: var(--color-text-primary);
}

.tool-output--json {
  color: var(--color-text-tertiary);
}

.tool-output-empty {
  padding: 14px 10px;
  font-size: 11.5px;
  color: var(--color-text-dim);
  background: var(--color-bg-base);
}

.tools-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 220px;
  padding: 32px 18px;
  text-align: center;
}

.tools-empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
}

.tools-empty-title,
.tools-empty-hint {
  margin: 0;
}

.tools-empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.tool-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: var(--color-bg-base);
}

.tool-image {
  max-width: 100%;
  max-height: 420px;
  border-radius: var(--radius-md);
  object-fit: contain;
  cursor: zoom-in;
}

.tool-image:hover {
  outline: 1px solid var(--color-border-mid);
}

/* ── Diff Viewer ─────────────────────────────────────────────── */
.tool-diff {
  max-height: 420px;
  overflow: auto;
  background: var(--color-bg-base);
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11.5px;
  line-height: 1.55;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-bright) transparent;
}

.diff-file + .diff-file {
  border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
}

.diff-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--color-bg-surface) 80%, var(--color-bg-base));
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
}

.diff-file-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}

.hunk-header {
  padding: 3px 12px;
  font-size: 10.5px;
  color: var(--color-text-dim);
  background: color-mix(in srgb, var(--color-bg-surface) 60%, var(--color-bg-base));
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  user-select: none;
}

.diff-line {
  display: flex;
  align-items: stretch;
  min-width: max-content;
}

.line-gutter {
  display: flex;
  width: 72px;
  flex-shrink: 0;
  border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 30%, transparent);
}

.line-num {
  width: 36px;
  text-align: right;
  padding: 0 6px;
  color: var(--color-text-dim);
  opacity: 0.5;
  user-select: none;
  font-size: 10.5px;
  line-height: inherit;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.line-sign {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-weight: 600;
  font-size: 12px;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.line-text {
  padding: 0 12px;
  white-space: pre;
  flex: 1;
}

/* Add */
.diff-add {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}
.diff-add .line-sign {
  color: var(--color-success);
}
.diff-add .line-text {
  color: color-mix(in srgb, var(--color-success) 60%, var(--color-text-primary));
}
.diff-add .line-gutter {
  background: color-mix(in srgb, var(--color-success) 8%, transparent);
}

/* Delete */
.diff-del {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
}
.diff-del .line-sign {
  color: var(--color-danger);
}
.diff-del .line-text {
  color: color-mix(in srgb, var(--color-danger) 60%, var(--color-text-primary));
}
.diff-del .line-gutter {
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
}

/* Context */
.diff-ctx .line-text {
  color: var(--color-text-dim);
  opacity: 0.7;
}
</style>
