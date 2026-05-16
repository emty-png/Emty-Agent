export function makeBrowserId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function isProbablyLocalHost(input: string): boolean {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(input)
}

function isUrlLike(input: string): boolean {
  return input.includes('.') || input.includes(':') || input.startsWith('www.')
}

export function normalizeBrowserUrlInput(raw: string): string {
  const input = raw.trim()
  if (!input)
    throw new Error('Browser URL is empty')

  if (input === 'about:blank')
    return input

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input))
    return input

  if (isProbablyLocalHost(input))
    return `http://${input}`

  if (isUrlLike(input))
    return `https://${input}`

  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}

export function labelFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'duckduckgo.com' && parsed.searchParams.get('q'))
      return `Search: ${parsed.searchParams.get('q')}`

    const host = parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${host}${path}` || url
  }
  catch {
    return url || 'New page'
  }
}
