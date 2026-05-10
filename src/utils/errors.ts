import { ref } from 'vue'

export interface FatalErrorState {
  title: string
  message: string
  detail: string
  timestamp: string
  fingerprint: string
}

export interface FatalErrorOptions {
  title?: string
  context?: string
}

export const fatalError = ref<FatalErrorState | null>(null)

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error)
    return value.message
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function normalizeFatalError(
  error: unknown,
  options: FatalErrorOptions = {},
): FatalErrorState {
  const title = options.title ?? 'Something went wrong'
  const message = error instanceof Error
    ? error.message || error.name
    : stringifyUnknown(error)

  const sections = [
    `Error: ${message}`,
  ]

  if (error instanceof Error && error.stack)
    sections.push(error.stack)

  if (options.context)
    sections.push(`Context:\n${options.context}`)

  const detail = sections.join('\n\n')
  const timestamp = new Date().toLocaleString()
  const fingerprint = `${title}::${detail}`

  return {
    title,
    message,
    detail,
    timestamp,
    fingerprint,
  }
}

export function captureFatalError(
  error: unknown,
  options: FatalErrorOptions = {},
): FatalErrorState {
  const normalized = normalizeFatalError(error, options)

  if (fatalError.value?.fingerprint === normalized.fingerprint)
    return fatalError.value

  fatalError.value = normalized
  console.error('[fatal]', normalized.title, error)
  return normalized
}

export function clearFatalError(): void {
  fatalError.value = null
}

export function formatFatalErrorReport(error: FatalErrorState): string {
  return [
    error.title,
    `Occurred: ${error.timestamp}`,
    '',
    error.detail,
  ].join('\n')
}
