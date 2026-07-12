export interface HighlightPart { text: string; match: boolean }

export function highlightParts(text: string, query: string): HighlightPart[] {
  if (!query)
    return [{ text, match: false }]
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1)
    return [{ text, match: false }]
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + query.length), match: true },
    { text: text.slice(idx + query.length), match: false },
  ].filter(p => p.text.length > 0)
}
