/**
 * WebSocket-based streaming speech-to-text.
 * Supports Deepgram Live API for real-time transcription.
 * Falls back to batch mode for providers without WebSocket support.
 */

import type { SttProvider, SttProviderConfig } from '@/stores/settings/voiceTypes'

export interface StreamingTranscriptEvent {
  text: string
  isFinal: boolean
  speechFinal?: boolean
}

export type StreamingTranscriptCallback = (event: StreamingTranscriptEvent) => void

// ── Provider streaming support check ────────────────────────────────────────

const STREAMING_PROVIDERS: Set<SttProvider> = new Set(['deepgram'])

export function isStreamingSupported(provider: SttProvider): boolean {
  return STREAMING_PROVIDERS.has(provider)
}

// ── Deepgram Live WebSocket ─────────────────────────────────────────────────

class DeepgramLiveStream {
  private ws: WebSocket | null = null
  private onTranscript: StreamingTranscriptCallback
  private onError: ((error: Error) => void) | null = null
  private baseUrl: string
  private apiKey: string
  private model: string
  private language: string

  constructor(config: SttProviderConfig, onTranscript: StreamingTranscriptCallback) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this.language = config.language
    this.onTranscript = onTranscript
  }

  connect(): void {
    const wsUrl = this.baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')
    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      interim_results: 'true',
      endpointing: '300',
      smart_format: 'true',
      punctuate: 'true',
      utterance_end_ms: '1000',
      token: this.apiKey,
    })

    this.ws = new WebSocket(`${wsUrl}/v1/listen?${params.toString()}`)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      // Connection ready — audio can be sent
    }

    this.ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string')
        return
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>
        if (msg.type === 'Results') {
          const channel = (msg.channel as Record<string, unknown>) || {}
          const alternatives = (channel.alternatives as Array<Record<string, unknown>>) || []
          const alt = alternatives[0]
          if (!alt)
            return
          const transcript = (alt.transcript as string) || ''
          if (!transcript)
            return
          this.onTranscript({
            text: transcript,
            isFinal: msg.is_final === true,
            speechFinal: msg.speech_final === true,
          })
        }
        else if (msg.type === 'UtteranceEnd') {
          // Silence detected — emit final
          this.onTranscript({ text: '', isFinal: true, speechFinal: true })
        }
      }
      catch {
        // Ignore malformed messages
      }
    }

    this.ws.onerror = () => {
      this.onError?.(new Error('WebSocket connection error'))
    }

    this.ws.onclose = () => {
      this.ws = null
    }
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(chunk)
  }

  close(): void {
    if (this.ws) {
      // Send close message per Deepgram protocol
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
      this.ws.close()
      this.ws = null
    }
  }

  setOnError(handler: (error: Error) => void): void {
    this.onError = handler
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface VoiceStreamSession {
  sendAudio: (chunk: ArrayBuffer) => void
  close: () => void
  /** Accumulated final transcript text */
  finalTranscript: string
}

/**
 * Start a streaming STT session. Returns a handle to send audio chunks.
 * The onTranscript callback fires for each interim/final result.
 */
export function startStreamingSession(
  provider: SttProvider,
  config: SttProviderConfig,
  onTranscript: StreamingTranscriptCallback,
): VoiceStreamSession | null {
  if (!isStreamingSupported(provider))
    return null

  if (provider === 'deepgram') {
    const session: VoiceStreamSession = {
      finalTranscript: '',
      sendAudio(_chunk: ArrayBuffer) {},
      close() {},
    }

    const stream = new DeepgramLiveStream(config, event => {
      onTranscript(event)
      if (event.isFinal)
        session.finalTranscript += (session.finalTranscript ? ' ' : '') + event.text
    })

    stream.setOnError(() => {
      // On error, close gracefully — caller will fall back to batch
      session.close()
    })

    stream.connect()
    session.sendAudio = chunk => stream.sendAudio(chunk)
    session.close = () => stream.close()

    return session
  }

  return null
}
