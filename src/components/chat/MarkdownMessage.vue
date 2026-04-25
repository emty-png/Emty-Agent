<script setup lang="ts">
/**
 * MarkdownMessage.vue
 *
 * Renders markdown from an AI response with:
 *  - Shiki syntax-highlighted code blocks (ember-dark theme, matches the app)
 *  - Copy button per code block (event delegation, no Vue click handlers in vhtml)
 *  - Inline formatting: bold, italic, strikethrough, inline-code, links
 *  - Block elements: headings, lists, blockquotes, tables, HR
 *  - Streaming-safe: open code fences render as plain pre until closed
 *  - Debounced re-render (60ms) to avoid thrashing Shiki during fast streaming
 */

import { onUnmounted, ref, watch } from 'vue'
import { getHighlighter } from '@/utils/highlighter'

const props = defineProps<{
  content: string
  /** True while the parent tab is actively streaming this message */
  streaming?: boolean
}>()

// ── rendered html ─────────────────────────────────────────────────────────────
const html = ref('')

// Map of code-block-id → raw code string (for copy buttons)
const codeStore = new Map<string, string>()
let blockSeq = 0

// ── inline rendering ──────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(raw: string): string {
  // Split on inline-code spans first so we never format inside them
  const parts = raw.split(/(`[^`\n]+`)/)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // odd index = inline code
      return `<code class="md-ic">${escHtml(part.slice(1, -1))}</code>`
    }
    let t = escHtml(part)
    // bold + italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    // bold
    t = t.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    // italic (avoid matching empty or just whitespace)
    t = t.replace(/\*([^\s*][^*]*)\*/g, '<em>$1</em>')
    // strikethrough
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>')
    // links
    t = t.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="md-a" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    return t
  }).join('')
}

// ── block tokeniser ───────────────────────────────────────────────────────────

interface CodeBlock { type: 'code'; lang: string; code: string; closed: boolean; id: string }
interface HeadingBlock { type: 'heading'; level: number; text: string }
interface ParagraphBlock { type: 'paragraph'; lines: string[] }
interface UlBlock { type: 'ul'; items: string[] }
interface OlBlock { type: 'ol'; items: string[] }
interface BlockquoteBlock { type: 'blockquote'; text: string }
interface TableBlock { type: 'table'; header: string[]; rows: string[][] }
interface HrBlock { type: 'hr' }

type Block = CodeBlock | HeadingBlock | ParagraphBlock | UlBlock | OlBlock | BlockquoteBlock | TableBlock | HrBlock

function tokenise(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // ── fenced code block ──
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'plaintext'
      const codeLines: string[] = []
      let closed = false
      i++
      while (i < lines.length) {
        if (lines[i]!.startsWith('```')) {
          closed = true
          i++
          break
        }
        codeLines.push(lines[i]!)
        i++
      }
      const id = `cb-${++blockSeq}`
      blocks.push({ type: 'code', lang, code: codeLines.join('\n'), closed, id })
      continue
    }

    // ── ATX heading ──
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1]!.length, text: hm[2]! })
      i++
      continue
    }

    // ── horizontal rule ──
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // ── blockquote ──
    if (line.startsWith('> ')) {
      const qLines: string[] = []
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        qLines.push(lines[i]!.slice(2))
        i++
      }
      blocks.push({ type: 'blockquote', text: qLines.join('\n') })
      continue
    }

    // ── unordered list ──
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
        // handle multi-line list items (indented continuation)
        let item = lines[i]!.replace(/^[-*+]\s+/, '')
        i++
        while (i < lines.length && /^(?:\s{2,}|\t)/.test(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`
          i++
        }
        items.push(item)
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // ── ordered list ──
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\d+\.\s+/, '')
        i++
        while (i < lines.length && /^(?:\s{2,}|\t)/.test(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`
          i++
        }
        items.push(item)
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // ── pipe table ──
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1] ?? '')) {
      const tLines: string[] = []
      while (i < lines.length && lines[i]!.includes('|')) {
        tLines.push(lines[i]!)
        i++
      }
      if (tLines.length >= 2) {
        const parseRow = (l: string) =>
          l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        const header = parseRow(tLines[0]!)
        const rows = tLines.slice(2).map(parseRow) // skip separator row
        blocks.push({ type: 'table', header, rows })
        continue
      }
    }

    // ── blank line (consumed silently) ──
    if (line.trim() === '') {
      i++
      continue
    }

    // ── paragraph (greedy: consume until a block-level element or blank line) ──
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]!
      if (
        l.trim() === ''
        || l.startsWith('#')
        || l.startsWith('```')
        || /^[-*+]\s/.test(l)
        || /^\d+\.\s/.test(l)
        || l.startsWith('> ')
        || /^[-*_]{3,}\s*$/.test(l.trim())
        || (l.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1] ?? ''))
      ) {
        break
      }
      paraLines.push(l)
      i++
    }
    if (paraLines.length > 0)
      blocks.push({ type: 'paragraph', lines: paraLines })
  }

  return blocks
}

// ── block → html ──────────────────────────────────────────────────────────────

async function blockToHtml(block: Block): Promise<string> {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`
      const cls = `md-h md-h${block.level}`
      return `<${tag} class="${cls}">${renderInline(block.text)}</${tag}>`
    }

    case 'paragraph': {
      // Join with <br> to preserve intentional line breaks inside a paragraph
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<p class="md-p">${inner}</p>`
    }

    case 'code': {
      const { id, lang, code, closed } = block
      codeStore.set(id, code)

      let highlighted: string
      if (!closed) {
        // Streaming: fence not yet closed — show plain pre with cursor
        highlighted = `<span class="md-code-plain">${escHtml(code)}</span><span class="md-cursor"> ▊</span>`
      }
      else {
        try {
          const h = await getHighlighter()
          // Validate the lang is one Shiki knows; fall back to plaintext
          const knownLangs = h.getLoadedLanguages()
          const useLang = knownLangs.includes(lang as never) ? lang : 'plaintext'
          highlighted = h.codeToHtml(code, { lang: useLang, theme: 'ember-dark' })
        }
        catch {
          highlighted = `<pre class="md-code-fallback"><code>${escHtml(code)}</code></pre>`
        }
      }

      const langLabel = lang && lang !== 'plaintext' ? `<span class="md-code-lang">${escHtml(lang)}</span>` : ''
      const copyBtn = `<button class="md-copy-btn" data-code-id="${id}" title="Copy code">Copy</button>`
      const header = `<div class="md-code-header">${langLabel}${copyBtn}</div>`

      return `<div class="md-code-wrap">${header}<div class="md-code-body">${highlighted}</div></div>`
    }

    case 'ul': {
      const items = block.items.map(it => `<li class="md-li">${renderInline(it)}</li>`).join('')
      return `<ul class="md-ul">${items}</ul>`
    }

    case 'ol': {
      const items = block.items.map(it => `<li class="md-li">${renderInline(it)}</li>`).join('')
      return `<ol class="md-ol">${items}</ol>`
    }

    case 'blockquote': {
      return `<blockquote class="md-bq">${renderInline(block.text)}</blockquote>`
    }

    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="md-th">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row => `<tr>${row.map(c => `<td class="md-td">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`
    }

    case 'hr':
      return '<hr class="md-hr">'

    default:
      return ''
  }
}

// ── render pipeline ───────────────────────────────────────────────────────────

async function renderContent(content: string): Promise<string> {
  if (!content)
    return ''
  const blocks = tokenise(content)
  const parts = await Promise.all(blocks.map(blockToHtml))
  return parts.join('\n')
}

// ── debounced watcher ─────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null

async function scheduleRender() {
  if (timer)
    clearTimeout(timer)

  // During streaming, debounce at 60ms to avoid thrashing Shiki
  const delay = props.streaming ? 60 : 0
  timer = setTimeout(async () => {
    html.value = await renderContent(props.content)
    timer = null
  }, delay)
}

watch(() => props.content, scheduleRender, { immediate: true })

// Force a clean final render when streaming ends
watch(() => props.streaming, async streaming => {
  if (!streaming) {
    if (timer)
      clearTimeout(timer)
    html.value = await renderContent(props.content)
  }
})

onUnmounted(() => {
  if (timer)
    clearTimeout(timer)
})

// ── copy button handler ───────────────────────────────────────────────────────

function handleClick(e: MouseEvent) {
  const btn = (e.target as Element).closest<HTMLElement>('[data-code-id]')
  if (!btn)
    return
  const id = btn.dataset.codeId
  if (!id)
    return
  const code = codeStore.get(id)
  if (code == null)
    return

  navigator.clipboard.writeText(code).then(() => {
    const prev = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = prev }, 1500)
  }).catch(() => {})
}
</script>

<template>
  <!-- v-html is safe here: content comes from AI model, not user HTML input.
       All user-visible text from block parsing is passed through escHtml(). -->
  <div class="md-root" @click.capture="handleClick" v-html="html" />
</template>

<style scoped>
/* ── root ─────────────────────────────────────────────────────────────────── */
.md-root {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--color-text-primary);
  word-break: break-word;
}

/* All block-level elements get a consistent bottom margin */
.md-root :deep(p),
.md-root :deep(ul),
.md-root :deep(ol),
.md-root :deep(blockquote),
.md-root :deep(.md-code-wrap),
.md-root :deep(.md-table-wrap) {
  margin-bottom: 14px;
}
.md-root :deep(*:last-child) {
  margin-bottom: 0;
}

/* ── headings ─────────────────────────────────────────────────────────────── */
.md-root :deep(.md-h) {
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-primary);
  margin-top: 20px;
  margin-bottom: 8px;
}
.md-root :deep(.md-h1) {
  font-size: 1.35em;
}
.md-root :deep(.md-h2) {
  font-size: 1.2em;
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 4px;
}
.md-root :deep(.md-h3) {
  font-size: 1.05em;
}
.md-root :deep(.md-h4),
.md-root :deep(.md-h5),
.md-root :deep(.md-h6) {
  font-size: 1em;
  color: var(--color-text-secondary);
}

/* ── paragraph ────────────────────────────────────────────────────────────── */
.md-root :deep(.md-p) {
  margin: 0 0 14px;
}

/* ── inline code ──────────────────────────────────────────────────────────── */
.md-root :deep(.md-ic) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  font-size: 0.875em;
  background: var(--color-bg-elevated);
  color: var(--color-text-code);
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--color-border-mid);
}

/* ── links ────────────────────────────────────────────────────────────────── */
.md-root :deep(.md-a) {
  color: var(--color-info-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md-root :deep(.md-a:hover) {
  color: var(--color-text-primary);
}

/* ── strong / em ──────────────────────────────────────────────────────────── */
.md-root :deep(strong) {
  font-weight: 700;
  color: var(--color-text-primary);
}
.md-root :deep(em) {
  font-style: italic;
  color: var(--color-text-secondary);
}
.md-root :deep(del) {
  text-decoration: line-through;
  color: var(--color-text-tertiary);
}

/* ── lists ────────────────────────────────────────────────────────────────── */
.md-root :deep(.md-ul),
.md-root :deep(.md-ol) {
  padding-left: 20px;
  margin: 0 0 14px;
}
.md-root :deep(.md-li) {
  margin-bottom: 4px;
  line-height: 1.6;
}
.md-root :deep(.md-ul .md-li) {
  list-style-type: disc;
}
.md-root :deep(.md-ol .md-li) {
  list-style-type: decimal;
}

/* ── blockquote ───────────────────────────────────────────────────────────── */
.md-root :deep(.md-bq) {
  border-left: 3px solid var(--color-accent-dim);
  margin: 0 0 14px;
  padding: 4px 14px;
  color: var(--color-text-secondary);
  font-style: italic;
}

/* ── horizontal rule ──────────────────────────────────────────────────────── */
.md-root :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--color-border-mid);
  margin: 18px 0;
}

/* ── code block wrapper ───────────────────────────────────────────────────── */
.md-root :deep(.md-code-wrap) {
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  overflow: hidden;
  background: var(--color-bg-base); /* matches emberDark editor.background */
  margin-bottom: 14px;
}

/* ── code block header ────────────────────────────────────────────────────── */
.md-root :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
  min-height: 32px;
}
.md-root :deep(.md-code-lang) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}
.md-root :deep(.md-copy-btn) {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  height: 20px;
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease;
  margin-left: auto;
}
.md-root :deep(.md-copy-btn:hover) {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

/* ── code block body ──────────────────────────────────────────────────────── */
.md-root :deep(.md-code-body) {
  overflow-x: auto;
}
/* Shiki wraps output in <pre><code>. Override its background to match wrapper. */
.md-root :deep(.md-code-body pre) {
  margin: 0;
  padding: 14px 16px;
  background: var(--color-bg-base) !important;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
}
.md-root :deep(.md-code-body code) {
  font-family: inherit;
  background: transparent;
}
/* Plain fallback (streaming / error) */
.md-root :deep(.md-code-fallback) {
  margin: 0;
  padding: 14px 16px;
  color: var(--color-text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 12.5px;
  white-space: pre-wrap;
}
.md-root :deep(.md-code-plain) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 12.5px;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  display: block;
  padding: 14px 16px;
}
/* Blinking cursor during streaming */
.md-root :deep(.md-cursor) {
  animation: blink 0.9s step-end infinite;
  color: var(--color-accent-bright);
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* ── table ────────────────────────────────────────────────────────────────── */
.md-root :deep(.md-table-wrap) {
  overflow-x: auto;
  margin-bottom: 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
}
.md-root :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.md-root :deep(.md-th) {
  padding: 7px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
}
.md-root :deep(.md-td) {
  padding: 7px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  vertical-align: top;
}
.md-root :deep(tr:last-child .md-td) {
  border-bottom: none;
}
</style>
