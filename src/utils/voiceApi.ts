import type { SttProvider, SttProviderConfig, TtsProvider, TtsProviderConfig } from '@/stores/settings/voiceTypes'
import { platformFetch } from '@/utils/platformFetch'

// ── helpers ────────────────────────────────────────────────────────────────────

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function audioMimeType(blob: Blob): string {
  return blob.type || 'audio/webm'
}

// ── STT: transcribe ────────────────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch'))
    return true
  if (error instanceof Error && error.name === 'AbortError')
    return false
  return false
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  }
  catch (error: unknown) {
    const status = error instanceof Error
      ? Number((/\((\d+)\)/.exec(error.message))?.[1])
      : 0
    if (RETRYABLE_STATUS.has(status) || isRetryableError(error)) {
      await new Promise(r => setTimeout(r, 800))
      return fn()
    }
    throw error
  }
}

export async function transcribeAudio(blob: Blob, provider: SttProvider, config: SttProviderConfig): Promise<string> {
  return withRetry(() => transcribeAudioOnce(blob, provider, config))
}

async function transcribeAudioOnce(blob: Blob, provider: SttProvider, config: SttProviderConfig): Promise<string> {
  switch (provider) {
    case 'openai':
    case 'custom':
      return transcribeOpenAI(blob, config)
    case 'deepgram':
      return transcribeDeepgram(blob, config)
    case 'assemblyai':
      return transcribeAssemblyAI(blob, config)
    case 'google':
      return transcribeGoogle(blob, config)
    case 'azure':
      return transcribeAzure(blob, config)
    default:
      throw new Error(`Unsupported STT provider: ${provider}`)
  }
}

async function transcribeOpenAI(blob: Blob, config: SttProviderConfig): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`
  const fd = new FormData()
  fd.append('model', config.model)
  fd.append('file', blob, 'recording.webm')
  if (config.language)
    fd.append('language', config.language)

  const res = await platformFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: fd,
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI STT failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { text: string }
  return data.text
}

async function transcribeDeepgram(blob: Blob, config: SttProviderConfig): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/listen`
  const params = new URLSearchParams({ model: config.model })
  if (config.language)
    params.set('language', config.language)

  const res = await platformFetch(`${url}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Token: config.apiKey,
      'Content-Type': audioMimeType(blob),
    },
    body: blob,
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Deepgram STT failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { results: { channels: Array<{ alternatives: Array<{ transcript: string }> }> } }
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
}

async function transcribeAssemblyAI(blob: Blob, config: SttProviderConfig): Promise<string> {
  const base = config.baseUrl.replace(/\/$/, '')

  // Step 1: Upload audio
  const uploadRes = await platformFetch(`${base}/v2/upload`, {
    method: 'POST',
    headers: { Authorization: config.apiKey },
    body: blob,
    signal: AbortSignal.timeout(120000),
  })

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '')
    throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${body}`)
  }

  const { upload_url } = await uploadRes.json() as { upload_url: string }

  // Step 2: Create transcript
  const transcriptRes = await platformFetch(`${base}/v2/transcript`, {
    method: 'POST',
    headers: {
      Authorization: config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: config.language,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!transcriptRes.ok) {
    const body = await transcriptRes.text().catch(() => '')
    throw new Error(`AssemblyAI transcript failed (${transcriptRes.status}): ${body}`)
  }

  const { id } = await transcriptRes.json() as { id: string }

  // Step 3: Poll until complete
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const pollRes = await platformFetch(`${base}/v2/transcript/${id}`, {
      method: 'GET',
      headers: { Authorization: config.apiKey },
      signal: AbortSignal.timeout(10000),
    })

    if (!pollRes.ok)
      throw new Error(`AssemblyAI poll failed (${pollRes.status})`)

    const transcript = await pollRes.json() as { status: string; text?: string }
    if (transcript.status === 'completed')
      return transcript.text ?? ''
    if (transcript.status === 'error')
      throw new Error('AssemblyAI transcription failed')
  }

  throw new Error('AssemblyAI transcription timed out')
}

async function transcribeGoogle(blob: Blob, config: SttProviderConfig): Promise<string> {
  const base64Audio = await blobToBase64(blob)
  const encoding = blob.type.includes('opus') ? 'WEBM_OPUS' : blob.type.includes('mp3') ? 'MP3' : 'LINEAR16'

  const res = await platformFetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          languageCode: config.language,
          model: config.model,
        },
        audio: { content: base64Audio },
      }),
      signal: AbortSignal.timeout(60000),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google STT failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { results: Array<{ alternatives: Array<{ transcript: string }> }> }
  return data.results?.[0]?.alternatives?.[0]?.transcript ?? ''
}

async function transcribeAzure(blob: Blob, config: SttProviderConfig): Promise<string> {
  const region = config.language.replace(/-.+$/, '') || 'eastus'
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${config.language}`

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'Content-Type': audioMimeType(blob),
    },
    body: blob,
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Azure STT failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { DisplayText?: string }
  return data.DisplayText ?? ''
}

// ── TTS: synthesize ────────────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string, provider: TtsProvider, config: TtsProviderConfig): Promise<ArrayBuffer> {
  switch (provider) {
    case 'openai':
    case 'custom':
      return synthesizeOpenAI(text, config)
    case 'elevenlabs':
      return synthesizeElevenLabs(text, config)
    case 'deepgram':
      return synthesizeDeepgram(text, config)
    case 'google':
      return synthesizeGoogle(text, config)
    case 'azure':
      return synthesizeAzure(text, config)
    default:
      throw new Error(`Unsupported TTS provider: ${provider}`)
  }
}

async function synthesizeOpenAI(text: string, config: TtsProviderConfig): Promise<ArrayBuffer> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/audio/speech`

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      voice: config.voice,
      input: text,
      speed: config.speed,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI TTS failed (${res.status}): ${body}`)
  }

  return res.arrayBuffer()
}

async function synthesizeElevenLabs(text: string, config: TtsProviderConfig): Promise<ArrayBuffer> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/text-to-speech/${config.voice}`

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: config.model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${body}`)
  }

  return res.arrayBuffer()
}

async function synthesizeDeepgram(text: string, config: TtsProviderConfig): Promise<ArrayBuffer> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/speak`

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      Token: config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model: config.model,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Deepgram TTS failed (${res.status}): ${body}`)
  }

  return res.arrayBuffer()
}

async function synthesizeGoogle(text: string, config: TtsProviderConfig): Promise<ArrayBuffer> {
  const res = await platformFetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { name: config.voice, languageCode: 'en-US' },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: config.speed,
        },
      }),
      signal: AbortSignal.timeout(60000),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google TTS failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { audioContent: string }
  const binary = atob(data.audioContent)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function synthesizeAzure(text: string, config: TtsProviderConfig): Promise<ArrayBuffer> {
  const region = (config as unknown as { language?: string }).language?.replace(/-.+$/, '') || 'eastus'
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`

  const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${config.voice}'>${escapeXml(text)}</voice></speak>`

  const res = await platformFetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'Content-Type': 'application/ssml',
    },
    body: ssml,
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Azure TTS failed (${res.status}): ${body}`)
  }

  return res.arrayBuffer()
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
