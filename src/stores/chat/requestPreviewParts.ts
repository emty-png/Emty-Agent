import type { ModelMessage } from 'ai'
import type { PreviewPromptMessage, PreviewPromptPart, PreviewPromptPartText } from './requestPreview'

export function normalizeModelMessages(messages: ModelMessage[]): PreviewPromptMessage[] {
  return messages
    .map(message => {
      if (message.role === 'tool') {
        const text = serializeToolRoleContent(message.content)
        if (!text.trim())
          return null

        return {
          role: 'user' as const,
          parts: [{ type: 'text' as const, text }],
        }
      }

      return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        parts: normalizeModelContentParts(message.content),
      }
    })
    .filter((message): message is PreviewPromptMessage => message != null && message.parts.length > 0)
}

export function normalizeContentParts(content: unknown): PreviewPromptPart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }

  if (!Array.isArray(content))
    return []

  return content.flatMap((part): PreviewPromptPart[] => {
    if (typeof part !== 'object' || part == null || !('type' in part))
      return []

    if (part.type === 'text' && 'text' in part && typeof part.text === 'string')
      return [{ type: 'text', text: part.text }]

    if (part.type === 'image') {
      const imageValue = 'image' in part ? part.image : undefined
      const dataUrl = imageValue instanceof URL ? imageValue.toString() : typeof imageValue === 'string' ? imageValue : ''
      if (!dataUrl)
        return []

      return [{
        type: 'image',
        dataUrl,
        ...('mimeType' in part && typeof part.mimeType === 'string' ? { mimeType: part.mimeType } : {}),
      }]
    }

    return []
  })
}

function normalizeModelContentParts(content: unknown): PreviewPromptPart[] {
  if (typeof content === 'string')
    return normalizeContentParts(content)

  if (!Array.isArray(content))
    return []

  return content.flatMap((part): PreviewPromptPart[] => {
    if (typeof part !== 'object' || part == null || !('type' in part))
      return []

    if (part.type === 'tool-call') {
      const toolName = 'toolName' in part && typeof part.toolName === 'string'
        ? part.toolName
        : 'unknown_tool'
      const input = 'input' in part ? stringifyToolPayload(part.input) : ''
      const lines = [`[Tool call: ${toolName}]`]
      if (input)
        lines.push(`Input: ${input}`)
      return [{ type: 'text', text: lines.join('\n') }]
    }

    if (part.type === 'tool-result') {
      const toolName = 'toolName' in part && typeof part.toolName === 'string'
        ? part.toolName
        : 'unknown_tool'
      const output = 'output' in part
        ? stringifyToolPayload(part.output)
        : 'result' in part
          ? stringifyToolPayload(part.result)
          : ''
      const lines = [`[Tool result: ${toolName}]`]
      if (output)
        lines.push(output)
      return [{ type: 'text', text: lines.join('\n') }]
    }

    return normalizeContentParts([part])
  })
}

function serializeToolRoleContent(content: unknown): string {
  const parts = normalizeModelContentParts(content)
    .filter((part): part is PreviewPromptPartText => part.type === 'text' && !!part.text.trim())
    .map(part => part.text)

  return parts.join('\n')
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === 'string')
    return value

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  if (value == null)
    return ''

  if (typeof value === 'object') {
    if ('type' in value && 'value' in value) {
      const wrapped = value as { type?: unknown; value?: unknown }
      if (wrapped.type === 'text' && typeof wrapped.value === 'string')
        return wrapped.value
      return stringifyToolPayload(wrapped.value)
    }

    try {
      return JSON.stringify(value)
    }
    catch {
      return ''
    }
  }

  return String(value)
}
