/**
 * Attachment type for files/images uploaded or pasted into the chat input.
 *
 * Attachments are stored inline on the Message object and serialized to the DB
 * as part of the message JSON payload. Image data is kept as a base64 data URL
 * so it can be rendered anywhere without extra file-system lookups.
 */
export const BROWSER_ELEMENT_ATTACHMENT_MIME = 'application/vnd.emty.browser-element+json'

export interface BrowserElementInfo {
  tag: string
  id: string | null
  classes: string[]
  name: string | null
  role: string | null
  ariaLabel: string | null
  selector: string
  selectorHint: string
  text: string
  href: string | null
  attributes: Record<string, string>
  outerHTML: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface BrowserElementAttachmentData {
  id: string
  comment: string
  url: string
  title: string
  createdAt: number
  element: BrowserElementInfo
}

interface BaseAttachment {
  /** Unique ID for keying and deduplication */
  id: string
  /** Original filename (or "Pasted image" for clipboard images) */
  name: string
  /** High-level kind - determines how we render previews */
  type: 'image' | 'file' | 'browser-element'
  /** IANA media type, e.g. "image/png", "text/plain" */
  mimeType: string
  /** File size in bytes */
  size: number
  /**
   * For images: base64 data URL.
   * For text/code files: the raw text content.
   * For browser elements: serialized BrowserElementAttachmentData JSON.
   * For other binary files: base64 data URL.
   */
  dataUrl: string
}

export interface FileAttachment extends BaseAttachment {
  type: 'image' | 'file'
}

export interface BrowserElementAttachment extends BaseAttachment {
  type: 'browser-element'
  mimeType: typeof BROWSER_ELEMENT_ATTACHMENT_MIME
  element: BrowserElementAttachmentData
}

export type Attachment = FileAttachment | BrowserElementAttachment

/** Maximum allowed file size for any attachment (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/** Maximum dimension (width or height) for image attachments before downscaling */
export const MAX_IMAGE_DIMENSION = 2048

/** JPEG/WebP quality factor when compressing images */
export const IMAGE_QUALITY = 0.90

/** Well-known image MIME types that we render as thumbnail previews. */
export const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/ico',
  'image/x-icon',
])

/** Check whether a MIME type should be treated as an image attachment. */
export function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase())
}

export function isBrowserElementAttachment(att: Attachment): att is BrowserElementAttachment {
  return att.type === 'browser-element' || att.mimeType === BROWSER_ELEMENT_ATTACHMENT_MIME
}

export function parseBrowserElementAttachment(att: Attachment): BrowserElementAttachmentData | null {
  if (!isBrowserElementAttachment(att))
    return null

  if ('element' in att && att.element)
    return att.element

  try {
    return JSON.parse(att.dataUrl) as BrowserElementAttachmentData
  }
  catch {
    return null
  }
}

function makeBrowserAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `browser-element-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBrowserElementAttachment(data: BrowserElementAttachmentData): BrowserElementAttachment {
  const serialized = JSON.stringify(data)
  return {
    id: data.id || makeBrowserAttachmentId(),
    name: data.element.text
      ? `Comment on ${data.element.tag}: ${data.element.text.slice(0, 40)}`
      : `Comment on <${data.element.tag}>`,
    type: 'browser-element',
    mimeType: BROWSER_ELEMENT_ATTACHMENT_MIME,
    size: new TextEncoder().encode(serialized).length,
    dataUrl: serialized,
    element: data,
  }
}

/** Format byte size to human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
