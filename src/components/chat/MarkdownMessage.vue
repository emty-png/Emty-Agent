<script setup lang="ts">
/**
 * MarkdownMessage.vue
 *
 * Production-grade markdown renderer for AI responses:
 *  - Shiki syntax-highlighted code blocks (ember-dark theme)
 *  - SVG icon copy button with two-state (idle/copied) feedback
 *  - Per-block word-wrap toggle button
 *  - Inline: bold/italic (* and _ syntax), strikethrough, code, links
 *  - Block: headings, lists (with GFM task-list checkboxes), blockquotes,
 *    tables, HR
 *  - Streaming-safe: open fences render as plain <pre> with blinking cursor
 *  - Race-condition-safe pipeline: version counter prevents stale commits
 *  - Per-instance state: safe to mount any number of instances simultaneously
 *  - Zero memory leaks: codeStore cleared before every render pass
 */

import { onUnmounted, ref, watch } from 'vue'
import { getHighlighter } from '@/utils/highlighter'

const props = defineProps<{
  content: string
  /** True while the parent is actively streaming this message. */
  streaming?: boolean
}>()

// ── inline SVG icons (v-html context — no Vue components) ─────────────────────

const ICON_CLIPBOARD = /* html */'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>'
const ICON_CHECK = /* html */'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_WRAP = /* html */'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 0 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="10" y2="18"/></svg>'

// ── rendered output ───────────────────────────────────────────────────────────

const html = ref('')

// ── per-instance state ────────────────────────────────────────────────────────

/**
 * Maps code-block IDs → raw source string for the copy handler.
 * Cleared at the top of every render so it never grows unboundedly
 * across streaming updates and old IDs cannot linger.
 */
const codeStore = new Map<string, string>()

/**
 * Monotonic ID counter, reset to 0 before each render pass so IDs
 * are stable (cb-1, cb-2 …) across re-renders of the same content.
 */
let blockSeq = 0

/**
 * Render generation counter. Incremented on every scheduled render.
 * An async render only commits its HTML if the version it captured at
 * launch still matches — preventing a slow Shiki call from overwriting
 * a newer, faster one.
 */
let renderVersion = 0

// ── HTML escaping ─────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── inline renderer ───────────────────────────────────────────────────────────

function renderInline(raw: string): string {
  // Split on inline-code spans first so we never apply formatting inside them.
  const parts = raw.split(/(`[^`\n]+`)/)

  return parts.map((part, i) => {
    // Odd-indexed parts are inline code spans.
    if (i % 2 === 1) {
      return `<code class="md-ic">${escHtml(part.slice(1, -1))}</code>`
    }

    let t = escHtml(part)

    // bold + italic (must be tested before bold or italic individually)
    t = t.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    t = t.replace(/___(.+?)___/gs, '<strong><em>$1</em></strong>')
    // bold
    t = t.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    t = t.replace(/__(.+?)__/gs, '<strong>$1</strong>')
    // italic  (* and _)
    t = t.replace(/\*([^\s*][^*]*)\*/g, '<em>$1</em>')
    t = t.replace(/_([^\s_][^_]*)_/g, '<em>$1</em>')
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

// ── block types ───────────────────────────────────────────────────────────────

interface CodeBlock { type: 'code'; lang: string; code: string; closed: boolean; id: string }
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

// ── tokeniser ─────────────────────────────────────────────────────────────────

function tokenise(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // ── fenced code block ──────────────────────────────────────────────────────
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'plaintext'
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
      blocks.push({ type: 'code', lang, code: codeLines.join('\n'), closed, id: `cb-${++blockSeq}` })
      continue
    }

    // ── ATX heading ───────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1]!.length, text: hm[2]! })
      i++; continue
    }

    // ── horizontal rule ───────────────────────────────────────────────────────
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // ── blockquote ────────────────────────────────────────────────────────────
    if (line.startsWith('> ') || line === '>') {
      const qLines: string[] = []
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        qLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'blockquote', lines: qLines })
      continue
    }

    // ── unordered list (supports GFM task items) ──────────────────────────────
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

    // ── ordered list ──────────────────────────────────────────────────────────
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

    // ── pipe table ────────────────────────────────────────────────────────────
    if (line.includes('|') && /^[\s|:-]+$/.test(lines[i + 1] ?? '')) {
      const tLines: string[] = []
      while (i < lines.length && lines[i]!.includes('|')) {
        tLines.push(lines[i]!)
        i++
      }
      if (tLines.length >= 2) {
        const parseRow = (l: string) =>
          l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        blocks.push({ type: 'table', header: parseRow(tLines[0]!), rows: tLines.slice(2).map(parseRow) })
        continue
      }
    }

    // ── blank line ────────────────────────────────────────────────────────────
    if (line.trim() === '') {
      i++
      continue
    }

    // ── paragraph ─────────────────────────────────────────────────────────────
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]!
      if (
        l.trim() === '' || l.startsWith('#') || l.startsWith('```')
        || /^[-*+]\s/.test(l) || /^\d+\.\s/.test(l) || l.startsWith('> ') || l === '>'
        || /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)
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

// ── block → HTML ──────────────────────────────────────────────────────────────

async function blockToHtml(block: Block): Promise<string> {
  switch (block.type) {
    // ── heading ───────────────────────────────────────────────────────────────
    case 'heading': {
      const tag = `h${block.level}`
      return `<${tag} class="md-h md-h${block.level}">${renderInline(block.text)}</${tag}>`
    }

    // ── paragraph ─────────────────────────────────────────────────────────────
    case 'paragraph': {
      return `<p class="md-p">${block.lines.map(l => renderInline(l)).join('<br>')}</p>`
    }

    // ── fenced code ───────────────────────────────────────────────────────────
    case 'code': {
      const { id, lang, code, closed } = block
      codeStore.set(id, code)

      let body: string
      if (!closed) {
        // Streaming: fence not yet closed — plain pre + blinking cursor.
        body = `<div class="md-code-body">\
<span class="md-code-plain">${escHtml(code)}</span>\
<span class="md-cursor"> ▊</span></div>`
      }
      else {
        try {
          const h = await getHighlighter()
          const useLang = h.getLoadedLanguages().includes(lang as never) ? lang : 'plaintext'
          body = `<div class="md-code-body">${h.codeToHtml(code, { lang: useLang, theme: 'ember-dark' })}</div>`
        }
        catch {
          body = `<div class="md-code-body"><pre class="md-code-fallback"><code>${escHtml(code)}</code></pre></div>`
        }
      }

      const langLabel = lang && lang !== 'plaintext'
        ? `<span class="md-code-lang">${escHtml(lang)}</span>`
        : '<span></span>'

      const actions = `<div class="md-code-actions">\
<button class="md-btn md-wrap-btn" data-wrap-id="${id}" title="Toggle word wrap" aria-label="Toggle word wrap">${ICON_WRAP}</button>\
<button class="md-btn md-copy-btn" data-code-id="${id}" aria-label="Copy code">\
<span class="md-copy-idle">${ICON_CLIPBOARD}<span>Copy</span></span>\
<span class="md-copy-done">${ICON_CHECK}<span>Copied!</span></span>\
</button></div>`

      return `<div class="md-code-wrap" data-lang="${escHtml(lang)}">\
<div class="md-code-header">${langLabel}${actions}</div>${body}</div>`
    }

    // ── unordered list (with GFM task items) ──────────────────────────────────
    case 'ul': {
      const isTaskList = block.items.some(it => /^\[[ x]\]/i.test(it))
      const items = block.items.map(it => {
        const task = it.match(/^\[([ x])\]\s+(\S.*)$/i)
        if (task) {
          const checked = task[1]!.toLowerCase() === 'x'
          return `<li class="md-li md-task-item">\
<label class="md-task-label">\
<input type="checkbox" class="md-checkbox" ${checked ? 'checked' : ''} disabled>\
<span>${renderInline(task[2]!)}</span>\
</label></li>`
        }
        return `<li class="md-li">${renderInline(it)}</li>`
      }).join('')
      return `<ul class="${isTaskList ? 'md-ul md-task-list' : 'md-ul'}">${items}</ul>`
    }

    // ── ordered list ──────────────────────────────────────────────────────────
    case 'ol': {
      const items = block.items.map(it => `<li class="md-li">${renderInline(it)}</li>`).join('')
      return `<ol class="md-ol">${items}</ol>`
    }

    // ── blockquote ────────────────────────────────────────────────────────────
    case 'blockquote': {
      // Render inner lines as a paragraph so inline formatting works
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<blockquote class="md-bq"><p class="md-bq-inner">${inner}</p></blockquote>`
    }

    // ── table ─────────────────────────────────────────────────────────────────
    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="md-th">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row =>
        `<tr>${row.map(c => `<td class="md-td">${renderInline(c)}</td>`).join('')}</tr>`,
      ).join('')}</tbody>`
      return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`
    }

    // ── horizontal rule ───────────────────────────────────────────────────────
    case 'hr':
      return '<hr class="md-hr">'

    default:
      return ''
  }
}

// ── render pipeline ───────────────────────────────────────────────────────────

/**
 * Synchronous HTML generator for non-code blocks.
 * Avoids the async overhead of blockToHtml() for simple blocks.
 */
function blockToHtmlSync(block: Block): string | null {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`
      return `<${tag} class="md-h md-h${block.level}">${renderInline(block.text)}</${tag}>`
    }
    case 'paragraph':
      return `<p class="md-p">${block.lines.map(l => renderInline(l)).join('<br>')}</p>`
    case 'ul': {
      const isTaskList = block.items.some(it => /^\[[ x]\]/i.test(it))
      const items = block.items.map(it => {
        const task = it.match(/^\[([ x])\]\s+(\S.*)$/i)
        if (task) {
          const checked = task[1]!.toLowerCase() === 'x'
          return `<li class="md-li md-task-item"><label class="md-task-label"><input type="checkbox" class="md-checkbox" ${checked ? 'checked' : ''} disabled><span>${renderInline(task[2]!)}</span></label></li>`
        }
        return `<li class="md-li">${renderInline(it)}</li>`
      }).join('')
      return `<ul class="${isTaskList ? 'md-ul md-task-list' : 'md-ul'}">${items}</ul>`
    }
    case 'ol': {
      const items = block.items.map(it => `<li class="md-li">${renderInline(it)}</li>`).join('')
      return `<ol class="md-ol">${items}</ol>`
    }
    case 'blockquote': {
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<blockquote class="md-bq"><p class="md-bq-inner">${inner}</p></blockquote>`
    }
    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="md-th">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row => `<tr>${row.map(c => `<td class="md-td">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`
    }
    case 'hr':
      return '<hr class="md-hr">'
    // code blocks must go through the async path
    default:
      return null
  }
}

/**
 * Stable prefix cache for incremental rendering.
 *
 * During streaming we split the content at the last "stable boundary" —
 * the end of the last fully-closed non-streaming block. Everything before
 * that boundary is already rendered into `stableHtml` and never re-processed.
 * Only the tail (current open block) is re-rendered on each tick.
 *
 * This reduces the per-tick render work from O(totalLength) to O(tailLength).
 */
let stableHtml = ''
let stableBoundary = 0 // char index in content where stable HTML ends
let stableBlockSeq = 0 // blockSeq value at the stable boundary

function resetStableCache(): void {
  stableHtml = ''
  stableBoundary = 0
  stableBlockSeq = 0
}

/**
 * Find the char index of the end of the last fully-closed block during streaming.
 * A block is "closed" if it isn't an unclosed code fence and the next char is a newline.
 * We look for the last double-newline (paragraph boundary) before the current tail.
 */
function findStableBoundary(content: string): number {
  // Walk backwards from the end looking for a paragraph boundary (double newline)
  // or a closed code fence boundary.
  const min = stableBoundary // never go before current stable point
  let i = content.length - 1

  // Skip trailing partial line
  while (i > min && content[i] !== '\n') i--
  // Skip the most recent complete line (it may still be growing)
  if (i > min)
    i--
  while (i > min && content[i] !== '\n') i--

  // Now find the last double-newline before i
  const doubleNl = content.lastIndexOf('\n\n', i)
  if (doubleNl > min)
    return doubleNl + 2 // start of next block after the blank line

  return min
}

async function renderContent(content: string, version: number, streaming: boolean): Promise<void> {
  if (!content) {
    if (renderVersion === version) {
      html.value = ''
      resetStableCache()
    }
    return
  }

  if (!streaming) {
    // Non-streaming (final render or initial load): full render from scratch.
    resetStableCache()
    codeStore.clear()
    blockSeq = 0

    const blocks = tokenise(content)
    const parts = await Promise.all(blocks.map(blockToHtml))

    if (renderVersion === version)
      html.value = parts.join('\n')

    return
  }

  // ── Streaming: incremental render ─────────────────────────────────────────

  // Find how far we can extend the stable prefix.
  const newBoundary = findStableBoundary(content)

  if (newBoundary > stableBoundary) {
    // There are newly completed blocks in the stable zone — render them and cache.
    const stableSlice = content.slice(stableBoundary, newBoundary)
    codeStore.clear()
    blockSeq = stableBlockSeq

    const newBlocks = tokenise(stableSlice)
    const newParts: string[] = []

    for (const block of newBlocks) {
      // Try sync path first (avoids async overhead for non-code blocks)
      const syncHtml = blockToHtmlSync(block)
      if (syncHtml !== null) {
        newParts.push(syncHtml)
      }
      else {
        // Code block — use async Shiki path
        newParts.push(await blockToHtml(block))
      }
      if (renderVersion !== version)
        return
    }

    stableHtml += newParts.join('\n')
    if (newParts.length > 0)
      stableHtml += '\n'
    stableBoundary = newBoundary
    stableBlockSeq = blockSeq
  }

  // Render the tail (current open/streaming block)
  const tail = content.slice(stableBoundary)
  let tailHtml = ''

  if (tail.trim()) {
    codeStore.clear()
    blockSeq = stableBlockSeq

    const tailBlocks = tokenise(tail)
    const tailParts: string[] = []

    for (const block of tailBlocks) {
      const syncHtml = blockToHtmlSync(block)
      if (syncHtml !== null) {
        tailParts.push(syncHtml)
      }
      else {
        tailParts.push(await blockToHtml(block))
      }
      if (renderVersion !== version)
        return
    }
    tailHtml = tailParts.join('\n')
  }

  if (renderVersion === version)
    html.value = stableHtml + tailHtml
}

// ── watchers ──────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null

function scheduleRender(): void {
  if (timer)
    clearTimeout(timer)
  const version = ++renderVersion
  const streaming = props.streaming ?? false
  // Increase debounce slightly during streaming to batch more deltas per tick.
  // 80ms is still imperceptible to humans but gives the engine more tokens per render.
  timer = setTimeout(() => {
    renderContent(props.content, version, streaming)
    timer = null
  }, streaming ? 80 : 0)
}

watch(() => props.content, scheduleRender, { immediate: true })

// Force a clean final render when streaming finishes.
// Reset the incremental cache so the full re-render starts from scratch.
watch(() => props.streaming, streaming => {
  if (!streaming) {
    if (timer)
      clearTimeout(timer)
    resetStableCache()
    const version = ++renderVersion
    renderContent(props.content, version, false)
  }
})

onUnmounted(() => {
  if (timer)
    clearTimeout(timer)
  resetStableCache()
})

// ── event delegation (copy + word-wrap) ──────────────────────────────────────

function handleClick(e: MouseEvent): void {
  const target = e.target as Element

  // ── copy button ──
  const copyBtn = target.closest<HTMLElement>('[data-code-id]')
  if (copyBtn) {
    const code = codeStore.get(copyBtn.dataset.codeId!)
    if (code == null)
      return
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.dataset.copied = '1'
      setTimeout(() => { delete copyBtn.dataset.copied }, 2000)
    }).catch(() => {})
    return
  }

  // ── word-wrap toggle ──
  const wrapBtn = target.closest<HTMLElement>('[data-wrap-id]')
  if (wrapBtn) {
    const wrap = wrapBtn.closest<HTMLElement>('.md-code-wrap')
    if (wrap) {
      wrap.classList.toggle('is-wrapped')
      wrapBtn.classList.toggle('is-active')
    }
  }
}
</script>

<template>
  <!--
    v-html is intentional and safe here:
    • Content is produced by the AI model, not by arbitrary user HTML input.
    • All text that originates from block parsing is passed through escHtml().
    • Links have target="_blank" rel="noopener noreferrer".
  -->
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

/* Consistent bottom margin for all block-level elements */
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
/* Suppress top margin when a heading is the very first element */
.md-root :deep(.md-h:first-child) {
  margin-top: 0;
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
  color: var(--color-code);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-mid);
}

/* ── links ────────────────────────────────────────────────────────────────── */
.md-root :deep(.md-a) {
  color: var(--color-info-text);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 120ms ease;
}
.md-root :deep(.md-a:hover) {
  color: var(--color-text-primary);
}

/* ── strong / em / del ────────────────────────────────────────────────────── */
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

/* ── task list ────────────────────────────────────────────────────────────── */
.md-root :deep(.md-task-list) {
  list-style: none;
  padding-left: 4px;
}
.md-root :deep(.md-task-item) {
  margin-bottom: 5px;
}
.md-root :deep(.md-task-label) {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: default;
  user-select: none;
}
.md-root :deep(.md-checkbox) {
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--color-accent-bright);
  cursor: default;
  translate: 0 1px;
}

/* ── blockquote ───────────────────────────────────────────────────────────── */
.md-root :deep(.md-bq) {
  border-left: 3px solid var(--color-accent-dim);
  margin: 0 0 14px;
  padding: 8px 16px;
  background: color-mix(in srgb, var(--color-accent-muted) 40%, transparent);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-secondary);
  font-style: italic;
}
.md-root :deep(.md-bq-inner) {
  margin: 0;
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
  background: var(--color-bg-base);
  margin-bottom: 14px;
}

/* ── code block header ────────────────────────────────────────────────────── */
.md-root :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
  min-height: 34px;
  gap: 8px;
}
.md-root :deep(.md-code-lang) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}

/* ── code block action buttons ────────────────────────────────────────────── */
.md-root :deep(.md-code-actions) {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.md-root :deep(.md-btn) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  height: 22px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease,
    border-color 110ms ease;
  white-space: nowrap;
  line-height: 1;
}
.md-root :deep(.md-btn:hover) {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

/* Word-wrap toggle — icon-only, slightly narrower */
.md-root :deep(.md-wrap-btn) {
  padding: 2px 6px;
}
.md-root :deep(.md-wrap-btn.is-active) {
  background: var(--color-bg-hover);
  color: var(--color-accent-text);
  border-color: var(--color-accent-dim);
}

/* Copy button — two-state via data-copied attribute */
.md-root :deep(.md-copy-btn .md-copy-done) {
  display: none;
}
.md-root :deep(.md-copy-btn[data-copied] .md-copy-idle) {
  display: none;
}
.md-root :deep(.md-copy-btn[data-copied] .md-copy-done) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-success-text, #4ade80);
}
.md-root :deep(.md-copy-idle) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* ── code block body ──────────────────────────────────────────────────────── */
.md-root :deep(.md-code-body) {
  overflow-x: auto;
}
/* Shiki wraps in <pre><code>. Override background to match wrapper. */
.md-root :deep(.md-code-body pre) {
  margin: 0;
  padding: 14px 16px;
  background: var(--color-bg-base) !important;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  /* No wrap by default — toggled by .is-wrapped */
  white-space: pre;
}
.md-root :deep(.md-code-body code) {
  font-family: inherit;
  background: transparent;
}
/* Word-wrap enabled state */
.md-root :deep(.md-code-wrap.is-wrapped .md-code-body pre) {
  white-space: pre-wrap;
  overflow-x: hidden;
}

/* Plain pre (streaming / error fallback) */
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
  animation: md-blink 0.9s step-end infinite;
  color: var(--color-accent-bright);
}
@keyframes md-blink {
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
  white-space: nowrap;
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
/* Subtle hover on table rows */
.md-root :deep(tbody tr:hover td) {
  background: color-mix(in srgb, var(--color-bg-hover) 60%, transparent);
}

/* ── SVG ──────────────────────────────────────────────────────────────────── */
.md-root :deep(svg:not(.md-btn svg)) {
  display: block;
  max-width: 100%;
  height: auto;
  max-height: 480px;
}

/* ── reduced-motion ───────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .md-root :deep(.md-cursor) {
    animation: none;
    opacity: 1;
  }
  .md-root :deep(.md-btn) {
    transition: none;
  }
}
</style>
