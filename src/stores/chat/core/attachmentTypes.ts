/**
 * Attachment type for files/images uploaded or pasted into the chat input.
 *
 * Attachments are stored inline on the Message object (and serialised to the DB
 * as part of the message's JSON payload). Image data is kept as a base64 data URL
 * so it can be rendered anywhere without extra file-system lookups.
 */
export interface Attachment {
  /** Unique ID for keying and deduplication */
  id: string
  /** Original filename (or "Pasted image" for clipboard images) */
  name: string
  /** High-level kind — determines how we render previews */
  type: 'image' | 'file'
  /** IANA media type, e.g. "image/png", "text/plain" */
  mimeType: string
  /** File size in bytes */
  size: number
  /**
   * For images: base64 data URL (`data:image/png;base64,…`).
   * For text/code files: the raw text content.
   * For other binary files: base64 data URL.
   */
  dataUrl: string
}

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
