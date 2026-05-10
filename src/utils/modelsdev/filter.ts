import type { MDevData } from './types'
import { lookupModel } from './cache'

/**
 * Returns true if the model should be offered in the chat UI.
 * We keep any models.dev entry that can produce text output.
 */
export function isChatModel(
  data: MDevData,
  mdevId: string,
  rawModelId: string,
): boolean {
  const meta = lookupModel(data, mdevId, rawModelId)
  if (!meta)
    return false

  if (meta.status === 'deprecated')
    return false

  const outputs = meta.modalities?.output ?? []
  if (outputs.length === 0)
    return false

  return outputs.includes('text')
}
