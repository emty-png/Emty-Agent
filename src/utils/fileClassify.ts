import { readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { hasBinaryExtension } from '@/utils/tools/fs/allowedPaths'

// ── file type classification ─────────────────────────────────────────────────

export type FileDisplayType = 'text' | 'image' | 'svg' | 'binary'

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'tiff', 'heic', 'heif'])

export function classifyFile(path: string): FileDisplayType {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'svg')
    return 'svg'
  if (IMAGE_EXTENSIONS.has(ext))
    return 'image'
  if (hasBinaryExtension(path))
    return 'binary'
  return 'text'
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function guessImageMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
    svg: 'image/svg+xml',
  }
  return map[ext] ?? 'application/octet-stream'
}

// ── file content loading ─────────────────────────────────────────────────────

export interface FileLoadResult {
  content: string | null
  imageDataUrl: string | null
}

export async function loadFileContent(path: string): Promise<FileLoadResult> {
  const type = classifyFile(path)

  if (type === 'binary')
    return { content: null, imageDataUrl: null }

  if (type === 'image') {
    const bytes = await readFile(path)
    return { content: null, imageDataUrl: bytesToDataUrl(bytes, guessImageMimeType(path)) }
  }

  if (type === 'svg') {
    const [text, bytes] = await Promise.all([
      readTextFile(path),
      readFile(path),
    ])
    return { content: text, imageDataUrl: bytesToDataUrl(bytes, 'image/svg+xml') }
  }

  return { content: await readTextFile(path), imageDataUrl: null }
}
