// ── models.dev integration ─────────────────────────────────────────────────────
// Docs: https://github.com/anomalyco/models.dev
// API:  https://models.dev/api.json
// Icons: https://models.dev/logos/{providerId}.svg  (fallback served if unknown)

// ── types ─────────────────────────────────────────────────────────────────────

export interface MDevCost {
  input: number
  output: number
  reasoning?: number
  cache_read?: number
  cache_write?: number
  input_audio?: number
  output_audio?: number
  context_over_200k?: MDevCost
}

export interface MDevLimit {
  context: number
  input?: number
  output: number
}

export interface MDevModalities {
  input: string[]
  output: string[]
}

export interface MDevInterleaved {
  field: 'reasoning_content' | 'reasoning_details'
}

export interface MDevModel {
  name: string
  family?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  temperature?: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  open_weights?: boolean
  interleaved?: boolean | MDevInterleaved
  cost?: MDevCost
  limit?: MDevLimit
  modalities?: MDevModalities
  status?: 'alpha' | 'beta' | 'deprecated'
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
//   1. Found in models.dev → check output includes 'text' AND status is not deprecated
//   2. Not found           → heuristic blocklist

const NON_CHAT_RE = /embed(?:ding)?|dall-?e|tts|text-to-speech|speech-to-text|whisper|transcri|omni-moderation|moderation|^babbage|^davinci|^curie|^ada-0|imagen|^veo|^lyria|^chirp|^aqa|^rerank|realtime|text-embedding/i

const DEPRECATED_RE = /deprecated|legacy|preview.*202[34]|^text-|^code-|^audio-|^image-/i

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
    // Skip deprecated models
    if (meta.status === 'deprecated')
      return false

    // Must have explicit text output to be a chat model.
    // If output is missing/empty, it's likely an embedding/audio/image model
    // that was added to models.dev without full modality info.
    if (meta.modalities?.output && meta.modalities.output.length > 0)
      return meta.modalities.output.includes('text')

    // Fallback for older models.dev entries without modalities block:
    // check the legacy output field (some older entries may still have it)
    const legacyMeta = meta as { output?: string[] }
    if (legacyMeta.output && legacyMeta.output.length > 0)
      return legacyMeta.output.includes('text')

    // No modality info at all — be conservative and reject unless we
    // can prove it's a chat model from the family or ID.
    const family = meta.family ?? ''
    const chatFamilies = /gpt|claude|gemini|llama|mistral|grok|deepseek|kimi|qwen|phi|command|nova|minimax|glm|sonar|step|yi|granite|titan|jamba|ernie|hermes|zephyr|openchat|starling|solar|reka|hunyuan|hy|baichuan|skywork|falcon|bart|m2m|indictrans|llava|seed|ray|tstars|rnj|ling|ring|kat-coder|sqlcoder|discolm|osmosis|parakeet|nemoretriever|nano-banana|una-cybertron|morph|voxtral|venice|auto|model-router|v0|tako|mai|rednote|smart-turn|qwerky|big-pickle|chutesai|opengvlab|tngtech|topazlabs|unsloth|nousresearch|alpha|oswe|neural-chat|pangu|liquid|sourceful|allenai|palmyra|allam|canopylabs|groq|elephant/i
    if (chatFamilies.test(family))
      return true

    // Known non-chat families
    const nonChatFamilies = /text-embedding|cohere-embed|voyage|mistral-embed|bge|plamo|codestral-embed|dall-e|flux|imagen|recraft|stable-diffusion|ideogram|dreamshaper|sora|veo|runway|dream-machine|whisper|elevenlabs|lyria|melotts|mm-poly|longcat|magistral|phoenix|trinity|lucid|intellect|aura|jais|sarvam|resnet|distilbert|llava/i
    if (nonChatFamilies.test(family))
      return false

    // Conservative default: if we know it's in models.dev but can't determine,
    // check the ID heuristic as a last resort.
    return !NON_CHAT_RE.test(rawModelId) && !DEPRECATED_RE.test(rawModelId)
  }

  // Not in models.dev — fall back to heuristics
  return !NON_CHAT_RE.test(rawModelId) && !DEPRECATED_RE.test(rawModelId)
}

// ── reasoning / thinking support ──────────────────────────────────────────────

/**
 * Ollama thinking model patterns.
 * Source: https://ollama.com/search?c=thinking
 * These are models that accept `think: true` in the Ollama API.
 */
const OLLAMA_THINKING_RE = /qwq|qwen3|deepseek-r1|deepseek-v3\.1|gpt-oss|marco-o|skywork-o|r1-|r1:|s1-|open-r1|-think\b|thinking/i

/**
 * Generic heuristic for unknown providers — catches common community naming
 * conventions for reasoning/thinking models.
 */
const GENERIC_THINKING_RE = /\br1\b|reasoner|thinking|qwq|qwen3|marco-o|skywork-o|-think\b|r1-|open-r1|o[34]-/i

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

  // Check interleaved field — models.dev uses this for reasoning support too
  if (meta?.interleaved !== undefined) {
    return true
  }

  // Heuristic fallback when not in models.dev
  const id = rawModelId.toLowerCase()
  switch (mdevId) {
    case 'openai':
      return /^o[1-9]/.test(id) || id.startsWith('o3') || id.startsWith('o4')
    case 'anthropic':
      return /3-7|opus-4|sonnet-4|haiku-4/.test(id)
    case 'google':
      return /2\.5|gemini-3/.test(id)
    case 'deepseek':
      return /reasoner|r1/.test(id)
    case 'groq':
      return /deepseek-r1/.test(id)

    // ── local providers: use Ollama-aware pattern ──────────────────────
    case 'ollama':
    case 'lmstudio': {
      const base = id.split(':')[0]!
      return OLLAMA_THINKING_RE.test(base) || OLLAMA_THINKING_RE.test(id)
    }

    default:
      return GENERIC_THINKING_RE.test(id)
  }
}

// ── tool call support ─────────────────────────────────────────────────────────

/**
 * Returns true if the model supports tool/function calling.
 */
export function supportsToolCalls(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.tool_call !== undefined)
    return Boolean(meta.tool_call)

  // Heuristic fallback for models not in models.dev
  const id = rawModelId.toLowerCase()
  switch (mdevId) {
    case 'openai':
      // All GPT-4o, GPT-4.1, GPT-5, o-series support tools.
      // GPT-3.5-turbo does too. Older GPT-4 does.
      return !/embedding|tts|whisper|dall-e|image|audio|realtime|instruct/.test(id)
    case 'anthropic':
      // All modern Claude models support tools
      return /claude/.test(id)
    case 'google':
      // Gemini 1.5+ supports tools
      return /gemini-1\.(?:5|pro|flash|ultra)|gemini-2\.|gemini-3\./.test(id)
    case 'deepseek':
      return /chat|reasoner|v3/.test(id)
    case 'groq':
      return !/embedding|whisper/.test(id)
    case 'mistral':
      return /large|medium|small|mixtral|pixtral|codestral|ministral/.test(id)
    case 'ollama':
    case 'lmstudio':
      // Local models: don't gate by name — many local models support tools
      // and models.dev often doesn't list them correctly.
      return true
    default:
      // Conservative: assume most chat models from major providers support tools
      return true
  }
}

// ── attachment / vision support ───────────────────────────────────────────────

/**
 * Returns true if the model supports file/image attachments (multimodal input).
 */
export function supportsAttachments(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.attachment !== undefined)
    return Boolean(meta.attachment)

  // Heuristic: check modalities
  if (meta?.modalities?.input)
    return meta.modalities.input.some(m => m === 'image' || m === 'video' || m === 'pdf')

  const id = rawModelId.toLowerCase()
  switch (mdevId) {
    case 'openai':
      return /gpt-4o|gpt-4\.1|gpt-5|o[134]/.test(id) && !/mini|nano/.test(id)
    case 'anthropic':
      return /claude-3|claude-4|opus-4|sonnet-4|haiku-4/.test(id)
    case 'google':
      return /gemini/.test(id)
    case 'ollama':
    case 'lmstudio': {
      const base = id.split(':')[0]!
      return /llava|bakllava|moondream|llama3.2-vision|qwen2-vl|minicpm/.test(base)
    }
    default:
      return false
  }
}

// ── structured output support ─────────────────────────────────────────────────

/**
 * Returns true if the model supports structured/JSON output.
 */
export function supportsStructuredOutput(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.structured_output !== undefined)
    return Boolean(meta.structured_output)

  const id = rawModelId.toLowerCase()
  switch (mdevId) {
    case 'openai':
      return /gpt-4|gpt-3\.5|o[134]/.test(id) && !/embedding|tts|whisper/.test(id)
    case 'anthropic':
      return /claude-3|claude-4/.test(id)
    case 'google':
      return /gemini-1\.5|gemini-2|gemini-3/.test(id)
    default:
      return true
  }
}

// ── temperature support ───────────────────────────────────────────────────────

/**
 * Returns true if the model supports temperature control.
 */
export function supportsTemperature(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.temperature !== undefined)
    return Boolean(meta.temperature)

  // OpenAI o-series and some reasoning models don't support temperature
  const id = rawModelId.toLowerCase()
  if (mdevId === 'openai' && /^o[1-9]/.test(id))
    return false

  return true
}

// ── context limit ─────────────────────────────────────────────────────────────

/**
 * Returns the model's context window size, or null if unknown.
 */
export function getContextLimit(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): number | null {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.limit?.context)
    return meta.limit.context

  return null
}

// ── cost ──────────────────────────────────────────────────────────────────────

export interface ModelCost {
  input: number | null
  output: number | null
  reasoning: number | null
}

/**
 * Returns per-million-token costs in USD, or nulls if unknown.
 */
export function getCost(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): ModelCost {
  const meta = lookupModel(data, mdevId, rawModelId)
  return {
    input: meta?.cost?.input ?? null,
    output: meta?.cost?.output ?? null,
    reasoning: meta?.cost?.reasoning ?? null,
  }
}

// ── modalities ────────────────────────────────────────────────────────────────

export interface ModelModalities {
  input: string[]
  output: string[]
}

/**
 * Returns the model's input/output modalities.
 */
export function getModalities(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): ModelModalities {
  const meta = lookupModel(data, mdevId, rawModelId)
  return {
    input: meta?.modalities?.input ?? ['text'],
    output: meta?.modalities?.output ?? ['text'],
  }
}

// ── knowledge cutoff ──────────────────────────────────────────────────────────

/**
 * Returns the model's knowledge cutoff date string, or null.
 */
export function getKnowledgeCutoff(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  const meta = lookupModel(data, mdevId, rawModelId)
  return meta?.knowledge ?? null
}

// ── model family ──────────────────────────────────────────────────────────────

/**
 * Returns the model family identifier from models.dev, or null.
 */
export function getModelFamily(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): string | null {
  const meta = lookupModel(data, mdevId, rawModelId)
  return meta?.family ?? null
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
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}
