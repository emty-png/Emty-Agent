/**
 * src/utils/tools/web.ts
 *
 * Web access tools for the Emty coding agent.
 *   • web_search — full-text web search via Tavily AI Search API
 *   • web_fetch  — fetch and extract a URL's readable content via Jina Reader
 *
 * Tavily (web_search):
 *   Requires a free or paid API key at https://app.tavily.com
 *   The key is stored in the settings store (Settings → Providers → Tavily).
 *   If no key is configured, execute() returns a clear error so the agent
 *   can surface it to the user rather than silently failing.
 *
 * Jina Reader (web_fetch):
 *   Free public endpoint — no API key required.
 *   Endpoint: https://r.jina.ai/<url>
 *   Returns clean markdown-like extracted content from the page.
 *   Supports batching: multiple URLs are fetched concurrently.
 *
 * Output trimming:
 *   Both tools trim large outputs before returning to the model context.
 *   Tavily results are trimmed per-result and the batch is capped.
 *   Jina outputs are head+tail trimmed at MAX_FETCH_CHARS per URL.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { platformFetch } from '@/utils/platformFetch'

// ── constants ─────────────────────────────────────────────────────────────────

const TAVILY_BASE = 'https://api.tavily.com'

/** Max characters of content to return per Tavily result snippet. */
const MAX_SNIPPET_CHARS = 800

/** Max characters of extracted content to return per fetched URL. */
const MAX_FETCH_CHARS = 32_000

/** Timeout for individual Tavily search requests (ms). */
const SEARCH_TIMEOUT_MS = 15_000

/** Timeout for individual Jina fetch requests (ms). */
const FETCH_TIMEOUT_MS = 20_000

// ── helpers ───────────────────────────────────────────────────────────────────

/** Lazily retrieve the Tavily API key from the settings store. */
async function getTavilyKey(): Promise<string> {
  const { useSettingsStore } = await import('@/stores/settings')
  const key = useSettingsStore().tavily.apiKey.trim()
  if (!key) {
    throw new Error(
      'Tavily API key is not configured. Go to Settings → Providers → Tavily and add your key.',
    )
  }
  return key
}

/** Trim a string to at most `max` characters, keeping it clean at a word boundary when possible. */
function trimContent(s: string, max: number): string {
  const raw = s.trim()
  if (raw.length <= max)
    return raw
  return `${raw.slice(0, max).trimEnd()}… [truncated]`
}

/**
 * Head+tail trim for large fetched pages.
 * Keeps the beginning (most likely to contain meta/intro) and the end
 * (most likely to contain the answer or conclusion).
 */
function trimFetchOutput(raw: string): string {
  const t = raw.trim()
  if (t.length <= MAX_FETCH_CHARS)
    return t
  const half = Math.floor(MAX_FETCH_CHARS / 2)
  const head = t.slice(0, half).trimEnd()
  const tail = t.slice(-half).trimStart()
  return `${head}\n\n[… ${Math.round(t.length / 1024)} KB — middle trimmed — showing head + tail …]\n\n${tail}`
}

// ── Tavily response types ─────────────────────────────────────────────────────

interface TavilyResult {
  title: string
  url: string
  content: string
  score?: number
  published_date?: string
}

interface TavilySearchResponse {
  query: string
  results: TavilyResult[]
  answer?: string
}

// ── web_search ────────────────────────────────────────────────────────────────

export function createWebSearchTool() {
  return tool({
    description: `Search the web for current information via Tavily. Use for docs, package versions, changelogs, error messages, CVEs, or anything that may have changed since training.

Batch up to 5 queries per call — group related searches rather than making separate calls.
Returns a synthesised answer plus per-result title, URL, snippet, and date.
Don't search for things you already know. Use filesystem tools for file/directory lookups.`,
    inputSchema: z.object({
      queries: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .describe(
          'Search queries to run. Use one query per distinct topic. '
          + 'Keep queries concise and specific — 3 to 10 words each.',
        ),
      searchDepth: z
        .enum(['basic', 'advanced'])
        .optional()
        .describe(
          'Search depth. "basic" is faster (default). '
          + '"advanced" is slower but retrieves more content per result — use for in-depth research.',
        ),
      maxResultsPerQuery: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max results to return per query. Default: 5.'),
    }),

    execute: async ({ queries, searchDepth = 'basic', maxResultsPerQuery = 5 }) => {
      let apiKey: string
      try {
        apiKey = await getTavilyKey()
      }
      catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }

      // Run all queries concurrently — Tavily handles individual rate limits.
      const settled = await Promise.allSettled(
        queries.map(async query => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

          try {
            const res = await platformFetch(`${TAVILY_BASE}/search`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                query,
                search_depth: searchDepth,
                max_results: maxResultsPerQuery,
                include_answer: true,
                include_raw_content: false,
              }),
              signal: controller.signal,
            })

            if (!res.ok) {
              const body = await res.text().catch(() => '')
              if (res.status === 401)
                throw new Error('Invalid Tavily API key. Check Settings → Providers → Tavily.')
              if (res.status === 429)
                throw new Error('Tavily rate limit hit. Try again in a moment.')
              throw new Error(`Tavily API error ${res.status}: ${body.slice(0, 200)}`)
            }

            const data = (await res.json()) as TavilySearchResponse

            const results = (data.results ?? []).map(r => ({
              title: r.title,
              url: r.url,
              snippet: trimContent(r.content ?? '', MAX_SNIPPET_CHARS),
              ...(r.published_date ? { published: r.published_date } : {}),
            }))

            return {
              query,
              answer: data.answer ? trimContent(data.answer, 1200) : undefined,
              results,
            }
          }
          finally {
            clearTimeout(timer)
          }
        }),
      )

      const output = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
      )

      return { searches: output }
    },
  })
}

// ── web_fetch ─────────────────────────────────────────────────────────────────

export function createWebFetchTool() {
  return tool({
    description: `Fetch and extract readable text from web pages via Jina Reader (no key required). Returns clean markdown — ads and navigation stripped.

Batch up to 10 URLs per call; all fetched concurrently. Use to read a search result in full, fetch official docs, or inspect a GitHub issue, PR, or release page. Won't work for pages that require login.`,
    inputSchema: z.object({
      urls: z
        .array(z.string().url())
        .min(1)
        .max(10)
        .describe('URLs to fetch. Must be valid, fully-qualified URLs including the scheme (https://).'),
    }),

    execute: async ({ urls }) => {
      const settled = await Promise.allSettled(
        urls.map(async url => {
          const jinaUrl = `https://r.jina.ai/${url}`
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

          try {
            const res = await platformFetch(jinaUrl, {
              method: 'GET',
              headers: {
                // Request markdown-formatted output from Jina Reader.
                Accept: 'text/plain',
                'X-Return-Format': 'markdown',
              },
              signal: controller.signal,
            })

            if (!res.ok) {
              throw new Error(`HTTP ${res.status} from Jina Reader for ${url}`)
            }

            const text = await res.text()
            return {
              url,
              content: trimFetchOutput(text),
              length: text.length,
            }
          }
          catch (e) {
            const isTimeout = e instanceof Error && e.name === 'AbortError'
            throw new Error(
              isTimeout
                ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`
                : `Failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
          finally {
            clearTimeout(timer)
          }
        }),
      )

      const pages = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : { url: urls[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
      )

      return { pages }
    },
  })
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Create both web tools.
 * Both are always available regardless of whether a project is open.
 *
 * @example
 * const tools = {
 *   ask_questions: createQuestionsTool(),
 *   ...createWebTools(),
 *   ...(project.projectPath ? { ...createFilesystemTools(...), ...createShellTools(...) } : {}),
 * }
 */
export function createWebTools() {
  return {
    web_search: createWebSearchTool(),
    web_fetch: createWebFetchTool(),
  } as const
}

export type WebTools = ReturnType<typeof createWebTools>

// ── display labels ────────────────────────────────────────────────────────────

/**
 * Truncate a string to at most `max` visible characters, appending an ellipsis
 * if trimmed. The max is intentionally short so badge text never wraps.
 */
function truncate(s: string, max = 42): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

/**
 * Strip scheme + trailing slash for compact badge display.
 * "https://example.com/some/path" → "example.com/some/path"
 */
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Extract just the hostname from a URL for ultra-compact display when there
 * are multiple URLs and listing all paths would overflow.
 * "https://docs.example.com/some/long/path" → "docs.example.com"
 */
function hostname(url: string): string {
  try {
    return new URL(url).hostname
  }
  catch {
    return stripScheme(url).split('/')[0] ?? url
  }
}

export function webToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'web_search': {
      const queries = args.queries as string[] | undefined
      if (!queries?.length)
        return 'Searched web'

      // Always show just the first query truncated + optional overflow count.
      // Listing all queries inline grows unboundedly and breaks the badge layout.
      const first = truncate(queries[0]!, 42)
      if (queries.length === 1)
        return `Searched: ${first}`
      return `Searched: ${first} +${queries.length - 1} more`
    }

    case 'web_fetch': {
      const urls = args.urls as string[] | undefined
      if (!urls?.length)
        return 'Fetched page'

      // Single URL: show full path without scheme, truncated.
      if (urls.length === 1)
        return `Fetched ${truncate(stripScheme(urls[0]!), 48)}`

      // Multiple URLs: show hostnames only (paths make it too long) + overflow.
      const first = hostname(urls[0]!)
      if (urls.length === 2)
        return `Fetched ${first}, ${hostname(urls[1]!)}`
      return `Fetched ${first} +${urls.length - 1} more`
    }

    default:
      return `Called ${toolName}`
  }
}
