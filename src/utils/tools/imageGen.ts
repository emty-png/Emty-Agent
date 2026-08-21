/**
 * Image generation tool: create_image
 * Supports Google, OpenAI, Stability AI, and OpenAI-compatible providers.
 * Saves generated images as PNG files to the project workspace.
 */

import type { ImageGenProvider } from '@/stores/settings/types'
import { tool } from 'ai'
import { z } from 'zod'
import { platformFetch } from '@/utils/platformFetch'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

const GENERATION_TIMEOUT_MS = 120_000

async function resolveImageModel(provider: ImageGenProvider, modelId: string) {
  const { useSettingsStore } = await import('@/stores/settings')
  const settings = useSettingsStore()
  const config = settings.imageGen[provider]

  if (provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: config.apiKey, fetch: platformFetch as unknown as typeof fetch })
    return google.image(modelId)
  }

  if (provider === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const openai = createOpenAI({ apiKey: config.apiKey, fetch: platformFetch as unknown as typeof fetch })
    return openai.image(modelId)
  }

  if (provider === 'stability') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const stability = createOpenAICompatible({
      name: 'stability',
      apiKey: config.apiKey,
      baseURL: 'https://api.stability.ai/v2beta',
      fetch: platformFetch as unknown as typeof fetch,
    })
    return stability.imageModel(modelId)
  }

  if (provider === 'fal') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const fal = createOpenAICompatible({
      name: 'fal',
      apiKey: config.apiKey,
      baseURL: 'https://fal.run',
      fetch: platformFetch as unknown as typeof fetch,
    })
    return fal.imageModel(modelId)
  }

  if (provider === 'replicate') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const replicate = createOpenAICompatible({
      name: 'replicate',
      apiKey: config.apiKey,
      baseURL: 'https://api.replicate.com/v1',
      fetch: platformFetch as unknown as typeof fetch,
    })
    return replicate.imageModel(modelId)
  }

  if (provider === 'together') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const together = createOpenAICompatible({
      name: 'together',
      apiKey: config.apiKey,
      baseURL: 'https://api.together.xyz/v1',
      fetch: platformFetch as unknown as typeof fetch,
    })
    return together.imageModel(modelId)
  }

  if (provider === 'fireworks') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const fireworks = createOpenAICompatible({
      name: 'fireworks',
      apiKey: config.apiKey,
      baseURL: 'https://api.fireworks.ai/inference/v1',
      fetch: platformFetch as unknown as typeof fetch,
    })
    return fireworks.imageModel(modelId)
  }

  if (provider === 'custom') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    if (!config.baseURL)
      throw new Error('Custom provider base URL is not configured. Go to Settings \u2192 Providers \u2192 Image Gen Providers.')
    const custom = createOpenAICompatible({
      name: 'custom',
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: platformFetch as unknown as typeof fetch,
    })
    return custom.imageModel(modelId)
  }

  throw new Error(`Unknown image generation provider: ${provider}`)
}

function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? dataUrl
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes
}

function promptToFilename(prompt: string, index: number): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'image'}-${index + 1}.png`
}

export function createImageGenTools() {
  return {
    create_image: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.create_image,

      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe('Detailed text description of the image(s) to generate.'),
        path: z
          .string()
          .optional()
          .describe('Directory or file path to save the image(s). Relative to project root or absolute. If omitted, saves to project root with auto-generated filename.'),
        count: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .default(1)
          .describe('Number of images to generate (1-4). Default: 1.'),
        size: z
          .string()
          .optional()
          .describe('Image dimensions as "WIDTHxHEIGHT" (e.g. "1024x1024", "512x512"). Default varies by provider.'),
      }),

      execute: async ({ prompt, path, count = 1, size }) => {
        console.warn('[create_image] execute called', { prompt: prompt.slice(0, 80), path, count, size })
        const { useSettingsStore } = await import('@/stores/settings')
        const { useProjectStore } = await import('@/stores/project')
        const settings = useSettingsStore()
        const project = useProjectStore()

        const provider = settings.imageGenProvider
        const config = settings.imageGen[provider]
        console.warn('[create_image] provider:', provider, 'model:', config.model, 'hasKey:', !!config.apiKey.trim())

        if (!config.apiKey.trim() && provider !== 'custom') {
          console.warn('[create_image] abort: no API key for', provider)
          return {
            error: `No API key configured for ${provider}. Go to Settings \u2192 Providers \u2192 Image Gen Providers.`,
          }
        }

        if (!config.model.trim()) {
          console.warn('[create_image] abort: no model selected for', provider)
          return {
            error: `No model selected for ${provider}. Go to Settings \u2192 Providers \u2192 Image Gen Providers and select a model.`,
          }
        }

        // Defensive: Google API returns "models/xxx" but SDK prepends "models/" itself
        const modelId = provider === 'google' ? config.model.replace(/^models\//, '') : config.model
        console.warn('[create_image] resolving image model...', modelId)
        const model = await resolveImageModel(provider, modelId)
        console.warn('[create_image] model resolved, importing generateImage...')

        const { generateImage } = await import('ai')

        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), GENERATION_TIMEOUT_MS)

        try {
          console.warn('[create_image] calling generateImage', { prompt: prompt.slice(0, 60), n: count, size })
          const result = await generateImage({
            model,
            prompt,
            n: count,
            ...(size ? { size: size as `${number}x${number}` } : {}),
            abortSignal: ac.signal,
          })
          console.warn('[create_image] generateImage returned', { imageCount: result.images.length })

          const projectPath = project.projectPath
          if (!projectPath) {
            console.warn('[create_image] abort: no project directory open')
            return { error: 'No project directory open. Open a project first.' }
          }

          const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
          const { safePath } = await import('./fs/allowedPaths')

          let saveDir: string
          let customFilename: string | null = null

          if (path) {
            if (/\.\w+$/.test(path)) {
              customFilename = path.split(/[/\\]/).pop() ?? null
              saveDir = path.split(/[/\\]/).slice(0, -1).join('/') || '.'
            }
            else {
              saveDir = path
            }
          }
          else {
            saveDir = '.'
          }
          console.warn('[create_image] saveDir:', saveDir, 'customFilename:', customFilename)

          let absoluteDir: string
          try {
            absoluteDir = await safePath(projectPath, saveDir, { kind: 'write' })
          }
          catch (e) {
            console.warn('[create_image] safePath failed:', e)
            return { error: e instanceof Error ? e.message : 'Path is outside the project directory.' }
          }
          console.warn('[create_image] absoluteDir:', absoluteDir)

          if (!(await exists(absoluteDir))) {
            console.warn('[create_image] creating directory:', absoluteDir)
            await mkdir(absoluteDir, { recursive: true })
          }

          const savedPaths: string[] = []
          for (let i = 0; i < result.images.length; i++) {
            const imageData = result.images[i]
            if (!imageData)
              continue
            const filename = customFilename && count === 1
              ? customFilename
              : promptToFilename(prompt, i)
            const filePath = `${absoluteDir}/${filename}`
            console.warn('[create_image] saving image', i, '->', filePath, 'hasBase64:', !!imageData.base64, 'hasUint8:', !!imageData.uint8Array)

            let bytes: Uint8Array
            if (imageData.base64) {
              bytes = base64ToUint8Array(imageData.base64)
            }
            else if (imageData.uint8Array) {
              bytes = imageData.uint8Array
            }
            else {
              console.warn('[create_image] image', i, 'has no usable data, skipping')
              continue
            }

            await writeFile(filePath, bytes)
            savedPaths.push(filePath)
            console.warn('[create_image] saved', filePath, `(${bytes.length} bytes)`)
          }

          console.warn('[create_image] done:', { count: result.images.length, provider, model: config.model, paths: savedPaths })
          return {
            count: result.images.length,
            provider,
            model: config.model,
            paths: savedPaths,
          }
        }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[create_image] error:', msg, e)
          if (e instanceof Error && e.name === 'AbortError') {
            return { error: `Image generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s.` }
          }
          return { error: `Image generation failed: ${msg}` }
        }
        finally {
          clearTimeout(timer)
        }
      },
    }),
  }
}

export type ImageGenTools = ReturnType<typeof createImageGenTools>

// -- display labels --------------------------------------------------------

function truncate(s: string, max = 42): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

export function imageGenToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'create_image')
    return `Called ${toolName}`

  const count = (args.count as number | undefined) ?? 1
  const prompt = (args.prompt as string | undefined) ?? ''

  if (count === 1) {
    const snippet = truncate(prompt, 30)
    return `Created 1 Image: ${snippet}`
  }

  return `Created ${count} Images`
}
