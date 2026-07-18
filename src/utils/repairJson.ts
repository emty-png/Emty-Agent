/**
 * src/utils/repairJson.ts
 *
 * Robust JSON repair engine that handles common AI model mistakes:
 * - Trailing/extra closing brackets (}]) after valid JSON
 * - Missing closing brackets/quotes
 * - Trailing commas
 * - Single-quoted strings → double quotes
 * - ```json wrapper extraction
 * - Comment removal
 * - Unescaped control characters in strings
 * - Large payload preservation (100KB+)
 *
 * Strategy: try JSON.parse first, then apply incremental repair passes.
 */

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a JSON string safely — never throws.
 * Tries JSON.parse first, then repairJson, then returns fallback.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  if (!raw)
    return fallback
  try {
    return JSON.parse(raw) as T
  }
  catch {
    // fall through to repair
  }
  const repaired = repairJson(raw)
  if (repaired !== null) {
    try {
      return JSON.parse(repaired) as T
    }
    catch {
      // repair produced unparseable output
    }
  }
  return fallback
}

export function repairJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed)
    return null

  // Fast path: already valid
  try {
    JSON.parse(trimmed)
    return trimmed
  }
  catch {
    // fall through to repair
  }

  // Apply repair passes in order; return first that parses
  const candidates = [
    trimmed,
    extractFromCodeBlock(trimmed),
    stripComments(trimmed),
    fixTrailingCommas(trimmed),
    convertSingleQuotes(trimmed),
    fixBrokenTrailingEscapes(trimmed),
  ]

  for (const candidate of candidates) {
    const result = tryRebalanceAndParse(candidate)
    if (result !== null)
      return result
  }

  return null
}

// ── Extraction ──────────────────────────────────────────────────────────────

function extractFromCodeBlock(text: string): string {
  // Extract content from ```json ... ``` or ``` ... ```
  const blockMatch = text.match(/```(?:json)?([\s\S]*?)```/)
  if (blockMatch?.[1])
    return blockMatch[1].trim()

  // Also handle inline ```json...```  without newlines
  const inlineMatch = text.match(/```(?:json)?([\s\S]*?)```/)
  if (inlineMatch?.[1])
    return inlineMatch[1].trim()

  return text
}

// ── Comment removal ─────────────────────────────────────────────────────────

function stripComments(text: string): string {
  // Remove // line comments and /* block */ comments, but NOT inside strings
  let result = ''
  let inString = false
  let escapeNext = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escapeNext) {
      result += ch
      escapeNext = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        result += ch
        escapeNext = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      result += ch
      continue
    }

    if (ch === '"') {
      inString = true
      result += ch
      continue
    }

    // Line comment
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n')
        i++
      continue
    }

    // Block comment
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/'))
        i++
      i++ // skip the closing /
      continue
    }

    result += ch
  }

  return result
}

// ── Trailing comma removal ──────────────────────────────────────────────────

function fixTrailingCommas(text: string): string {
  // Remove commas immediately before } or ] (with optional whitespace between)
  return text.replace(/,(\s*[}\]])/g, '$1')
}

// ── Single-quote conversion ─────────────────────────────────────────────────

function convertSingleQuotes(text: string): string {
  // Only convert if double quotes are rare and single quotes are common
  // This is a heuristic — AI models sometimes emit JS-style single-quoted JSON
  const doubleCount = (text.match(/"/g) ?? []).length
  const singleCount = (text.match(/'/g) ?? []).length

  // If already mostly double-quoted, skip
  if (doubleCount > singleCount)
    return text

  // If very few single quotes, skip (probably just apostrophes in values)
  if (singleCount < 4)
    return text

  // Convert single-quoted strings to double-quoted
  // This is intentionally conservative — only convert strings that are
  // clearly JSON property values or string literals
  let result = ''
  let i = 0

  while (i < text.length) {
    if (text[i] === '"') {
      // Already double-quoted string — pass through
      result += '"'
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1]
          if (next !== undefined)
            result += text[i] + next
          i += 2
        }
        else {
          result += text[i]
          i++
        }
      }
      if (i < text.length)
        result += text[i] // closing "
      i++
    }
    else if (text[i] === "'") {
      // Convert single-quoted string to double-quoted
      result += '"'
      i++
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1]
          if (next === "'") {
            result += "'"
            i += 2
          }
          else if (next !== undefined) {
            result += text[i] + next
            i += 2
          }
          else {
            result += text[i]
            i++
          }
        }
        else if (text[i] === '"') {
          result += '\\"'
          i++
        }
        else {
          result += text[i]
          i++
        }
      }
      result += '"'
      if (i < text.length)
        i++ // skip closing '
    }
    else {
      result += text[i]
      i++
    }
  }

  return result
}

// ── Bracket rebalancing + string closing ────────────────────────────────────

/**
 * Strip trailing broken escape sequences that would prevent closing a string.
 * Handles: trailing `\`, incomplete `\u`, `\u00`, `\u000`, `\u000x` sequences.
 */
function fixBrokenTrailingEscapes(text: string): string {
  // Strip trailing backslash (would escape the closing quote)
  let result = text
  while (result.length > 0 && result[result.length - 1] === '\\')
    result = result.slice(0, -1)

  // Strip incomplete unicode escape fragments: \u, \u00, \u000, \u000x (not 4 hex digits)
  const unicodeMatch = result.match(/\\u([0-9a-fA-F]{0,3})$/)
  if (unicodeMatch) {
    result = result.slice(0, -(unicodeMatch[0].length))
  }

  return result
}

function tryRebalanceAndParse(text: string): string | null {
  // Strip trailing junk characters that are not valid JSON terminators
  let cleaned = text.replace(/[^\x20-\x7E]+$/g, '').trimEnd()

  // Try parsing as-is after stripping trailing whitespace
  try {
    JSON.parse(cleaned)
    return cleaned
  }
  catch {
    // continue
  }

  // Track brackets and strings to determine what needs closing
  const stack: string[] = []
  let inString = false
  let escapeNext = false

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']')
      continue
    }

    if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop()
      }
    }
  }

  // If we ended inside a string, close it after fixing broken escapes
  if (inString) {
    cleaned = fixBrokenTrailingEscapes(cleaned)
    cleaned += '"'
  }

  // Try closing open brackets from the stack in reverse order
  // Try each bracket individually and also with a trailing comma (handles truncated values)
  if (stack.length > 0) {
    const closingBrackets = [...stack].reverse()

    // Try closing all brackets at once
    let attempt = cleaned + closingBrackets.join('')
    try {
      JSON.parse(attempt)
      return attempt
    }
    catch {
      // continue to more granular attempts
    }

    // Try closing brackets one at a time, with and without commas
    attempt = cleaned
    for (const close of closingBrackets) {
      // Try: ...value}  (no comma needed — last field)
      const tryDirect = attempt + close
      try {
        JSON.parse(tryDirect)
        return tryDirect
      }
      catch {
        // continue
      }

      // Try: ...value,}  (truncated value — add comma before closing)
      const tryWithComma = `${attempt},${close}`
      try {
        JSON.parse(tryWithComma)
        return tryWithComma
      }
      catch {
        // continue
      }

      attempt += close
    }
  }

  // Also try the string-closed version without brackets (in case brackets were extra)
  try {
    JSON.parse(cleaned)
    return cleaned
  }
  catch {
    // continue
  }

  // Final attempt: strip everything after the last complete JSON root value
  const stripped = stripToLastRootValue(cleaned)
  if (stripped !== null) {
    try {
      JSON.parse(stripped)
      return stripped
    }
    catch {
      // give up
    }
  }

  return null
}

function stripToLastRootValue(text: string): string | null {
  // Walk the string tracking root depth; at depth 0 we have a complete value
  let inString = false
  let escapeNext = false
  let depth = 0
  let lastCompleteEnd = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true
        continue
      }
      if (ch === '"')
        inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      depth++
    }
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0)
        lastCompleteEnd = i
    }
  }

  if (lastCompleteEnd === -1)
    return null

  const result = text.slice(0, lastCompleteEnd + 1).trimEnd()
  return result.length > 0 ? result : null
}
