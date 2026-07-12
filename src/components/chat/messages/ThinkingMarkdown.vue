<script setup lang="ts">
/**
 * ThinkingMarkdown.vue
 *
 * A dedicated markdown renderer for AI *reasoning* / "thinking" content.
 *
 * Why a separate component?
 *   `MarkdownMessage` is tuned for the final response: full Shiki highlighting,
 *   copy buttons, primary text color, 12.5px code, and `border-collapse` tables.
 *   None of those are right inside a Thinking block:
 *     • The reasoning text should look *visibly different* from the answer —
 *       a dimmer gray (`--color-text-tertiary`) signals "scratchpad".
 *     • Code blocks inside reasoning should match the surrounding "Thinking"
 *       label size (13px / 1em), not 12.5px.
 *     • The parent's `white-space: pre-wrap` was breaking table layout.
 *     • Shiki is heavy for content that's typically short-lived and may
 *       never even be expanded.
 *
 * This renderer is intentionally lean:
 *   • Synchronous render — no async, no Shiki, no version counter.
 *   • Streaming-friendly: open code fences render as plain `<pre>` with a
 *     blinking cursor; final re-render replaces everything cleanly.
 *   • All text is gray by default. Strong/em/headings get a small contrast
 *     bump so the hierarchy still reads.
 */

import { onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  content: string
  /** True while the parent is actively streaming this content. */
  streaming?: boolean
}>()

// ── rendered output ───────────────────────────────────────────────────────────

const html = ref('')

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
    if (i % 2 === 1) {
      return `<code class="[font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] text-[0.92em] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] px-[5px] py-[1px] rounded-[var(--radius-sm)] border border-[var(--color-border-mid)] whitespace-pre">${escHtml(part.slice(1, -1))}</code>`
    }

    let t = escHtml(part)

    // bold + italic (must be tested before bold or italic individually)
    t = t.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong class="font-semibold text-[var(--color-text-secondary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')
    t = t.replace(/___(.+?)___/gs, '<strong class="font-semibold text-[var(--color-text-secondary)]"><em class="italic text-[var(--color-text-secondary)]">$1</em></strong>')
    // bold
    t = t.replace(/\*\*(.+?)\*\*/gs, '<strong class="font-semibold text-[var(--color-text-secondary)]">$1</strong>')
    t = t.replace(/__(.+?)__/gs, '<strong class="font-semibold text-[var(--color-text-secondary)]">$1</strong>')
    // italic (* and _)
    t = t.replace(/\*([^\s*][^*]*)\*/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
    t = t.replace(/_([^\s_][^_]*)_/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
    // strikethrough
    t = t.replace(/~~(.+?)~~/g, '<del class="line-through text-[var(--color-text-dim)]">$1</del>')

    return t
  }).join('')
}

// ── block types ───────────────────────────────────────────────────────────────

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

    // ── ATX heading ───────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1]!.length, text: hm[2]! })
      i++
      continue
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

    // ── unordered list (with GFM task-item support) ──────────────────────────
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
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

    // ── ordered list ──────────────────────────────────────────────────────────
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
        blocks.push({
          type: 'table',
          header: parseRow(tLines[0]!),
          rows: tLines.slice(2).map(parseRow),
        })
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
      paraLines.push(l)
      i++
    }
    if (paraLines.length > 0)
      blocks.push({ type: 'paragraph', lines: paraLines })
  }

  return blocks
}

// ── block → HTML ──────────────────────────────────────────────────────────────

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`
      const size = block.level === 1 ? 'text-[1.3em]' : block.level === 2 ? 'text-[1.15em]' : block.level === 3 ? 'text-[1.05em]' : 'text-[1em]'
      return `<${tag} class="${size} font-semibold leading-[1.3] text-[var(--color-text-secondary)] mt-[14px] mb-[6px] first:mt-0 last:mb-0">${renderInline(block.text)}</${tag}>`
    }
    case 'paragraph':
      return `<p class="mb-[10px] last:mb-0">${block.lines.map(l => renderInline(l)).join('<br>')}</p>`
    case 'ul': {
      const isTaskList = block.items.some(it => /^\[[ x]\]/i.test(it))
      const items = block.items.map(it => {
        const task = it.match(/^\[([ x])\]\s+(\S.*)$/i)
        if (task) {
          const checked = task[1]!.toLowerCase() === 'x'
          return `<li class="mb-[4px] leading-[1.55]"><label class="flex items-baseline gap-2 cursor-default select-none"><input type="checkbox" class="shrink-0 w-[12px] h-[12px] m-0 accent-[var(--color-accent-bright)] cursor-default translate-y-[1px]" ${checked ? 'checked' : ''} disabled><span>${renderInline(task[2]!)}</span></label></li>`
        }
        return `<li class="mb-[3px] leading-[1.55]">${renderInline(it)}</li>`
      }).join('')
      return `<ul class="${isTaskList ? 'pl-[4px] list-none' : 'pl-[20px] list-disc'} mb-[10px] last:mb-0">${items}</ul>`
    }
    case 'ol': {
      const items = block.items.map(it => `<li class="mb-[3px] leading-[1.55]">${renderInline(it)}</li>`).join('')
      return `<ol class="pl-[20px] mb-[10px] last:mb-0 list-decimal">${items}</ol>`
    }
    case 'blockquote': {
      const inner = block.lines.map(l => renderInline(l)).join('<br>')
      return `<blockquote class="border-l-2 border-[var(--color-border-mid)] mb-[10px] last:mb-0 px-[12px] py-[4px] text-[var(--color-text-dim)] italic bg-[color-mix(in_srgb,var(--color-bg-elevated)_50%,transparent)] rounded-r-[var(--radius-sm)]"><p class="m-0">${inner}</p></blockquote>`
    }
    case 'table': {
      const thead = `<thead><tr>${block.header.map(h => `<th class="px-[10px] py-[6px] text-left font-semibold text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-dim)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] whitespace-normal">${renderInline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${block.rows.map(row =>
        `<tr class="group/tr">${row.map(c => `<td class="px-[10px] py-[6px] border-b border-[var(--color-border-subtle)] group-last/tr:border-b-0 text-[var(--color-text-tertiary)] align-top whitespace-normal break-words [overflow-wrap:anywhere]">${renderInline(c)}</td>`).join('')}</tr>`,
      ).join('')}</tbody>`
      return `<div class="overflow-x-auto mb-[10px] last:mb-0 border border-[var(--color-border-mid)] rounded-[var(--radius-sm)] bg-[var(--color-bg-base)]"><table class="w-full border-collapse table-auto text-[12.5px] text-[var(--color-text-tertiary)]">${thead}${tbody}</table></div>`
    }
    case 'hr':
      return '<hr class="border-0 border-t border-[var(--color-border-mid)] my-[14px] last:mb-0">'
    case 'code': {
      const { lang, code, closed } = block
      const body = closed
        ? `<pre class="m-0 px-[12px] py-[10px] [font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] text-[1em] leading-[1.55] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent"><code class="[font-family:inherit] bg-transparent text-[inherit] whitespace-inherit p-0 border-none">${escHtml(code)}</code></pre>`
        : `<pre class="m-0 px-[12px] py-[10px] [font-family:'JetBrains_Mono','Fira_Code','Cascadia_Code',ui-monospace,monospace] text-[1em] leading-[1.55] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent"><code class="[font-family:inherit] bg-transparent text-[inherit] whitespace-inherit p-0 border-none">${escHtml(code)}</code><span class="animate-[tm-blink_0.9s_step-end_infinite] text-[var(--color-accent-bright)] motion-reduce:animate-none motion-reduce:opacity-100"> ▊</span></pre>`

      const langLabel = lang
        ? `<span class="[font-family:'JetBrains_Mono','Fira_Code',ui-monospace,monospace] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-dim)]">${escHtml(lang)}</span>`
        : '<span></span>'

      return `<div class="rounded-[var(--radius-sm)] border border-[var(--color-border-mid)] overflow-hidden bg-[var(--color-bg-base)] mb-[10px] last:mb-0">${langLabel ? `<div class="flex items-center justify-between px-[10px] py-[4px] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] min-h-[26px]">${langLabel}</div>` : ''}${body}</div>`
    }
    default:
      return ''
  }
}

// ── full render (synchronous — no Shiki, no async) ─────────────────────────────

function renderAll(content: string): string {
  if (!content)
    return ''
  const blocks = tokenise(content)
  return blocks.map(renderBlock).join('\n')
}

// ── watchers ──────────────────────────────────────────────────────────────────

function scheduleRender(): void {
  html.value = renderAll(props.content)
}

watch(() => props.content, scheduleRender, { immediate: true })

// When streaming ends, re-render from scratch to clean up any
// partial-block artefacts (e.g. an unclosed fence that closed).
watch(() => props.streaming, streaming => {
  if (!streaming)
    scheduleRender()
})

onUnmounted(() => {
  html.value = ''
})
</script>

<template>
  <!--
    v-html is intentional and safe here:
    • Content is produced by the AI model, not by arbitrary user HTML.
    • All text that originates from block parsing is passed through escHtml().
  -->
  <div class="text-[13px] leading-[1.6] text-[var(--color-text-tertiary)] whitespace-normal break-words [word-break:break-word] [&_svg]:block [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:max-h-[480px]" v-html="html" />
</template>

<style>
/* Unscoped global style block to ensure keyframes are available to arbitrary Tailwind values */
@keyframes tm-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
