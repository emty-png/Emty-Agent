/**
 * src/utils/mentionFormat.ts
 *
 * Shared internal storage format for file mentions and skill chips in the
 * chat input draft.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why ZWSP-wrapped?
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The chat input uses a backdrop-overlay-on-textarea rendering trick: the
 * textarea holds the real (invisible) text, and a sibling div with identical
 * metrics paints the visible representation, swapping `@[file]` and
 * `[skill:id]` tokens for chip spans.
 *
 * The old format kept the bracket characters in the textarea's text. That
 * meant the underlying text was wider than the chip's displayed text (because
 * the brackets are real, visible-width characters). Even with negative-margin
 * hacks, the two widths could never line up perfectly, leaving a faint
 * "ghost" of whitespace behind every chip and making atomic delete / caret
 * containment awkward.
 *
 * Wrapping the inner content with U+200B (zero-width space) keeps the markers
 * invisible while still occupying character positions. So:
 *   - visible width of underlying text === visible width of chip display
 *   - no negative-margin compensation needed
 *   - atomic token behaviour becomes trivial (markers are real char indices)
 *
 * This format is the *internal* one — used only inside the live draft text
 * while the user is composing. On `submit()` we serialise back to the public
 * `@[<path>]` / `[skill:<id>]` format that the rest of the app (DB, mention
 * parser, sendMessage, message renderer) already understands.
 */

/** Zero-width space — invisible character used for mentions. */
export const ZWSP = '\u200B'

/** Zero-width non-joiner — invisible character used for skills. */
export const ZWNJ = '\u200C'

/**
 * Physical padding inserted around chips (e.g. 3 spaces).
 * The token parser treats this padding as part of the chip's atomic boundary.
 */
export const CHIP_PADDING = '   '

/** Internal regex matching both mention and skill tokens. Skill comes first. */
export const TOKEN_RE
  = /\u200C([^\u200C]+)\u200C|\u200B([\w./\-]+)\u200B/g

/** Wrap a file path in ZWSP markers → `\u200B<path>\u200B`. */
export function packMention(path: string): string {
  return `${ZWSP}${path}${ZWSP}`
}

/** Wrap a skill id in ZWNJ markers → `\u200C<id>\u200C`. */
export function packSkill(id: string): string {
  return `${ZWNJ}${id}${ZWNJ}`
}

/**
 * Convert a draft string from internal zero-width format to the public
 * `@[<path>]` / `[skill:<id>]` format used by the rest of the app.
 *
 * Idempotent on already-public text.
 */
export function serializeForSend(value: string): string {
  return value
    .replace(/\u200B([\w./\-]+)\u200B/g, '@[$1]')
    .replace(/\u200C([^\u200C]+)\u200C/g, '[skill:$1]')
}
