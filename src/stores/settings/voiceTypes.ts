import type { ConnectionStatus } from './types'

// ── Speech-to-Text providers ──────────────────────────────────────────────────

export type SttProvider
  = | 'openai'
    | 'deepgram'
    | 'assemblyai'
    | 'google'
    | 'azure'
    | 'custom'

export interface SttProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  language: string
  status: ConnectionStatus
  statusMessage: string
}

// ── Text-to-Speech providers ──────────────────────────────────────────────────

export type TtsProvider
  = | 'openai'
    | 'elevenlabs'
    | 'deepgram'
    | 'google'
    | 'azure'
    | 'custom'

export interface TtsProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  voice: string
  speed: number
  status: ConnectionStatus
  statusMessage: string
}

// ── Voice post-processing config ───────────────────────────────────────────

export interface VoiceProcessingConfig {
  removeFillers: boolean
  autoPunctuate: boolean
  correctBacktracks: boolean
}

export interface VoiceDictionaryEntry {
  wrong: string
  correct: string
}

export interface VoiceSnippet {
  trigger: string
  expansion: string
}
