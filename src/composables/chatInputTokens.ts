import { CHIP_PADDING, TOKEN_RE } from '@/utils/mentionFormat'

/**
 * Internal storage format (what lives in `draft.text`):
 *   - Mention : ZWSP + "<path>" + ZWSP        e.g. "\u200BAGENTS.md\u200B"
 *   - Skill   : ZWNJ + "<id>" + ZWNJ          e.g. "\u200Cweb-search\u200C"
 *
 * The zero-width spaces (U+200B / U+200C) have *zero rendered width* but still occupy
 * character positions, so the textarea's underlying text width matches the
 * chip's display width exactly — no ghost spacing. They're also the boundary
 * markers used to detect tokens atomically (caret snap, atomic delete, etc.).
 *
 * On submit, ChatInput.vue serialises this back to the public format used by
 * the rest of the app (DB, mentions parser, sendMessage, UserMessage renderer)
 * via `serializeForSend` from `@/utils/mentionFormat`:
 *   - "@[<path>]"     — for mentions
 *   - "[skill:<id>]"  — for skills
 * Downstream consumers don't need to know about the zero-width markers.
 *
 * Everything below operates purely on strings/offsets — no component state —
 * so it lives here rather than in ChatInput.vue itself.
 */

/** A parsed mention/skill token found inside the raw draft text. */
export interface SpecialToken {
  start: number
  end: number
  outerStart: number
  outerEnd: number
  type: 'mention' | 'skill'
  value: string
}

/** A rendered chunk for the backdrop syntax highlighter: plain text or a chip. */
export interface MsgPart {
  type: 'text' | 'mention' | 'skill'
  /** What the chip should render (just the filename / skill id — no `@`, no `[]`). */
  display: string
  value?: string
  /** True for folder mentions — lets the chip pick the right icon. */
  isDir?: boolean | undefined
}

/** Find every mention / skill token in the text, sorted by start position. */
export function findAllTokens(value: string): SpecialToken[] {
  if (!value)
    return []
  const out: SpecialToken[] = []
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null = re.exec(value)
  while (m !== null) {
    const isSkill = m[1] !== undefined

    let outerStart = m.index
    let spacesLeft = 0
    while (outerStart > 0 && value[outerStart - 1] === ' ' && spacesLeft < CHIP_PADDING.length) {
      outerStart--
      spacesLeft++
    }

    let outerEnd = m.index + m[0].length
    let spacesRight = 0
    while (outerEnd < value.length && value[outerEnd] === ' ' && spacesRight < CHIP_PADDING.length) {
      outerEnd++
      spacesRight++
    }

    out.push({
      start: m.index,
      end: m.index + m[0].length,
      outerStart,
      outerEnd,
      type: isSkill ? 'skill' : 'mention',
      value: isSkill ? m[1]! : m[2]!,
    })
    m = re.exec(value)
  }
  return out
}

/**
 * Token whose zone (including padding spaces) contains the given cursor.
 * Covers: outerStart..start (left padding), start..end (chip body), end..outerEnd (right padding).
 */
export function findTokenContaining(value: string, cursor: number): SpecialToken | null {
  const tokens = findAllTokens(value)
  for (const tok of tokens) {
    if (cursor > tok.outerStart && cursor < tok.outerEnd)
      return tok
  }
  return null
}

/**
 * Snap a cursor position that falls anywhere inside a chip's zone (body + padding)
 * to the nearest outer boundary (outerStart or outerEnd).
 * Left-padding zone → snap to outerStart (before the spaces).
 * Right-padding zone or chip body → snap to outerEnd (after the spaces).
 */
export function snapToTokenBoundary(value: string, pos: number): number {
  const tok = findTokenContaining(value, pos)
  if (!tok)
    return pos
  // If cursor is in the left-padding zone, snap to before the spaces
  if (pos <= tok.start)
    return tok.outerStart
  // Otherwise (chip body or right padding), snap to after the trailing spaces
  return tok.outerEnd
}

/** Token whose padded boundary ends at or just before `cursor` — used for Backspace. */
export function findTokenBefore(value: string, cursor: number): SpecialToken | null {
  const tokens = findAllTokens(value)
  for (const tok of tokens) {
    // If the cursor is anywhere within the trailing spaces (or right at the token boundary)
    if (cursor > tok.end && cursor <= tok.outerEnd)
      return tok
    // Edge case: if there are no spaces at all, but the cursor is exactly at tok.end
    if (cursor === tok.end && tok.outerEnd === tok.end)
      return tok
  }
  return null
}

/** Token whose padded boundary starts exactly at `cursor` — used for Delete. */
export function findTokenAfter(value: string, cursor: number): SpecialToken | null {
  const tokens = findAllTokens(value)
  for (const tok of tokens) {
    // If the cursor is anywhere within the preceding spaces (or right at the token boundary)
    if (cursor >= tok.outerStart && cursor < tok.start)
      return tok
    // Edge case: if there are no spaces, cursor is exactly at tok.start
    if (cursor === tok.start && tok.outerStart === tok.start)
      return tok
  }
  return null
}

/** Split text into rendered parts (text + chip) for the backdrop highlighter. */
export function splitMentions(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  if (!text)
    return parts
  const re = new RegExp(TOKEN_RE.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null = re.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', display: text.slice(lastIndex, match.index) })
    }
    const isSkill = match[1] !== undefined
    const inner = isSkill ? match[1]! : match[2]!
    parts.push({
      type: isSkill ? 'skill' : 'mention',
      display: inner,
      value: inner,
      isDir: !isSkill ? inner.endsWith('/') : undefined,
    })
    lastIndex = match.index + match[0].length
    match = re.exec(text)
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', display: text.slice(lastIndex) })
  }
  return parts
}
