export interface MDevInterleaved {
  field: 'reasoning_content' | 'reasoning_details' | string
}

export interface MDevModalities {
  input: string[]
  output: string[]
}

export interface MDevCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  reasoning?: number
}

export interface MDevLimit {
  context?: number
  output?: number
  input?: number
}

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
}

export interface ModelModalities {
  input: string[]
  output: string[]
}
