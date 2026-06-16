export interface MDevInterleaved {
  field: 'reasoning_content' | 'reasoning_details' | string
}

export interface MDevModalities {
  input: string[]
  output: string[]
}

export interface MDevCostTier {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  reasoning?: number
  tier: {
    type: 'context'
    size: number
  }
}

export interface MDevContextOver200k {
  input?: number
  output?: number
  cache_read?: number
}

export interface MDevCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  reasoning?: number
  input_audio?: number
  output_audio?: number
  context_over_200k?: MDevContextOver200k
  tiers?: MDevCostTier[]
}

export interface MDevLimit {
  context?: number
  output?: number
  input?: number
}

export type MDevReasoningOption
  = | { type: 'effort'; values: string[] }
    | { type: 'budget_tokens'; min: number }

export interface MDevModel {
  id: string
  name: string
  family?: string
  release_date?: string
  last_updated?: string
  tool_call?: boolean
  structured_output?: boolean
  attachment?: boolean
  temperature?: boolean
  knowledge?: string
  open_weights?: boolean
  modalities?: MDevModalities
  cost?: MDevCost
  limit?: MDevLimit
  reasoning?: boolean
  reasoning_options?: MDevReasoningOption[]
  interleaved?: boolean | MDevInterleaved
  status?: 'alpha' | 'beta' | 'deprecated'
}

export interface MDevProvider {
  id: string
  name: string
  api: string
  env: string[]
  npm?: string
  doc?: string
  models: Record<string, MDevModel>
}

export type MDevData = Record<string, MDevProvider>

export interface FilterCriteria {
  toolCall?: boolean
  vision?: boolean
  structuredOutput?: boolean
  reasoning?: boolean
  minContext?: number
  maxInputCost?: number
  family?: string
}

export interface ModelCost {
  input: number | null
  output: number | null
  reasoning: number | null
  cache_read: number | null
  cache_write: number | null
  input_audio: number | null
  output_audio: number | null
  tiers: MDevCostTier[] | null
  context_over_200k: MDevContextOver200k | null
}

export interface ModelModalities {
  input: string[]
  output: string[]
}
