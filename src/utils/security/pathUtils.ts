/**
 * Canonical path helpers for security checks.
 * Extracted from allowedPaths + shellMutations to avoid duplication.
 * All comparisons are slash-unified and handle Windows drives / UNC.
 */

export function trimTrailingSeparators(path: string): string {
  if (/^[a-z]:[\\/]*$/i.test(path))
    return `${path[0]}:\\`
  if (/^[/\\]{2}[^/\\]+[/\\]+[^/\\]+[/\\]*$/.test(path))
    return path.replace(/[\\/]+$/g, '')

  const trimmed = path.replace(/[\\/]+$/g, '')
  return trimmed || path
}

export function normalizeForCompare(path: string): string {
  const trimmed = trimTrailingSeparators(path)
  const unified = trimmed.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(unified) ? unified.toLowerCase() : unified
}

export function isAbsoluteInputPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

export function isWithinPath(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate)
  const normalizedParent = normalizeForCompare(parent)
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

export function relativeSegments(basePath: string, absolutePath: string): string[] {
  const normalizedBase = normalizeForCompare(basePath)
  const normalizedAbsolute = normalizeForCompare(absolutePath)
  if (!isWithinPath(normalizedAbsolute, normalizedBase))
    return []

  const relative = normalizedAbsolute.slice(normalizedBase.length).replace(/^\/+/, '')
  return relative ? relative.split('/').filter(Boolean) : []
}

export function pathBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

/**
 * Extended normalize that also collapses `.` / `..` and duplicate slashes.
 * Used by shellMutations for mutation-target resolution; kept here for sharing.
 */
export function normalizePath(p: string): string {
  const forward = p.replace(/\\/g, '/')
  const isAbsolute = forward.startsWith('/')
  const hasDrive = /^[a-z]:/i.test(forward)
  const drive = hasDrive ? forward.slice(0, 2) : ''
  const rest = hasDrive ? forward.slice(2) : forward

  const segments = rest.split('/').filter(Boolean)
  const parts: string[] = []
  for (const seg of segments) {
    if (seg === '.')
      continue
    if (seg === '..') {
      if (parts.length > 0)
        parts.pop()
      continue
    }
    parts.push(seg)
  }

  const joined = parts.join('/')
  if (hasDrive)
    return drive + (joined ? `/${joined}` : '')
  if (isAbsolute)
    return `/${joined}`
  return joined
}

export function computeRelativePath(absolute: string, base: string): string {
  const a = normalizePath(absolute)
  const b = normalizePath(base)
  if (a.toLowerCase() === b.toLowerCase())
    return ''
  if (a.toLowerCase().startsWith(`${b.toLowerCase()}/`))
    return a.slice(b.length + 1)
  return a
}
