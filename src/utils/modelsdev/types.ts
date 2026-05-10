// eslint-disable-next-line antfu/no-import-dist
import type {
  Cost as EmtyModelsCost,
  ModelsDevData as EmtyModelsData,
  Limit as EmtyModelsLimit,
  Modalities as EmtyModelsModalities,
  Model as EmtyModelsModel,
  Provider as EmtyModelsProvider,
} from '../../../Emty models/dist/index.js'

export interface MDevInterleaved {
  field: 'reasoning_content' | 'reasoning_details' | string
}

export interface MDevModel extends Omit<EmtyModelsModel, 'interleaved'> {
  temperature?: boolean
  knowledge?: string
  open_weights?: boolean
  interleaved?: boolean | MDevInterleaved
  status?: 'alpha' | 'beta' | 'deprecated'
}

export interface MDevProvider extends Omit<EmtyModelsProvider, 'models'> {
  models: Record<string, MDevModel>
}

export type MDevData = EmtyModelsData & Record<string, MDevProvider>

export type MDevCost = EmtyModelsCost
export type MDevLimit = EmtyModelsLimit
export type MDevModalities = EmtyModelsModalities

export interface ModelCost {
  input: number | null
  output: number | null
  reasoning: number | null
}

export interface ModelModalities {
  input: string[]
  output: string[]
}
