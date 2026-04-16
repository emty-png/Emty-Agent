// ── models.dev integration ─────────────────────────────────────────────────────
// Docs: https://github.com/anomalyco/models.dev
// API:  https://models.dev/api.json
// Icons: https://models.dev/logos/{providerId}.svg  (fallback served if unknown)

// ── types ─────────────────────────────────────────────────────────────────────

export interface MDevModel {
  name: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  structured_output?: boolean
  temperature?: boolean
  input?: string[] // e.g. ['text', 'image', 'audio', 'video', 'pdf']
  output?: string[] // e.g. ['text']
  knowledge?: string // e.g. '2024-04'
  release_date?: string
  last_updated?: string
  interleaved?: boolean | { field: string }
}

export interface MDevProvider {
  name: string
  npm?: string
  api?: string
  env?: string[]
  doc?: string
  models: Record<string, MDevModel>
}

export type MDevData = Record<string, MDevProvider>

// ── models.dev provider ID map ─────────────────────────────────────────────────
// Maps our preset names → the exact folder name in models.dev's providers/ dir.
// Icon URL: https://models.dev/logos/{mdevId}.svg
// If a provider isn't in models.dev, the CDN returns a generic fallback icon.

export const PRESET_MDEV_IDS: Record<string, string> = {
  Ollama: 'ollama',
  'LM Studio': 'lmstudio',
  Groq: 'groq',
  Mistral: 'mistral',
  'Together AI': 'togetherai',
  Deepseek: 'deepseek',
  Perplexity: 'perplexity',
  'Fireworks AI': 'fireworks',
  OpenRouter: 'openrouter',
  Cerebras: 'cerebras',
  'xAI Grok': 'xai',
  'Novita AI': 'novita',
  Anyscale: 'anyscale',
}

// Core provider IDs used by the three first-party providers
export const CORE_MDEV_IDS: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
}

// ── icon helper ───────────────────────────────────────────────────────────────

/**
 * Returns the models.dev CDN icon URL for a given provider.
 * Falls back to a default icon if the provider is unknown.
 *
 * @param mdevId  The models.dev provider id (e.g. 'groq', 'openai')
 */
export function providerIconUrl(mdevId: string): string {
  return `https://models.dev/logos/${mdevId}.svg`
}

// ── singleton cache ───────────────────────────────────────────────────────────

let _cache: MDevData | null = null
let _promise: Promise<MDevData> | null = null

/**
 * Fetches https://models.dev/api.json once and caches it for the session.
 * Returns an empty object on failure — callers must handle gracefully.
 */
export async function getModelsDevData(): Promise<MDevData> {
  if (_cache)
    return _cache
  if (_promise)
    return _promise

  _promise = fetch('https://models.dev/api.json', {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  })
    .then(r => {
      if (!r.ok)
        throw new Error(`models.dev HTTP ${r.status}`)
      return r.json() as Promise<MDevData>
    })
    .then(data => {
      _cache = data
      return data
    })
    .catch(() => {
      _promise = null // allow retry next call
      return {} as MDevData
    })

  return _promise
}

/** Force a re-fetch (e.g. on settings refresh) */
export function clearModelsDevCache(): void {
  _cache = null
  _promise = null
}

// ── model lookup ──────────────────────────────────────────────────────────────

export function lookupModel(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): MDevModel | null {
  return data[mdevId]?.models?.[rawModelId] ?? null
}

// ── chat-model filter ─────────────────────────────────────────────────────────
//
// Strategy (in order of precedence):
//   1. Found in models.dev → check output includes 'text'
//   2. Not found           → heuristic blocklist

const NON_CHAT_RE = /embed(?:ding)?|dall-?e|tts|text-to-speech|speech-to-text|whisper|transcri|omni-moderation|moderation|^babbage|^davinci|^curie|^ada-0|imagen|^veo|^lyria|^chirp|^aqa|^rerank|realtime/i

/**
 * Returns true if the model should be presented as a selectable chat model.
 */
export function isChatModel(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta) {
    // Explicit output list: must include 'text'
    if (meta.output && meta.output.length > 0)
      return meta.output.includes('text')
    // No output field → models.dev considers it a text model by default
    return true
  }

  // Not in models.dev — fall back to heuristics
  return !NON_CHAT_RE.test(rawModelId)
}

// ── reasoning / thinking support ──────────────────────────────────────────────

/**
 * Ollama thinking model patterns.
 * Source: https://ollama.com/search?c=thinking
 * These are models that accept `think: true` in the Ollama API.
 */
const OLLAMA_THINKING_RE = /qwq|qwen3|deepseek-r1|deepseek-v3\.1|gpt-oss|marco-o|skywork-o|r1-|r1:|s1-|open-r1|-think\b/i

/**
 * Generic heuristic for unknown providers — catches common community naming
 * conventions for reasoning/thinking models.
 */
const GENERIC_THINKING_RE = /\br1\b|reasoner|thinking|qwq|qwen3|marco-o|skywork-o|-think\b|r1-|open-r1/i

/**
 * Returns true if the model supports extended thinking / reasoning chains.
 * Uses models.dev `reasoning` field; falls back to ID-pattern heuristics.
 */
export function supportsReasoning(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.reasoning !== undefined)
    return Boolean(meta.reasoning)

  // Heuristic fallback when not in models.dev
  const id = rawModelId.toLowerCase()
  switch (mdevId) {
    case 'openai':
      return /^o[1-9]/.test(id) || id.startsWith('o3') || id.startsWith('o4')
    case 'anthropic':
      return id.includes('3-7') || id.includes('opus-4') || id.includes('sonnet-4') || id.includes('haiku-4')
    case 'google':
      return id.includes('2.5') || id.includes('gemini-3')
    case 'deepseek':
      return id.includes('reasoner') || id.includes('r1')
    case 'groq':
      return id.includes('deepseek-r1')

      // ── local providers: use Ollama-aware pattern ──────────────────────
    case 'ollama':
    case 'lmstudio':
      // Strip tag suffix (e.g. "qwen3:8b" → "qwen3") before matching
      return OLLAMA_THINKING_RE.test(id.split(':')[0]!) || OLLAMA_THINKING_RE.test(id)

    default:
      return GENERIC_THINKING_RE.test(id)
  }
}

// ── display name ──────────────────────────────────────────────────────────────

/**
 * Returns the best display name for a model:
 * models.dev `name` → formatted raw ID.
 */
export function modelDisplayName(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string {
  const meta = lookupModel(data, mdevId, rawModelId)
  if (meta?.name)
    return meta.name

  // Format the raw ID into a readable name
  return rawModelId
    .replace(/^models\//, '') // Google prefix
    .replace(/-(\d{8})$/, '') // Strip date stamps like -20250514
    .replace(/[-_]/g, ' ')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bai\b/gi, 'AI')
    .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase())
    .trim()
}
