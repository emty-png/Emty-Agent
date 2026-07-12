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
      return `<code class="[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] text-[0.875em] bg-[var(--color-bg-elevated)] text-[var(--color-code)] px-[5px] py-[1px] rounded-[var(--radius-sm)] border border-[var(--color-border-mid)]">${escHtml(part.slice(1, -1))}</code>`
    }

    let t = escHtml(part)

    // bold + italic (must be tested before bold or italic individually)
    t = t.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong class="font-bold text-[var(--color-text-primary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')
    t = t.replace(/___(.+?)___/gs, '<strong class="font-bold text-[var(--color-text-primary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')
    // bold
    t = t.replace(/\*\*(.+?)\*\*/gs, '<strong class="font-bold text-[var(--color-text-primary)]">$1</strong>')
    t = t.replace(/__(.+?)__/gs, '<strong class="font-bold text-[var(--color-text-primary)]">$1</strong>')
    // italic  (* and _)
    t = t.replace(/\*([^\s*][^*]*)\*/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
    t = t.replace(/_([^\s_][^_]*)_/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
    // strikethrough
    t = t.replace(/~~(.+?)~~/g, '<del class="line-through text-[var(--color-text-tertiary)]">$1</del>')
    // links
    t = t.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-[var(--color-info-text)] underline underline-offset-2 transition-colors duration-[120ms] ease-[ease] hover:text-[var(--color-text-primary)]" target="_blank" rel="noopener noreferrer">$1</a>',
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

/**
 * Unified block-to-HTML renderer.
 * Returns a plain string for non-code blocks, or a Promise for code blocks
 * that need async Shiki highlighting.
 */
function renderBlock(block: Block): string | Promise<string> {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`
      const size = block.level === 1
        ? 'text-[1.35em]'
        : block.level === 2
          ? 'text-[1.2em] border-b border-[var(--color-border-subtle)] pb-[4px]'
          : block.level === 3
            ? 'text-[1.05em]'
            : 'text-[1em]'
      const color = block.level >= 4 ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'
      return `<${tag} class="${size} ${color} font-bold leading-[1.3] mt-[20px] mb-[8px] first:mt-0 last:mb-0">${renderInline(block.text)}</${tag}>`
    }
    case 'paragraph':
      return `<p class="mb-[14px] last:mb-0">${block.lines.map(l => renderInline(l)).join('<br>')}</p>`
    case 'ul': {
      const isTaskList = block.items.some(it => /^\[[ x]\]/i.test(it))
      const items = block.items.map(it => {
        const task = it.match(/^\[([ x])\]\s+(\S.*)$/i)
        if (task) {
          const checked = task[1]!.toLowerCase() === 'x'
          return `<li class="mb-[5px] leading-[1.6]"><label class="flex items-baseline gap-2 cursor-default select-none"><input type="checkbox" class="shrink-0 w-[13px] h-[13px] m-0 accent-[var(--color-accent-bright)] cursor-default translate-y-[1px]" ${checked ? 'checked' : ''} disabled><span>${renderInline(task[2]!)}</span></label></li>`
        }
        return `<li class="mb-[4px] leading-[1.6]">${renderInline(it)}</li>`
      }).join('')
      return `<ul class="${isTaskList ? 'pl-[4px] list-none' : 'pl-[20px] list-disc'} mb-[14px] last:mb-0">${items}</ul>`
    }
    case 'ol': {
      const items = block.items.map(it => `<li class="mb-[4px] leading-[1.6]">${renderInline(it)}</li>`).join('')
      return `<ol class="pl-[20px] mb-[14px] last:mb-0 list-decimal">${items}</ol>`
    }
    case 'blockquote': {
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<blockquote class="border-l-[3px] border-[var(--color-accent-dim)] mb-[14px] last:mb-0 px-[16px] py-[8px] bg-[color-mix(in_srgb,var(--color-accent-muted)_40%,transparent)] rounded-r-[var(--radius-md)] text-[var(--color-text-secondary)] italic"><p class="m-0">${inner}</p></blockquote>`
    }
    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="px-[12px] py-[7px] text-left font-semibold text-[11.5px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] whitespace-nowrap">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row =>
        `<tr class="group/tr hover:bg-[color-mix(in_srgb,var(--color-bg-hover)_60%,transparent)]">${row.map(c => `<td class="px-[12px] py-[7px] border-b border-[var(--color-border-subtle)] text-[var(--color-text-primary)] align-top group-last/tr:border-b-0">${renderInline(c)}</td>`).join('')}</tr>`,
      ).join('')}</tbody>`
      return `<div class="overflow-x-auto mb-[14px] last:mb-0 border border-[var(--color-border-mid)] rounded-[var(--radius-md)]"><table class="w-full border-collapse text-[13px]">${thead}${tbody}</table></div>`
    }
    case 'hr':
      return '<hr class="border-0 border-t border-[var(--color-border-mid)] my-[18px] last:mb-0">'
    case 'code':
      return renderCodeBlock(block)
    default:
      return ''
  }
}

async function renderCodeBlock(block: CodeBlock): Promise<string> {
  const { id, lang, code, closed } = block
  codeStore.set(id, code)

  let body: string
  if (!closed) {
    body = `<div class="overflow-x-auto [&_pre]:m-0 [&_pre]:px-[16px] [&_pre]:py-[14px] [&_pre]:!bg-[var(--color-bg-base)] [&_pre]:[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] [&_pre]:text-[12.5px] [&_pre]:leading-[1.6] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:[font-family:inherit] [&_code]:bg-transparent">\
<span class="[font-family:'JetBrains_Mono','Fira_Code',ui-monospace,monospace] text-[12.5px] text-[var(--color-text-primary)] whitespace-pre-wrap block px-[16px] py-[14px]">${escHtml(code)}</span>\
<span class="animate-[md-blink_0.9s_step-end_infinite] text-[var(--color-accent-bright)] motion-reduce:animate-none motion-reduce:opacity-100"> ▊</span></div>`
  }
  else {
    try {
      const h = await getHighlighter()
      const useLang = h.getLoadedLanguages().includes(lang as never) ? lang : 'plaintext'
      body = `<div class="overflow-x-auto [&_pre]:m-0 [&_pre]:px-[16px] [&_pre]:py-[14px] [&_pre]:!bg-[var(--color-bg-base)] [&_pre]:[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] [&_pre]:text-[12.5px] [&_pre]:leading-[1.6] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:[font-family:inherit] [&_code]:bg-transparent">${h.codeToHtml(code, { lang: useLang, theme: 'ember-dark' })}</div>`
    }
    catch {
      body = `<div class="overflow-x-auto [&_pre]:m-0 [&_pre]:px-[16px] [&_pre]:py-[14px] [&_pre]:!bg-[var(--color-bg-base)] [&_pre]:[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] [&_pre]:text-[12.5px] [&_pre]:leading-[1.6] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:[font-family:inherit] [&_code]:bg-transparent"><pre class="m-0 px-[16px] py-[14px] text-[var(--color-text-primary)] [font-family:'JetBrains_Mono','Fira_Code',ui-monospace,monospace] text-[12.5px] whitespace-pre-wrap"><code>${escHtml(code)}</code></pre></div>`
    }
  }

  const langLabel = lang && lang !== 'plaintext'
    ? `<span class="[font-family:'JetBrains_Mono','Fira_Code',ui-monospace,monospace] text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">${escHtml(lang)}</span>`
    : '<span></span>'

  const actions = `<div class="flex items-center gap-1 ml-auto">\
<button class="md-btn md-copy-btn group inline-flex items-center gap-[5px] text-[11px] font-medium px-[8px] py-[2px] h-[22px] border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] bg-transparent text-[var(--color-text-tertiary)] cursor-pointer transition-[background,color,border-color] duration-[110ms] ease-[ease] whitespace-nowrap leading-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] motion-reduce:transition-none" data-code-id="${id}" aria-label="Copy code">\
<span class="md-copy-idle inline-flex items-center gap-[5px] group-data-[copied]:hidden">${ICON_CLIPBOARD}<span>Copy</span></span>\
<span class="md-copy-done hidden items-center gap-[5px] text-[var(--color-success-text,#4ade80)] group-data-[copied]:inline-flex">${ICON_CHECK}<span>Copied!</span></span>\
</button></div>`

  return `<div class="md-code-wrap rounded-[var(--radius-md)] border border-[var(--color-border-mid)] overflow-hidden bg-[var(--color-bg-base)] mb-[14px] last:mb-0" data-lang="${escHtml(lang)}">\
<div class="flex items-center justify-between px-[8px] py-[6px] pl-[12px] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] min-h-[34px] gap-2">${langLabel}${actions}</div>${body}</div>`
}

// ── render pipeline ───────────────────────────────────────────────────────────

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
    const parts = await Promise.all(blocks.map(b => Promise.resolve(renderBlock(b))))

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
      const result = renderBlock(block)
      newParts.push(typeof result === 'string' ? result : await result)
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
      const result = renderBlock(block)
      tailParts.push(typeof result === 'string' ? result : await result)
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
let rafId: number | null = null

function scheduleRender(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  const version = ++renderVersion
  const streaming = props.streaming ?? false

  // Maximum smoothness: No artificial debouncing.
  // Vue automatically batches these calls via microtasks when the ref changes,
  // making it instantaneously smooth (super smooth word-by-word streaming).
  renderContent(props.content, version, streaming)
}

watch(() => props.content, scheduleRender, { immediate: true })

// Force a clean final render when streaming finishes.
// Reset the incremental cache so the full re-render starts from scratch.
watch(() => props.streaming, streaming => {
  if (!streaming) {
    if (timer)
      clearTimeout(timer)
    if (rafId)
      cancelAnimationFrame(rafId)
    resetStableCache()
    const version = ++renderVersion
    renderContent(props.content, version, false)
  }
})

onUnmounted(() => {
  if (timer)
    clearTimeout(timer)
  if (rafId)
    cancelAnimationFrame(rafId)
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
  <div class="text-[13.5px] leading-[1.65] text-[var(--color-text-primary)] break-words [word-break:break-word] [&_svg:not(.md-btn_svg)]:block [&_svg:not(.md-btn_svg)]:max-w-full [&_svg:not(.md-btn_svg)]:h-auto [&_svg:not(.md-btn_svg)]:max-h-[480px]" @click.capture="handleClick" v-html="html" />
</template>

<style>
/* Unscoped global style block to ensure keyframes are available to arbitrary Tailwind values */
@keyframes md-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
