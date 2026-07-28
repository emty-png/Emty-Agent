import type { ChatRequestPreview, EstimatorProviderConfig, PreviewPromptMessage, PreviewPromptPart, PromptToolDefinition } from '@/stores/chat/context/requestPreview'
import { countTokens as countTextTokens } from 'gpt-tokenizer'
import { platformFetch } from '@/utils/platformFetch'

// ── structural overhead constants ─────────────────────────────────────────────
// These match the framing tokens providers add around messages and tool
// definitions in the actual API request. Derived from OpenAI's public
// token-counting documentation and empirical testing.

/** Tokens added per request for framing (e.g. <|im_start|> / <|im_end|>) */
const TOKENS_PER_REQUEST = 3

/** Tokens added per message for role + delimiters */
const TOKENS_PER_MESSAGE = 4

/** Tokens added per tool definition for type/function wrapper + name key */
const TOKENS_PER_TOOL = 12

/** Tokens added per property in a tool's JSON Schema parameters */
const TOKENS_PER_TOOL_PROPERTY = 3

export interface ChatPromptEstimate {
  inputTokens: number
  imageTokens: number
  /** Effective prompt/input budget after reserving output tokens, if known. */
  contextLimit: number | null
  /** Raw model context window, when available. */
  modelContextLimit: number | null
  /** Prompt budget remaining before the effective input cap is reached. */
  remainingContext: number | null
  /** Input usage against the effective prompt budget. */
  contextUsageRatio: number | null
  /** Reserved output tokens used to derive the effective prompt budget. */
  reservedOutputTokens: number | null
  inputCost: number
  projectedOutputTokens: number
  projectedOutputCost: number
  projectedReasoningTokens: number
  projectedReasoningCost: number
  projectedMaxTotalCost: number
  toolCount: number
  messageCount: number
  estimatorLabel: string
  accuracy: 'exact' | 'modeled' | 'fallback'
}

const OPENAI_IMAGE_BASE_TOKENS = {
  default: 85,
  mini: 2833,
  reasoning: 75,
  gpt5: 70,
  computerUse: 65,
} as const

const OPENAI_IMAGE_TILE_TOKENS = {
  default: 170,
  mini: 5667,
  reasoning: 150,
  gpt5: 140,
  computerUse: 129,
} as const

const imageDimensionCache = new Map<string, Promise<{ width: number; height: number }>>()
const compatibleInputTokenEndpointSupport = new Map<string, boolean>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTokenNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.max(Math.trunc(value), 0)

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed))
      return Math.max(Math.trunc(parsed), 0)
  }

  return null
}

function readRecordNumber(
  record: unknown,
  ...keys: string[]
): number | null {
  if (!isRecord(record))
    return null

  for (const key of keys) {
    const normalized = normalizeTokenNumber(record[key])
    if (normalized != null)
      return normalized
  }

  return null
}

function resolveContextBudget(preview: ChatRequestPreview) {
  const previewRecord = preview as unknown

  const effectiveContextLimit = readRecordNumber(
    previewRecord,
    'effectiveContextLimit',
    'baseContextLimit',
    'promptBudgetTokens',
    'inputBudgetTokens',
    'usableContextLimit',
    'availableContextTokens',
  )

  const modelContextLimit = readRecordNumber(
    previewRecord,
    'contextLimit',
    'modelContextLimit',
    'maxContextTokens',
    'contextWindowTokens',
    'contextWindow',
  ) ?? readRecordNumber(preview.activeModel as unknown, 'contextLimit', 'maxContextTokens', 'contextWindowTokens', 'contextWindow')

  const reservedOutputTokens = readRecordNumber(
    previewRecord,
    'reservedOutputTokens',
    'outputTokens',
    'maxOutputTokens',
  )

  const derivedEffectiveContextLimit = effectiveContextLimit ?? (modelContextLimit != null && reservedOutputTokens != null
    ? Math.max(modelContextLimit - reservedOutputTokens, 0)
    : modelContextLimit)

  return {
    modelContextLimit,
    effectiveContextLimit: derivedEffectiveContextLimit,
    reservedOutputTokens,
  }
}

export async function estimateChatPrompt(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
): Promise<ChatPromptEstimate> {
  const { provider } = preview
  const { modelContextLimit, effectiveContextLimit, reservedOutputTokens } = resolveContextBudget(preview)

  let tokenEstimate: {
    inputTokens: number
    imageTokens: number
    estimatorLabel: string
    accuracy: ChatPromptEstimate['accuracy']
  }

  try {
    if (provider.type === 'anthropic') {
      tokenEstimate = await countAnthropicTokens(preview, signal)
    }
    else if (provider.type === 'google') {
      tokenEstimate = await countGoogleTokens(preview, signal)
    }
    else if (provider.type === 'openai') {
      tokenEstimate = await countOpenAITokens(preview, signal)
    }
    else if (provider.type === 'compatible') {
      tokenEstimate = provider.isOllama
        ? await countOllamaTokens(preview, signal)
        : await countCompatibleTokens(preview, signal)
    }
    else {
      tokenEstimate = await countOpenAIStyleTokens(preview)
    }
  }
  catch {
    tokenEstimate = await fallbackTokenEstimate(
      preview,
      fallbackEstimatorLabel(preview.provider),
    )
  }

  const remainingContext = effectiveContextLimit != null
    ? Math.max(effectiveContextLimit - tokenEstimate.inputTokens, 0)
    : null

  const contextUsageRatio = effectiveContextLimit != null && effectiveContextLimit > 0
    ? Math.min(tokenEstimate.inputTokens / effectiveContextLimit, 1)
    : null

  const rawRemainingWindow = modelContextLimit != null
    ? Math.max(modelContextLimit - tokenEstimate.inputTokens, 0)
    : null

  const projectedOutputTokens = Math.max(
    0,
    Math.min(
      preview.maxOutputTokens,
      rawRemainingWindow ?? remainingContext ?? preview.maxOutputTokens,
    ),
  )

  const inputCost = calculateTieredCost(
    tokenEstimate.inputTokens,
    preview.activeModel.costInput,
    preview.activeModel.costTiers,
    preview.activeModel.costContextOver200k,
    'input',
  )
  const projectedOutputCost = calculateTieredCost(
    projectedOutputTokens,
    preview.activeModel.costOutput,
    preview.activeModel.costTiers,
    preview.activeModel.costContextOver200k,
    'output',
  )
  const projectedReasoningTokens = preview.thinkingBudgetTokens
  const projectedReasoningCost = calculateCost(projectedReasoningTokens, preview.activeModel.costReasoning)

  return {
    inputTokens: tokenEstimate.inputTokens,
    imageTokens: tokenEstimate.imageTokens,
    contextLimit: effectiveContextLimit,
    modelContextLimit,
    reservedOutputTokens,
    remainingContext,
    contextUsageRatio,
    inputCost,
    projectedOutputTokens,
    projectedOutputCost,
    projectedReasoningTokens,
    projectedReasoningCost,
    projectedMaxTotalCost: inputCost + projectedOutputCost + projectedReasoningCost,
    toolCount: preview.toolDefinitions.length,
    messageCount: preview.inputMessages.length,
    estimatorLabel: tokenEstimate.estimatorLabel,
    accuracy: tokenEstimate.accuracy,
  }
}

function calculateCost(tokens: number, ratePerMillion: number | null): number {
  if (!ratePerMillion || tokens <= 0)
    return 0

  return (tokens / 1_000_000) * ratePerMillion
}

function calculateTieredCost(
  tokens: number,
  flatRate: number | null,
  tiers: ChatRequestPreview['activeModel']['costTiers'],
  contextOver200k: ChatRequestPreview['activeModel']['costContextOver200k'],
  field: 'input' | 'output',
): number {
  if (tokens <= 0)
    return 0

  // Tiered pricing: find the matching tier based on context size
  if (tiers?.length) {
    // Sort tiers by size ascending to find the first that covers this token count
    const sorted = [...tiers].sort((a, b) => a.tier.size - b.tier.size)
    const matchingTier = sorted.find(t => tokens <= t.tier.size)
    if (matchingTier) {
      const rate = matchingTier[field] ?? flatRate
      return calculateCost(tokens, rate ?? null)
    }
    // Tokens exceed all tier sizes — use the largest tier's rate
    const largestTier = sorted[sorted.length - 1]!
    const rate = largestTier[field] ?? flatRate
    return calculateCost(tokens, rate ?? null)
  }

  // context_over_200k: use elevated rate when tokens exceed 200k
  if (contextOver200k && tokens > 200_000) {
    const rate = contextOver200k[field] ?? flatRate
    return calculateCost(tokens, rate ?? null)
  }

  return calculateCost(tokens, flatRate)
}

async function countAnthropicTokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const provider = preview.provider
  if (provider.type !== 'anthropic' || !provider.apiKey.trim()) {
    return fallbackTokenEstimate(preview, 'Anthropic tokenizer fallback')
  }

  let messages = preview.inputMessages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role,
      content: toAnthropicContent(message.parts),
    }))

  // Anthropic 400s if messages array is empty
  if (messages.length === 0) {
    messages = [{ role: 'user', content: ' ' }]
  }

  const url = `${provider.baseURL.replace(/\/$/, '')}/messages/count_tokens`
  const body: Record<string, unknown> = {
    model: preview.activeModel.id || 'claude-3-haiku-20240307',
    messages,
  }

  if (preview.systemPrompt.trim()) {
    body.system = preview.systemPrompt.trim()
  }

  if (preview.toolDefinitions.length > 0) {
    body.tools = preview.toolDefinitions.map(tool => ({
      name: tool.name,
      description: tool.description || 'No description provided.',
      input_schema: tool.inputSchema && Object.keys(tool.inputSchema).length > 0
        ? tool.inputSchema
        : { type: 'object', properties: {} },
    }))
  }

  if (preview.thinkingBudgetTokens > 0) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: preview.thinkingBudgetTokens,
    }
  }

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })

  if (!res.ok)
    return fallbackTokenEstimate(preview, 'Anthropic tokenizer fallback')

  const data = await res.json() as { input_tokens?: number }
  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)

  return {
    inputTokens: Math.max(Number(data.input_tokens ?? 0), 0),
    imageTokens,
    estimatorLabel: 'Anthropic token count API',
    accuracy: 'exact' as const,
  }
}

async function countGoogleTokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const provider = preview.provider
  if (provider.type !== 'google' || !provider.apiKey.trim()) {
    return fallbackTokenEstimate(preview, 'Gemini tokenizer fallback')
  }

  let contents = preview.inputMessages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: message.parts.map(toGooglePart),
    }))

  // Gemini 400s if contents array is empty
  if (contents.length === 0) {
    contents = [{ role: 'user', parts: [{ text: ' ' }] }]
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(preview.activeModel.id)}:countTokens?key=${encodeURIComponent(provider.apiKey.trim())}`

  const googleProviderOptions = preview.providerOptions?.google
  const cachedContent = typeof googleProviderOptions?.cachedContent === 'string'
    ? googleProviderOptions.cachedContent.trim()
    : ''

  const body = {
    generateContentRequest: {
      contents,
      ...(preview.systemPrompt.trim()
        ? {
            systemInstruction: {
              parts: [{ text: preview.systemPrompt.trim() }],
            },
          }
        : {}),
      ...(preview.toolDefinitions.length > 0
        ? {
            tools: [{
              functionDeclarations: preview.toolDefinitions.map(toGoogleFunctionDeclaration),
            }],
          }
        : {}),
      ...(cachedContent ? { cachedContent } : {}),
    },
  }

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })

  if (!res.ok)
    return fallbackTokenEstimate(preview, 'Gemini tokenizer fallback')

  const data = await res.json() as { totalTokens?: number; total_tokens?: number }
  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)

  return {
    inputTokens: Math.max(Number(data.totalTokens ?? data.total_tokens ?? 0), 0),
    imageTokens,
    estimatorLabel: 'Gemini countTokens API',
    accuracy: 'exact' as const,
  }
}

function fallbackEstimatorLabel(provider: EstimatorProviderConfig): string {
  if (provider.type === 'anthropic')
    return 'Anthropic tokenizer fallback'

  if (provider.type === 'google')
    return 'Gemini tokenizer fallback'

  if (provider.type === 'openai')
    return 'OpenAI tokenizer fallback'

  if (provider.isOllama)
    return 'Ollama tokenizer fallback'

  return `${provider.name} tokenizer fallback`
}

async function countCompatibleTokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const exact = await countOpenAICompatibleInputTokens(preview, signal)
  if (exact)
    return exact

  return countOpenAIStyleTokens(preview)
}

async function countOllamaTokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const provider = preview.provider
  if (provider.type !== 'compatible' || !provider.isOllama)
    return fallbackTokenEstimate(preview, 'Ollama tokenizer fallback')

  const hasSystemPrompt = preview.systemPrompt.trim().length > 0
  const hasTools = preview.toolDefinitions.length > 0

  // Ollama's exact prompt_eval_count works best with the minimal chat payload.
  // If the preview includes extra prompt structure, fall back to the modeled estimate
  // rather than sending a request shape that can be rejected by the server.
  if (hasSystemPrompt || hasTools)
    return fallbackTokenEstimate(preview, 'Ollama tokenizer fallback')

  const messages = preview.inputMessages
    .filter(message => message.role !== 'system')
    .map(toOllamaMessage)

  const normalizedMessages = messages.length > 0
    ? messages
    : [{ role: 'user', content: ' ' }]

  const root = provider.baseURL.replace(/\/v1\/?$/i, '').replace(/\/$/, '')
  const url = `${root}/api/chat`
  const body = {
    model: preview.activeModel.id,
    messages: normalizedMessages,
    stream: false,
    options: {
      num_predict: 0,
    },
  }

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })

  if (!res.ok)
    return fallbackTokenEstimate(preview, 'Ollama tokenizer fallback')

  const data = await res.json() as { prompt_eval_count?: number }
  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)

  return {
    inputTokens: Math.max(Number(data.prompt_eval_count ?? 0), 0),
    imageTokens,
    estimatorLabel: 'Ollama prompt evaluation count',
    accuracy: 'exact' as const,
  }
}

async function countOpenAITokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const provider = preview.provider
  if (provider.type !== 'openai' || !provider.apiKey.trim())
    return fallbackTokenEstimate(preview, 'OpenAI tokenizer fallback')

  const result = await countOpenAIInputTokens({
    preview,
    apiKey: provider.apiKey.trim(),
    baseURL: provider.baseURL?.trim() || 'https://api.openai.com/v1',
    ...(provider.organizationId ? { organizationId: provider.organizationId } : {}),
    ...(signal ? { signal } : {}),
  })

  if (!result.value)
    return fallbackTokenEstimate(preview, 'OpenAI tokenizer fallback')

  return result.value
}

async function countOpenAIStyleTokens(preview: ChatRequestPreview) {
  const providerLabel = preview.provider.type === 'compatible'
    ? preview.provider.name
    : preview.provider.type === 'openai'
      ? 'OpenAI'
      : 'Tokenizer'

  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)
  const inputTokens = countSerializedPayloadTokens(preview) + imageTokens

  return {
    inputTokens,
    imageTokens,
    estimatorLabel: preview.provider.type === 'openai'
      ? 'OpenAI serialized tokenizer'
      : `${providerLabel} serialized tokenizer`,
    accuracy: preview.provider.type === 'openai' ? 'modeled' as const : 'fallback' as const,
  }
}

async function countOpenAICompatibleInputTokens(
  preview: ChatRequestPreview,
  signal?: AbortSignal,
) {
  const provider = preview.provider
  if (provider.type !== 'compatible')
    return null

  const normalizedBaseUrl = provider.baseURL.trim()
  const cachedSupport = compatibleInputTokenEndpointSupport.get(normalizedBaseUrl)
  if (cachedSupport === false)
    return null

  const result = await countOpenAIInputTokens({
    preview,
    apiKey: provider.apiKey.trim(),
    baseURL: normalizedBaseUrl,
    ...(signal ? { signal } : {}),
  })

  if (result.value) {
    compatibleInputTokenEndpointSupport.set(normalizedBaseUrl, true)
    return {
      ...result.value,
      estimatorLabel: `${provider.name} input token count API`,
    }
  }

  if (result.unsupported)
    compatibleInputTokenEndpointSupport.set(normalizedBaseUrl, false)

  return null
}

async function countOpenAIInputTokens(options: {
  preview: ChatRequestPreview
  apiKey: string
  baseURL: string
  organizationId?: string
  signal?: AbortSignal
}) {
  const { preview, apiKey, baseURL, organizationId, signal } = options
  if (!apiKey)
    return { value: null, unsupported: false }

  const root = baseURL.replace(/\/v1\/?$/i, '').replace(/\/$/, '')
  const url = `${root}/v1/responses/input_tokens`

  let res: Response
  try {
    res = await platformFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(organizationId?.trim() ? { 'OpenAI-Organization': organizationId.trim() } : {}),
      },
      body: JSON.stringify(buildOpenAIInputTokenBody(preview)),
      ...(signal ? { signal } : {}),
    })
  }
  catch {
    // Network failure, CORS block, or AbortError — treat as permanently
    // unsupported so the cache is populated and we never retry this endpoint.
    return { value: null, unsupported: true }
  }

  if (!res.ok) {
    return {
      value: null,
      // 404/405/501 = endpoint genuinely absent on this provider.
      // 429 = rate-limited, but the endpoint exists — don't blacklist it.
      unsupported: [404, 405, 501].includes(res.status),
    }
  }

  const data = await res.json() as { input_tokens?: number; inputTokens?: number }
  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)

  return {
    value: {
      inputTokens: Math.max(Number(data.input_tokens ?? data.inputTokens ?? 0), 0),
      imageTokens,
      estimatorLabel: 'OpenAI input token count API',
      accuracy: 'exact' as const,
    },
    unsupported: false,
  }
}

function buildOpenAIInputTokenBody(preview: ChatRequestPreview): Record<string, unknown> {
  const input = preview.inputMessages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role,
      content: toOpenAIContent(message.parts),
    }))

  const normalizedInput = input.length > 0
    ? input
    : [{
        role: 'user',
        content: ' ',
      }]

  const tools = preview.toolDefinitions.map(tool => {
    const parameters = tool.inputSchema && Object.keys(tool.inputSchema).length > 0
      ? tool.inputSchema
      : { type: 'object', properties: {} }

    return {
      type: 'function',
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: isRecord(parameters) ? parameters : { type: 'object', properties: {} },
    }
  })

  return {
    model: preview.activeModel.id,
    input: normalizedInput,
    ...(preview.systemPrompt.trim() ? { instructions: preview.systemPrompt.trim() } : {}),
    ...(tools.length > 0 ? { tools } : {}),
  }
}

/**
 * Count tokens for the full request payload by serializing messages, the system
 * instruction, and tool definitions as text, then counting with the plain tokenizer.
 *
 * This replaces the old countChatCompletionTokens approach that severely
 * undercounted tool definition tokens. The plain tokenizer accurately counts
 * text tokens, and we add the known structural overhead per message and per
 * tool to match what providers actually send.
 */
function countSerializedPayloadTokens(preview: ChatRequestPreview): number {
  let totalTokens = TOKENS_PER_REQUEST

  const systemPrompt = preview.systemPrompt.trim()
  if (systemPrompt) {
    totalTokens += TOKENS_PER_MESSAGE + countTextTokens(systemPrompt)
  }

  // ── messages ──────────────────────────────────────────────────────────────
  for (const message of preview.inputMessages) {
    const text = flattenTextParts(message.parts)
    if (text) {
      totalTokens += countTextTokens(text)
    }
    totalTokens += TOKENS_PER_MESSAGE
  }

  // ── tool definitions ──────────────────────────────────────────────────────
  for (const tool of preview.toolDefinitions) {
    totalTokens += countToolDefinitionTokens(tool)
  }

  return Math.max(totalTokens, 0)
}

/**
 * Count the tokens for a single tool definition by serializing it as the
 * provider would: name + description + full JSON Schema.
 *
 * The JSON Schema serialization captures ALL token-consuming content
 * including nested property descriptions from Zod's .describe() calls,
 * enum values, min/max constraints, etc.
 */
function countToolDefinitionTokens(tool: PromptToolDefinition): number {
  let tokens = TOKENS_PER_TOOL

  // Tool name
  tokens += countTextTokens(tool.name)

  // Tool description — these are often very long (200+ chars)
  if (tool.description) {
    tokens += countTextTokens(tool.description)
  }

  // Input schema — serialize the full JSON Schema as text.
  // This is the key fix: the old approach used gpt-tokenizer's function
  // counting which severely undercounted the schema tokens.
  if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
    const schemaText = JSON.stringify(tool.inputSchema)
    tokens += countTextTokens(schemaText)

    // Add per-property overhead for nested schema structure
    const propertyCount = countSchemaProperties(tool.inputSchema)
    tokens += propertyCount * TOKENS_PER_TOOL_PROPERTY
  }

  return tokens
}

/**
 * Recursively count the number of properties in a JSON Schema object.
 * Each property adds structural overhead tokens in the serialized format.
 */
function countSchemaProperties(schema: unknown): number {
  if (!isRecord(schema))
    return 0

  let count = 0

  const properties = schema.properties
  if (isRecord(properties)) {
    for (const value of Object.values(properties)) {
      count++
      count += countSchemaProperties(value)
    }
  }

  const items = schema.items
  if (Array.isArray(items)) {
    for (const item of items)
      count += countSchemaProperties(item)
  }
  else {
    count += countSchemaProperties(items)
  }

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const variants = schema[key]
    if (Array.isArray(variants)) {
      for (const variant of variants)
        count += countSchemaProperties(variant)
    }
  }

  return count
}

function toOpenAIContent(parts: PreviewPromptPart[]): string | Array<
  | { type: 'input_text'; text: string }
  | {
    type: 'input_image'
    image_url: string
    detail: 'auto'
  }
> {
  const content: Array<
    | { type: 'input_text'; text: string }
    | {
      type: 'input_image'
      image_url: string
      detail: 'auto'
    }
  > = []

  for (const part of parts) {
    if (part.type === 'text') {
      const text = part.text.trim().length > 0 ? part.text : ' '
      content.push({ type: 'input_text', text })
      continue
    }

    const parsed = parseDataUrl(part.dataUrl, part.mimeType)
    if (!parsed)
      continue

    content.push({
      type: 'input_image',
      image_url: `data:${parsed.mimeType};base64,${parsed.base64}`,
      detail: 'auto',
    })
  }

  if (content.length === 0)
    return ' '

  return content.length === 1 && content[0]?.type === 'input_text'
    ? content[0].text
    : content
}

async function fallbackTokenEstimate(
  preview: ChatRequestPreview,
  estimatorLabel: string,
) {
  const imageTokens = await countImageTokensForFallback(preview.inputMessages, preview.activeModel.id)
  const inputTokens = countSerializedPayloadTokens(preview) + imageTokens

  return {
    inputTokens,
    imageTokens,
    estimatorLabel,
    accuracy: 'fallback' as const,
  }
}

function toAnthropicContent(parts: PreviewPromptPart[]) {
  const content: Array<
    | { type: 'text'; text: string }
    | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: string
        data: string
      }
    }
  > = []

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text || ' ' })
      continue
    }

    const parsed = parseDataUrl(part.dataUrl, part.mimeType)
    if (!parsed)
      continue

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: parsed.mimeType,
        data: parsed.base64,
      },
    })
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: ' ' })
  }

  const first = content[0]
  return content.length === 1 && first?.type === 'text'
    ? first.text
    : content
}

function toGooglePart(part: PreviewPromptPart) {
  if (part.type === 'text')
    return { text: part.text || ' ' }

  const parsed = parseDataUrl(part.dataUrl, part.mimeType)
  if (!parsed)
    return { text: ' ' }

  return {
    inlineData: {
      mimeType: parsed.mimeType,
      data: parsed.base64,
    },
  }
}

function toGoogleFunctionDeclaration(tool: PromptToolDefinition) {
  const parameters = tool.inputSchema && Object.keys(tool.inputSchema).length > 0
    ? tool.inputSchema
    : { type: 'object', properties: {} }

  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: isRecord(parameters) ? parameters : { type: 'object', properties: {} },
  }
}

function toOllamaMessage(message: PreviewPromptMessage) {
  const images = message.parts
    .filter((part): part is Extract<PreviewPromptPart, { type: 'image' }> => part.type === 'image')
    .map(part => parseDataUrl(part.dataUrl, part.mimeType)?.base64)
    .filter((base64): base64 is string => !!base64)

  let content = flattenTextParts(message.parts)
  if (!content && images.length === 0)
    content = ' '

  return {
    role: message.role,
    content,
    ...(images.length > 0 ? { images } : {}),
  }
}

function flattenTextParts(parts: PreviewPromptPart[]): string {
  return parts
    .filter((part): part is Extract<PreviewPromptPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

function parseDataUrl(
  value: string,
  fallbackMimeType?: string,
): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(value)
  if (!match)
    return null

  return {
    mimeType: match[1] ?? fallbackMimeType ?? 'application/octet-stream',
    base64: match[2] ?? '',
  }
}

async function countImageTokensForFallback(
  messages: PreviewPromptMessage[],
  modelId: string,
): Promise<number> {
  const images = messages.flatMap(message => message.parts.filter((part): part is Extract<PreviewPromptPart, { type: 'image' }> => part.type === 'image'))
  if (images.length === 0)
    return 0

  const dimensions = await Promise.all(
    images.map(image => getImageDimensions(image.dataUrl)),
  )

  return dimensions.reduce((total, dimension) => total + calculateOpenAIImageTokens(modelId, dimension.width, dimension.height), 0)
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  const cached = imageDimensionCache.get(dataUrl)
  if (cached)
    return cached

  const promise = new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
    image.onerror = () => reject(new Error('Could not read image dimensions'))
    image.src = dataUrl
  })

  imageDimensionCache.set(dataUrl, promise)
  return promise
}

function calculateOpenAIImageTokens(modelId: string, width: number, height: number): number {
  const { baseTokens, tileTokens } = resolveOpenAIImagePricing(modelId)

  if (Math.max(width, height) <= 512)
    return baseTokens

  let scaledWidth = width
  let scaledHeight = height

  const maxSide = Math.max(scaledWidth, scaledHeight)
  if (maxSide > 2048) {
    const ratio = 2048 / maxSide
    scaledWidth *= ratio
    scaledHeight *= ratio
  }

  const shortestSide = Math.min(scaledWidth, scaledHeight)
  if (shortestSide > 768) {
    const ratio = 768 / shortestSide
    scaledWidth *= ratio
    scaledHeight *= ratio
  }

  const tilesWide = Math.ceil(scaledWidth / 512)
  const tilesHigh = Math.ceil(scaledHeight / 512)
  return baseTokens + (tilesWide * tilesHigh * tileTokens)
}

function resolveOpenAIImagePricing(modelId: string) {
  const normalized = modelId.toLowerCase()

  if (normalized.startsWith('gpt-5'))
    return { baseTokens: OPENAI_IMAGE_BASE_TOKENS.gpt5, tileTokens: OPENAI_IMAGE_TILE_TOKENS.gpt5 }

  if (normalized.startsWith('gpt-4o-mini'))
    return { baseTokens: OPENAI_IMAGE_BASE_TOKENS.mini, tileTokens: OPENAI_IMAGE_TILE_TOKENS.mini }

  if (normalized.startsWith('o1') || normalized.startsWith('o3'))
    return { baseTokens: OPENAI_IMAGE_BASE_TOKENS.reasoning, tileTokens: OPENAI_IMAGE_TILE_TOKENS.reasoning }

  if (normalized.includes('computer-use-preview'))
    return { baseTokens: OPENAI_IMAGE_BASE_TOKENS.computerUse, tileTokens: OPENAI_IMAGE_TILE_TOKENS.computerUse }

  return { baseTokens: OPENAI_IMAGE_BASE_TOKENS.default, tileTokens: OPENAI_IMAGE_TILE_TOKENS.default }
}
