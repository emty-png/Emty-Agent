import type { Attachment } from '@/stores/chat/attachment-types'
import { IMAGE_QUALITY, isImageMime, MAX_FILE_SIZE, MAX_IMAGE_DIMENSION } from '@/stores/chat/attachment-types'

export type { Attachment }

export function makeAttachmentId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    heic: 'image/heic',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/typescript',
    jsx: 'text/jsx',
    tsx: 'text/tsx',
    vue: 'text/vue',
    py: 'text/x-python',
    rb: 'text/x-ruby',
    go: 'text/x-go',
    rs: 'text/x-rust',
    java: 'text/x-java',
    kt: 'text/x-kotlin',
    cs: 'text/x-csharp',
    cpp: 'text/x-c++',
    c: 'text/x-c',
    h: 'text/x-c',
    css: 'text/css',
    html: 'text/html',
    xml: 'text/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    toml: 'text/toml',
    csv: 'text/csv',
    sql: 'text/sql',
    sh: 'text/x-shellscript',
    log: 'text/plain',
    cfg: 'text/plain',
    ini: 'text/plain',
    env: 'text/plain',
    pdf: 'application/pdf',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function compressImageDataUrl(dataUrl: string, mimeType: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_IMAGE_DIMENSION) / width)
          width = MAX_IMAGE_DIMENSION
        }
        else {
          width = Math.round((width * MAX_IMAGE_DIMENSION) / height)
          height = MAX_IMAGE_DIMENSION
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      const targetMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
      resolve(canvas.toDataURL(targetMime, IMAGE_QUALITY))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File ${file.name} exceeds the maximum allowed size of 10MB.`))
      return
    }

    const isImage = isImageMime(file.type)
    const isText = file.type.startsWith('text/') || /\.(?:ts|js|jsx|tsx|vue|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|json|yaml|yml|toml|xml|csv|sql|sh|bash|zsh|ps1|md|mdx|txt|log|cfg|ini|env|gitignore|dockerfile|makefile)$/i.test(file.name)

    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)

    if (isImage || !isText) {
      reader.onload = async () => {
        let dataUrl = reader.result as string
        if (isImage) {
          dataUrl = await compressImageDataUrl(dataUrl, file.type)
        }
        resolve({
          id: makeAttachmentId(),
          name: file.name,
          type: isImage ? 'image' : 'file',
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        })
      }
      reader.readAsDataURL(file)
    }
    else {
      reader.onload = () => {
        resolve({
          id: makeAttachmentId(),
          name: file.name,
          type: 'file',
          mimeType: file.type || 'text/plain',
          size: file.size,
          dataUrl: reader.result as string,
        })
      }
      reader.readAsText(file)
    }
  })
}

/** Open native file dialog via Tauri and return selected files as Attachments. */
export async function openFileDialog(): Promise<Attachment[]> {
  const newAttachments: Attachment[] = []
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')

    const selected = await open({
      multiple: true,
      title: 'Upload files',
    })
    if (!selected)
      return []

    const paths = Array.isArray(selected) ? selected : [selected]
    for (const filePath of paths) {
      try {
        const bytes = await readFile(filePath)
        if (bytes.byteLength > MAX_FILE_SIZE) {
          throw new Error('File exceeds the maximum allowed size of 10MB.')
        }
        const name = filePath.split(/[\\/]/).pop() ?? 'file'
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        const mimeType = guessMimeType(ext)
        const isImage = isImageMime(mimeType)
        const isText = mimeType.startsWith('text/') || /^(?:ts|js|jsx|tsx|vue|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|json|yaml|yml|toml|xml|csv|sql|sh|bash|zsh|ps1|md|mdx|txt|log|cfg|ini|env)$/.test(ext)

        let dataUrl: string
        if (isText) {
          dataUrl = new TextDecoder().decode(bytes)
        }
        else {
          const base64 = btoa(String.fromCharCode(...bytes))
          dataUrl = `data:${mimeType};base64,${base64}`
          if (isImage) {
            dataUrl = await compressImageDataUrl(dataUrl, mimeType)
          }
        }

        newAttachments.push({
          id: makeAttachmentId(),
          name,
          type: isImage ? 'image' : 'file',
          mimeType,
          size: bytes.byteLength,
          dataUrl,
        })
      }
      catch (err) {
        console.warn('[attachments] Failed to read:', filePath, err)
      }
    }
  }
  catch (err) {
    console.warn('[attachments] File dialog error:', err)
  }
  return newAttachments
}

export async function readFileFromPath(filePath: string): Promise<Attachment> {
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(filePath)
  if (bytes.byteLength > MAX_FILE_SIZE) {
    throw new Error(`File ${filePath} exceeds the maximum allowed size of 10MB.`)
  }
  const name = filePath.split(/[\\/]/).pop() ?? 'file'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = guessMimeType(ext)
  const isImage = isImageMime(mimeType)
  const isText = mimeType.startsWith('text/')
    || /^(?:ts|js|jsx|tsx|vue|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|json|yaml|yml|toml|xml|csv|sql|sh|bash|zsh|ps1|md|mdx|txt|log|cfg|ini|env)$/.test(ext)

  let dataUrl: string
  if (isText) {
    dataUrl = new TextDecoder().decode(bytes)
  }
  else {
    const base64 = btoa(String.fromCharCode(...bytes))
    dataUrl = `data:${mimeType};base64,${base64}`
    if (isImage) {
      dataUrl = await compressImageDataUrl(dataUrl, mimeType)
    }
  }

  return {
    id: makeAttachmentId(),
    name,
    type: isImage ? 'image' : 'file',
    mimeType,
    size: bytes.byteLength,
    dataUrl,
  }
}
