import type { TestResult } from './types'
import { platformFetch } from '@/utils/platformFetch'

function withOptionalBearer(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}
}

function getOllamaTagsUrl(baseURL: string): string {
  const root = baseURL.replace(/\/v1\/?$/i, '').replace(/\/$/, '')
  return `${root}/api/tags`
}

export async function fetchOpenAI(baseURL: string, apiKey: string, headers?: Record<string, string>): Promise<TestResult> {
  const url = `${baseURL.replace(/\/$/, '')}/models`
  const customHeaders = headers ?? {}
  try {
    const res = await platformFetch(url, {
      method: 'GET',
      headers: {
        ...withOptionalBearer(apiKey),
        'Content-Type': 'application/json',
        ...customHeaders,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok)
      return { ok: true, message: 'Connected' }
    // 404 means the server is reachable but doesn't serve /models (e.g. gateways)
    // Since models are discovered from models.dev, this is still a successful connection
    if (res.status === 404)
      return { ok: true, message: 'Connected — no /models endpoint' }
    if (res.status === 401)
      return { ok: false, message: 'Invalid API key' }
    if (res.status === 403)
      return { ok: false, message: 'Access forbidden — check org/project permissions' }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach endpoint — check URL and network'
    return { ok: false, message: msg }
  }
}

export async function fetchAnthropic(baseURL: string, apiKey: string): Promise<TestResult> {
  const url = `${baseURL.replace(/\/$/, '')}/models`
  try {
    const res = await platformFetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok)
      return { ok: true, message: 'Connected' }
    if (res.status === 401)
      return { ok: false, message: 'Invalid API key' }
    if (res.status === 403)
      return { ok: false, message: 'Access denied — check key permissions' }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach Anthropic'
    return { ok: false, message: msg }
  }
}

export async function fetchGoogle(apiKey: string): Promise<TestResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1`
  try {
    const res = await platformFetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
    if (res.ok)
      return { ok: true, message: 'Connected' }
    if (res.status === 400)
      return { ok: false, message: 'Invalid API key format' }
    if (res.status === 403)
      return { ok: false, message: 'API key invalid or Gemini API not enabled' }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach Google'
    return { ok: false, message: msg }
  }
}

export async function fetchOllamaDownloadedModels(
  baseURL: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<TestResult & { rawModels: string[] }> {
  const url = getOllamaTagsUrl(baseURL)
  const customHeaders = headers ?? {}
  try {
    const res = await platformFetch(url, {
      method: 'GET',
      headers: {
        ...withOptionalBearer(apiKey),
        'Content-Type': 'application/json',
        ...customHeaders,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      if (res.status === 401)
        return { ok: false, message: 'Invalid API key', rawModels: [] }
      if (res.status === 403)
        return { ok: false, message: 'Access denied — check key permissions', rawModels: [] }
      return { ok: false, message: `HTTP ${res.status}: ${res.statusText}`, rawModels: [] }
    }

    const data = await res.json() as {
      models?: Array<{
        model?: string
        name?: string
      }>
    }

    const rawModels = [...new Set(
      (data.models ?? [])
        .map(model => model.model || model.name || '')
        .map(model => model.trim())
        .filter(Boolean),
    )]

    return {
      ok: true,
      message: `Connected — ${rawModels.length} downloaded models`,
      rawModels,
    }
  }
  catch (e: unknown) {
    const msg
      = e instanceof Error && e.name === 'TimeoutError'
        ? 'Request timed out (8s)'
        : 'Could not reach Ollama'
    return { ok: false, message: msg, rawModels: [] }
  }
}
