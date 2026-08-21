/**
 * Web access tools: web_search (DuckDuckGo/Tavily/Exa/Brave/Serper) and
 * web_fetch (Jina Reader). Provider is selected in Settings → Providers.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { platformFetch } from '@/utils/platformFetch'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

const TAVILY_BASE = 'https://api.tavily.com'
const MAX_SNIPPET_CHARS = 800
const MAX_FETCH_CHARS = 32_000
const SEARCH_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 20_000

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

function trimContent(s: string, max: number): string {
  const raw = s.trim()
  if (raw.length <= max)
    return raw
  return `${raw.slice(0, max).trimEnd()}… [truncated]`
}

function trimFetchOutput(raw: string): string {
  const t = raw.trim()
  if (t.length <= MAX_FETCH_CHARS)
    return t
  const half = Math.floor(MAX_FETCH_CHARS / 2)
  const head = t.slice(0, half).trimEnd()
  const tail = t.slice(-half).trimStart()
  return `${head}\n\n[… ${Math.round(t.length / 1024)} KB — middle trimmed — showing head + tail …]\n\n${tail}`
}

interface SearchResult { title: string; url: string; snippet: string }

async function fetchSearchApi(
  url: string,
  init: RequestInit,
  mapResults: (data: unknown) => SearchResult[],
  provider: string,
): Promise<SearchResult[]> {
  const res = await platformFetch(url, {
    ...init,
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401)
      throw new Error(`Invalid ${provider} API key. Check Settings → Providers → ${provider}.`)
    throw new Error(`${provider} API error ${res.status}: ${body.slice(0, 200)}`)
  }
  return mapResults(await res.json())
}

function buildExaResults(data: unknown): SearchResult[] {
  const d = data as { results?: Array<{ title: string; url: string; text?: string }> }
  return (d.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: trimContent(r.text ?? '', MAX_SNIPPET_CHARS),
  }))
}

function buildBraveResults(data: unknown): SearchResult[] {
  const d = data as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }
  return (d.web?.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: trimContent(r.description ?? '', MAX_SNIPPET_CHARS),
  }))
}

function buildSerperResults(data: unknown): SearchResult[] {
  const d = data as { organic?: Array<{ title: string; link: string; snippet?: string }> }
  return (d.organic ?? []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: trimContent(r.snippet ?? '', MAX_SNIPPET_CHARS),
  }))
}

// ── web_search ────────────────────────────────────────────────────────────

export function createWebSearchTool() {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.web_search,
    inputSchema: z.object({
      queries: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .describe(
          'Search queries to run. Use one query per distinct topic. '
          + 'Keep queries concise and specific — 3 to 10 words each.',
        ),
      maxResultsPerQuery: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max results to return per query. Default: 5.'),
    }),

    execute: async ({ queries, maxResultsPerQuery = 5 }) => {
      const { useSettingsStore } = await import('@/stores/settings')
      const settings = useSettingsStore()
      const provider = settings.webSearchProvider

      if (provider === 'duckduckgo') {
        const { invoke } = await import('@tauri-apps/api/core')
        const settled = await Promise.allSettled(
          queries.map(async query => {
            const result = await invoke<{ results: Array<{ title: string; url: string; snippet: string }> }>('ddg_search', {
              query,
              maxResults: maxResultsPerQuery,
            })
            return {
              query,
              results: result.results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: trimContent(r.snippet, MAX_SNIPPET_CHARS),
              })),
            }
          }),
        )
        return {
          searches: settled.map((s, i) =>
            s.status === 'fulfilled'
              ? s.value
              : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          ),
        }
      }

      if (provider === 'tavily') {
        let apiKey: string
        try {
          apiKey = await getTavilyKey()
        }
        catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }

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
              const data = (await res.json()) as {
                query: string
                results?: Array<{ title: string; url: string; content?: string; published_date?: string }>
                answer?: string
              }
              return {
                query,
                answer: data.answer ? trimContent(data.answer, 1200) : undefined,
                results: (data.results ?? []).map(r => ({
                  title: r.title,
                  url: r.url,
                  snippet: trimContent(r.content ?? '', MAX_SNIPPET_CHARS),
                  ...(r.published_date ? { published: r.published_date } : {}),
                })),
              }
            }
            finally {
              clearTimeout(timer)
            }
          }),
        )
        return {
          searches: settled.map((s, i) =>
            s.status === 'fulfilled'
              ? s.value
              : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          ),
        }
      }

      if (provider === 'exa') {
        const exaKey = settings.exa.apiKey
        if (!exaKey.trim())
          return { error: 'Exa API key is not configured. Go to Settings → Providers → Exa and add your key.' }
        const settled = await Promise.allSettled(
          queries.map(async query => ({
            query,
            results: await fetchSearchApi(
              'https://api.exa.ai/search',
              { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': exaKey }, body: JSON.stringify({ query, numResults: maxResultsPerQuery }) },
              buildExaResults,
              'Exa',
            ),
          })),
        )
        return {
          searches: settled.map((s, i) =>
            s.status === 'fulfilled'
              ? s.value
              : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          ),
        }
      }

      if (provider === 'brave') {
        const braveKey = settings.brave.apiKey
        if (!braveKey.trim())
          return { error: 'Brave API key is not configured. Go to Settings → Providers → Brave and add your key.' }
        const settled = await Promise.allSettled(
          queries.map(async query => {
            const params = new URLSearchParams({ q: query, count: String(maxResultsPerQuery) })
            return {
              query,
              results: await fetchSearchApi(
                `https://api.search.brave.com/res/v1/web/search?${params}`,
                { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey } },
                buildBraveResults,
                'Brave',
              ),
            }
          }),
        )
        return {
          searches: settled.map((s, i) =>
            s.status === 'fulfilled'
              ? s.value
              : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          ),
        }
      }

      if (provider === 'serper') {
        const serperKey = settings.serper.apiKey
        if (!serperKey.trim())
          return { error: 'Serper API key is not configured. Go to Settings → Providers → Serper and add your key.' }
        const settled = await Promise.allSettled(
          queries.map(async query => ({
            query,
            results: await fetchSearchApi(
              'https://google.serper.dev/search',
              { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey }, body: JSON.stringify({ q: query, num: maxResultsPerQuery }) },
              buildSerperResults,
              'Serper',
            ),
          })),
        )
        return {
          searches: settled.map((s, i) =>
            s.status === 'fulfilled'
              ? s.value
              : { query: queries[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          ),
        }
      }

      return { error: `Unknown search provider: ${provider}` }
    },
  })
}

// ── web_fetch ─────────────────────────────────────────────────────────────

export function createWebFetchTool() {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.web_fetch,
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
              headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' },
              signal: controller.signal,
            })
            if (!res.ok)
              throw new Error(`HTTP ${res.status} from Jina Reader for ${url}`)
            const text = await res.text()
            return { url, content: trimFetchOutput(text), length: text.length }
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

      return {
        pages: settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : { url: urls[i]!, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
        ),
      }
    },
  })
}

// ── factory + display labels ─────────────────────────────────────────────

export function createWebTools() {
  return {
    web_search: createWebSearchTool(),
    web_fetch: createWebFetchTool(),
  } as const
}

export type WebTools = ReturnType<typeof createWebTools>

function truncate(s: string, max = 42): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

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
      const first = truncate(queries[0]!, 42)
      if (queries.length === 1)
        return `Searched: ${first}`
      return `Searched: ${first} +${queries.length - 1} more`
    }

    case 'web_fetch': {
      const urls = args.urls as string[] | undefined
      if (!urls?.length)
        return 'Fetched page'
      if (urls.length === 1)
        return `Fetched ${truncate(stripScheme(urls[0]!), 48)}`
      const first = hostname(urls[0]!)
      if (urls.length === 2)
        return `Fetched ${first}, ${hostname(urls[1]!)}`
      return `Fetched ${first} +${urls.length - 1} more`
    }

    default:
      return `Called ${toolName}`
  }
}
