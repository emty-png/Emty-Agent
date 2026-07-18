/**
 * Voice post-processing pipeline.
 * Filters raw STT output to improve quality — filler removal, punctuation,
 * backtrack correction, dictionary replacement, and snippet expansion.
 */

// ── Filler word removal ─────────────────────────────────────────────────────

/** Filler words/phrases to strip (order matters — longest first). */
const FILLER_PATTERNS = [
  /\buh\s+uh\b/gi,
  /\bum\s+um\b/gi,
  /\byou know what I mean\b/gi,
  /\byou know what I\b/gi,
  /\bhow should I put it\b/gi,
  /\bkind of like\b/gi,
  /\bkind of\b/gi,
  /\bas it were\b/gi,
  /\bfor what it's worth\b/gi,
  /\bI mean\b/gi,
  /\byou know\b/gi,
  /\blike I said\b/gi,
  /\bso to speak\b/gi,
  /\bif you will\b/gi,
  /\byou see\b/gi,
  /\bbasically\b/gi,
  /\bhonestly\b/gi,
  /\bliterally\b/gi,
  /\banyway\b/gi,
  /\bright\b/gi,
  /(?:^|(?<=\s))so(?=\s*[.,!?]|$)/gi,
  /\buh\b/gi,
  /\bum\b/gi,
  /\ber\b/gi,
  /\beh\b/gi,
  /\bhm\b/gi,
  /\bmm\b/gi,
]

/** Stutter pattern: repeated word like "I I I want" or "the the the" */
const STUTTER_PATTERN = /\b(\w{1,6})\s+\1\s+\1+\b/g

/** Single false-start pattern: "I want I need" → keeps second */
const FALSE_START_PATTERN = /\b(I want|I need|I think|I'm going|let's|we should|you should|it is|there is|I can|we can|it's|that's|this is)\s+(I want|I need|I think|I'm going|let's|we should|you should|it is|there is|I can|we can|it's|that's|this is)\b/gi

export function removeFillers(text: string): string {
  let result = text

  // Fix stutters: "I I I want" → "I want"
  result = result.replace(STUTTER_PATTERN, '$1')

  // Fix false starts: "I want I need" → "I need"
  result = result.replace(FALSE_START_PATTERN, '$2')

  // Remove filler words
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, '')
  }

  // Collapse multiple spaces
  result = result.replace(/\s{2,}/g, ' ')

  // Trim leading/trailing whitespace
  return result.trim()
}

// ── Auto punctuation ────────────────────────────────────────────────────────

const QUESTION_TRIGGERS = /\b(?:who|what|where|when|why|how|which|whose|whom|is|are|was|were|do|does|did|can|could|would|should|will|shall|have|has|had|may|might|must)\b/i

export function autoPunctuate(text: string): string {
  // If already has sentence-ending punctuation, skip
  if (/[.!?]\s*$/.test(text.trim()))
    return text

  const trimmed = text.trim()

  // Check if it's a question (starts with a question word or auxiliary)
  const words = trimmed.split(/\s+/)
  const firstWord = words[0]?.toLowerCase()
  if (firstWord && QUESTION_TRIGGERS.test(firstWord)) {
    // Heuristic: if the sentence structure looks like a question
    const isQuestionByStructure = words.length > 2
      && /\b(?:who|what|where|when|why|how|which)\b/i.test(firstWord)
    if (isQuestionByStructure)
      return `${trimmed}?`
  }

  // Default: add a period
  return `${trimmed}.`
}

// ── Backtrack correction ────────────────────────────────────────────────────

const BACKTRACK_PATTERNS = [
  /\b(\w+)\s+actually\s+([\s\S]{1,40})/gi,
  /\b(\w+)\s+no[\s,]+([\s\S]{1,40})/gi,
  /\b(\w+)\s+sorry[\s,]+([\s\S]{1,40})/gi,
  /\b(\w+)\s+wait[\s,]+([\s\S]{1,40})/gi,
  /\b(\w+)\s+I mean[\s,]+([\s\S]{1,40})/gi,
]

export function correctBacktracks(text: string): string {
  let result = text

  for (const pattern of BACKTRACK_PATTERNS) {
    result = result.replace(pattern, (_, _discarded: string, correction: string) => {
      return correction.trim()
    })
  }

  return result.trim()
}

// ── Config types ────────────────────────────────────────────────────────────

export interface VoiceProcessingConfig {
  removeFillers: boolean
  autoPunctuate: boolean
  correctBacktracks: boolean
}

export const DEFAULT_VOICE_PROCESSING: VoiceProcessingConfig = {
  removeFillers: true,
  autoPunctuate: true,
  correctBacktracks: true,
}

export type DictationContext = 'chat' | 'command' | 'code'

// ── Dictionary replacement ────────────────────────────────────────────────

export interface VoiceDictionaryEntry {
  wrong: string
  correct: string
}

export interface VoiceSnippet {
  trigger: string
  expansion: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyDictionary(text: string, dictionary: VoiceDictionaryEntry[]): string {
  if (dictionary.length === 0)
    return text
  let result = text
  for (const entry of dictionary) {
    if (!entry.wrong.trim())
      continue
    const pattern = new RegExp(`\\b${escapeRegex(entry.wrong)}\\b`, 'gi')
    result = result.replace(pattern, entry.correct)
  }
  return result
}

export function expandSnippets(text: string, snippets: VoiceSnippet[]): string {
  if (snippets.length === 0)
    return text
  let result = text
  for (const snippet of snippets) {
    if (!snippet.trigger.trim())
      continue
    const pattern = new RegExp(`\\b${escapeRegex(snippet.trigger)}\\b`, 'gi')
    result = result.replace(pattern, snippet.expansion)
  }
  return result
}

// ── Pipeline orchestration ──────────────────────────────────────────────────

export function processTranscript(
  text: string,
  config: VoiceProcessingConfig = DEFAULT_VOICE_PROCESSING,
  context: DictationContext = 'chat',
  dictionary: VoiceDictionaryEntry[] = [],
  snippets: VoiceSnippet[] = [],
): string {
  let result = text

  // 1. Dictionary replacement (before post-processing so fillers don't interfere)
  result = applyDictionary(result, dictionary)

  // 2. Backtrack correction
  if (config.correctBacktracks)
    result = correctBacktracks(result)

  // 3. Filler removal
  if (config.removeFillers)
    result = removeFillers(result)

  // 4. Snippet expansion
  result = expandSnippets(result, snippets)

  // 5. Auto-punctuation (skip in code or command contexts)
  if (config.autoPunctuate && context === 'chat')
    result = autoPunctuate(result)

  return result
}
