<script setup lang="ts">
import type { Message } from '@/stores/chat'
import type { Attachment } from '@/stores/chat/attachment-types'
import { Copy, FileText } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatFileSize } from '@/stores/chat/attachment-types'

const props = defineProps<{
  msg: Message
}>()

const emit = defineEmits<{
  previewAttachment: [Attachment]
}>()

const attachments = computed(() => props.msg.attachments ?? [])

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const copied = ref(false)
async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch (err) {
    console.error('Failed to copy', err)
  }
}

/* ── Markdown Renderer Logic (User Custom) ───────────────────────────────── */
const html = ref('')

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(raw: string): string {
  // Split on inline-code spans first so we never apply formatting inside them.
  const parts = raw.split(/(`[^`\n]+`)/)

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return `<code class="um-ic">${escHtml(part.slice(1, -1))}</code>`
    }

    let t = escHtml(part)

    // Standard Markdown formatting
    t = t.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    t = t.replace(/___(.+?)___/gs, '<strong><em>$1</em></strong>')
    t = t.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    t = t.replace(/__(.+?)__/gs, '<strong>$1</strong>')
    t = t.replace(/\*([^\s*][^*]*)\*/g, '<em>$1</em>')
    t = t.replace(/_([^\s_][^_]*)_/g, '<em>$1</em>')
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>')

    // Links
    t = t.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="um-a" target="_blank" rel="noopener noreferrer">$1</a>',
    )

    // Custom App Tokens
    t = t.replace(/@\[([\w./\-]+)\]/g, '$1')
    t = t.replace(/\[skill:([^\]]+)\]/g, '$1')

    return t
  }).join('')
}

interface CodeBlock { type: 'code'; lang: string; code: string; closed: boolean }
interface HeadingBlock { type: 'heading'; level: number; text: string }
interface ParagraphBlock { type: 'paragraph'; lines: string[] }
interface UlBlock { type: 'ul'; items: string[] }
interface OlBlock { type: 'ol'; items: string[] }
interface BlockquoteBlock { type: 'blockquote'; lines: string[] }
interface TableBlock { type: 'table'; header: string[]; rows: string[][] }
interface HrBlock { type: 'hr' }

type Block
  = | CodeBlock | HeadingBlock | ParagraphBlock
    | UlBlock | OlBlock | BlockquoteBlock
    | TableBlock | HrBlock

function tokenise(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // fenced code block
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || ''
      const codeLines: string[] = []
      let closed = false
      i++
      while (i < lines.length) {
        if (lines[i]!.trimStart().startsWith('```')) {
          closed = true
          i++
          break
        }
        codeLines.push(lines[i]!)
        i++
      }
      blocks.push({ type: 'code', lang, code: codeLines.join('\n'), closed })
      continue
    }

    // heading
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1]!.length, text: hm[2]! })
      i++; continue
    }

    // hr
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // blockquote
    if (line.startsWith('> ') || line === '>') {
      const qLines: string[] = []
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        qLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'blockquote', lines: qLines }); continue
    }

    // ul (with task lists)
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
        let item = lines[i]!.replace(/^[-*+]\s+/, '')
        i++
        while (i < lines.length && /^(?:\s{2,}|\t)/.test(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`; i++
        }
        items.push(item)
      }
      blocks.push({ type: 'ul', items }); continue
    }

    // ol
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\d+\.\s+/, '')
        i++
        while (i < lines.length && /^(?:\s{2,}|\t)/.test(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`; i++
        }
        items.push(item)
      }
      blocks.push({ type: 'ol', items }); continue
    }

    // pipe table
    if (line.includes('|') && /^[\s|:-]+$/.test(lines[i + 1] ?? '')) {
      const tLines: string[] = []
      while (i < lines.length && lines[i]!.includes('|')) {
        tLines.push(lines[i]!); i++
      }
      if (tLines.length >= 2) {
        const parseRow = (l: string) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        blocks.push({ type: 'table', header: parseRow(tLines[0]!), rows: tLines.slice(2).map(parseRow) })
        continue
      }
    }

    // blank line
    if (line.trim() === '') {
      i++; continue
    }

    // paragraph
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]!
      if (
        l.trim() === '' || l.startsWith('#') || l.startsWith('```') || /^[-*+]\s/.test(l) || /^\d+\.\s/.test(l)
        || l.startsWith('> ') || l === '>' || /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)
        || (l.includes('|') && /^[\s|:-]+$/.test(lines[i + 1] ?? ''))
      ) {
        break
      }
      paraLines.push(l); i++
    }
    if (paraLines.length > 0)
      blocks.push({ type: 'paragraph', lines: paraLines })
  }

  return blocks
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`
      return `<${tag} class="um-h um-h${block.level}">${renderInline(block.text)}</${tag}>`
    }
    case 'paragraph':
      return `<p class="um-p">${block.lines.map(l => renderInline(l)).join('<br>')}</p>`
    case 'ul': {
      const isTaskList = block.items.some(it => /^\[[ x]\]/i.test(it))
      const items = block.items.map(it => {
        const task = it.match(/^\[([ x])\]\s+(\S.*)$/i)
        if (task) {
          const checked = task[1]!.toLowerCase() === 'x'
          return `<li class="um-li um-task-item"><label class="um-task-label"><input type="checkbox" class="um-checkbox" ${checked ? 'checked' : ''} disabled><span>${renderInline(task[2]!)}</span></label></li>`
        }
        return `<li class="um-li">${renderInline(it)}</li>`
      }).join('')
      return `<ul class="${isTaskList ? 'um-ul um-task-list' : 'um-ul'}">${items}</ul>`
    }
    case 'ol': {
      const items = block.items.map(it => `<li class="um-li">${renderInline(it)}</li>`).join('')
      return `<ol class="um-ol">${items}</ol>`
    }
    case 'blockquote': {
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<blockquote class="um-bq"><p class="um-bq-inner">${inner}</p></blockquote>`
    }
    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="um-th">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row => `<tr>${row.map(c => `<td class="um-td">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      return `<div class="um-table-wrap"><table class="um-table">${thead}${tbody}</table></div>`
    }
    case 'hr':
      return '<hr class="um-hr">'
    case 'code': {
      const { lang, code } = block
      const body = `<pre class="um-code-pre"><code>${escHtml(code)}</code></pre>`
      const langLabel = lang ? `<span class="um-code-lang">${escHtml(lang)}</span>` : ''
      return `<div class="um-code-wrap">${langLabel ? `<div class="um-code-header">${langLabel}</div>` : ''}${body}</div>`
    }
    default:
      return ''
  }
}

function renderAll(content: string): string {
  if (!content)
    return ''
  const blocks = tokenise(content)
  return blocks.map(renderBlock).join('\n')
}

watch(() => props.msg.content, newContent => {
  html.value = renderAll(newContent)
}, { immediate: true })

/* ── Seamless Truncation Logic ───────────────────────────────────────────── */
const textContentRef = ref<HTMLElement | null>(null)
const showToggle = ref(false)
const isCollapsed = ref(true)
const MAX_HEIGHT = 200

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  resizeObserver = new ResizeObserver(() => {
    if (textContentRef.value) {
      showToggle.value = textContentRef.value.scrollHeight > MAX_HEIGHT + 20
    }
  })

  if (textContentRef.value) {
    resizeObserver.observe(textContentRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver)
    resizeObserver.disconnect()
})
</script>

<template>
  <div class="group flex flex-col items-end gap-1 py-0.5">
    <div class="flex min-w-0 w-full flex-col rounded-[var(--radius-lg)] bg-[var(--color-accent-muted-plus)] px-3.5 py-2.5 text-[var(--color-text-primary)]">
      <!-- Rendered Markdown Content with Masking -->
      <div
        v-if="msg.content"
        class="relative w-full"
        :class="{ 'max-h-[200px] overflow-hidden [-webkit-mask-image:linear-gradient(to_bottom,black_40%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_40%,transparent_100%)]': isCollapsed && showToggle }"
      >
        <div ref="textContentRef" class="um-root whitespace-normal break-words text-[13.5px] leading-[1.55] text-[var(--color-text-primary)] [word-break:break-word]" v-html="html" />
      </div>

      <!-- Centered "Show more" link -->
      <div v-if="showToggle" class="flex w-full justify-center" :class="isCollapsed ? 'relative z-[2] -mt-4' : 'mt-1.5'">
        <button class="cursor-pointer border-none bg-transparent px-2.5 py-1 text-[12px] font-semibold text-inherit opacity-60 transition-all duration-[150ms] hover:underline hover:opacity-100" @click="isCollapsed = !isCollapsed">
          {{ isCollapsed ? 'Show more' : 'Show less' }}
        </button>
      </div>

      <!-- Attachments -->
      <div v-if="attachments.length > 0" class="mt-2 flex flex-wrap gap-2 border-t border-[var(--color-accent-dim)] pt-2">
        <div
          v-for="att in attachments"
          :key="att.id"
          class="relative max-w-[200px] cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-accent-dim)] bg-[var(--color-bg-base)] overflow-hidden transition-opacity duration-[120ms] hover:opacity-[0.85]"
          @click="emit('previewAttachment', att)"
        >
          <img
            v-if="att.type === 'image'"
            :src="att.dataUrl"
            :alt="att.name"
            class="block h-[60px] w-auto max-w-[140px] object-cover"
          >
          <div v-else class="flex items-center gap-1.5 px-2.5 py-2 text-[var(--color-accent-text)]">
            <FileText :size="14" :stroke-width="1.6" />
            <span class="max-w-[100px] truncate text-[12px] font-medium">{{ att.name }}</span>
            <span class="text-[10px] opacity-70">{{ formatFileSize(att.size) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Meta -->
    <div class="mr-1 flex items-center gap-1.5 opacity-0 transition-opacity duration-[150ms] group-hover:opacity-100">
      <button
        class="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-transparent bg-transparent text-[var(--color-text-tertiary)] transition-colors duration-[120ms] hover:border-[var(--color-border-mid)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-secondary)]"
        :class="{ '!text-[var(--color-success-text)]': copied }"
        :title="copied ? 'Copied!' : 'Copy message'"
        @click="copyMessage(msg.content)"
      >
        <Copy :size="12" :stroke-width="2" />
      </button>
      <span class="text-[11px] text-[var(--color-text-tertiary)]">{{ formatTime(msg.timestamp) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ── User Markdown Renderer (.um-root) ───────────────────────────────────── */
/*
  Styled specifically to look native inside the --color-accent-muted-plus
  bubble background. Using `color-mix` heavily to blend natively.
*/

/* Reset spacing */
.um-root :deep(p),
.um-root :deep(ul),
.um-root :deep(ol),
.um-root :deep(blockquote),
.um-root :deep(.um-code-wrap),
.um-root :deep(.um-table-wrap) {
  margin: 0 0 10px;
}
.um-root :deep(*:last-child) {
  margin-bottom: 0;
}

/* Typography */
.um-root :deep(strong) {
  font-weight: 600;
}
.um-root :deep(em) {
  font-style: italic;
}
.um-root :deep(del) {
  text-decoration: line-through;
  opacity: 0.7;
}
.um-root :deep(.um-a) {
  color: var(--color-accent-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Headings */
.um-root :deep(.um-h) {
  font-weight: 600;
  line-height: 1.3;
  margin-top: 14px;
  margin-bottom: 6px;
}
.um-root :deep(.um-h:first-child) {
  margin-top: 0;
}
.um-root :deep(.um-h1) {
  font-size: 1.25em;
}
.um-root :deep(.um-h2) {
  font-size: 1.15em;
}
.um-root :deep(.um-h3) {
  font-size: 1.05em;
}
.um-root :deep(.um-h4),
.um-root :deep(.um-h5),
.um-root :deep(.um-h6) {
  font-size: 1em;
}

/* Lists */
.um-root :deep(.um-ul),
.um-root :deep(.um-ol) {
  padding-left: 20px;
}
.um-root :deep(.um-li) {
  margin-bottom: 3px;
  line-height: 1.55;
}
.um-root :deep(.um-ul .um-li) {
  list-style-type: disc;
}
.um-root :deep(.um-ol .um-li) {
  list-style-type: decimal;
}

/* Task List */
.um-root :deep(.um-task-list) {
  list-style: none;
  padding-left: 4px;
}
.um-root :deep(.um-task-item) {
  margin-bottom: 4px;
}
.um-root :deep(.um-task-label) {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: default;
}
.um-root :deep(.um-checkbox) {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin: 0;
  translate: 0 1px;
  accent-color: var(--color-accent-text);
}

/* Blockquote */
.um-root :deep(.um-bq) {
  border-left: 3px solid color-mix(in srgb, var(--color-accent-text) 50%, transparent);
  padding: 6px 12px;
  color: var(--color-text-secondary);
  font-style: italic;
  background: color-mix(in srgb, var(--color-accent-text) 6%, transparent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.um-root :deep(.um-bq-inner) {
  margin: 0;
}

/* Horizontal Rule */
.um-root :deep(.um-hr) {
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--color-accent-text) 20%, transparent);
  margin: 14px 0;
}

/* Inline Code */
.um-root :deep(.um-ic) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 0.9em;
  background: color-mix(in srgb, var(--color-accent-text) 10%, transparent);
  color: var(--color-text-primary);
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  white-space: pre;
}

/* Code Blocks */
.um-root :deep(.um-code-wrap) {
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--color-accent-text) 15%, transparent);
  overflow: hidden;
  background: color-mix(in srgb, var(--color-accent-text) 5%, transparent);
}
.um-root :deep(.um-code-header) {
  padding: 4px 10px;
  background: color-mix(in srgb, var(--color-accent-text) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-accent-text) 10%, transparent);
  min-height: 24px;
  display: flex;
  align-items: center;
}
.um-root :deep(.um-code-lang) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
}
.um-root :deep(.um-code-pre) {
  margin: 0;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 0.92em;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.um-root :deep(.um-code-pre code) {
  font-family: inherit;
  background: transparent;
  color: inherit;
  padding: 0;
  border: none;
}

/* Tables */
.um-root :deep(.um-table-wrap) {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--color-accent-text) 15%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-accent-text) 4%, transparent);
}
.um-root :deep(.um-table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 12.5px;
}
.um-root :deep(.um-th) {
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--color-accent-text) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-accent-text) 15%, transparent);
}
.um-root :deep(.um-td) {
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-accent-text) 10%, transparent);
  vertical-align: top;
  word-break: break-word;
}
.um-root :deep(tr:last-child .um-td) {
  border-bottom: none;
}
</style>
