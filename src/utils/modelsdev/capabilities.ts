import type { MDevData } from './types'
import { lookupModel } from './cache'

/**
 * Returns true when models.dev marks a model as reasoning-capable.
 */
export function supportsReasoning(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)
  return Boolean(meta?.reasoning || meta?.interleaved)
}

/**
 * Returns true when models.dev marks a model as tool-call capable.
 */
export function supportsToolCalls(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  return Boolean(lookupModel(data, mdevId, rawModelId)?.tool_call)
}

/**
 * Returns true for models that accept richer non-text input like images or PDFs.
 */
export function supportsAttachments(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)

  if (meta?.attachment !== undefined)
    return Boolean(meta.attachment)

  return Boolean(meta?.modalities?.input?.some(modality => modality !== 'text'))
}

/**
 * Returns true when models.dev explicitly marks the model as supporting
 * structured / JSON output.
 */
export function supportsStructuredOutput(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  return Boolean(lookupModel(data, mdevId, rawModelId)?.structured_output)
}

/**
 * Returns true unless models.dev explicitly disables temperature control.
 */
export function supportsTemperature(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  return lookupModel(data, mdevId, rawModelId)?.temperature !== false
}
