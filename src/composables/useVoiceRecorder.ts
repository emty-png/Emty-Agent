import { ref } from 'vue'

export interface VoiceRecorderState {
  recording: boolean
  duration: number
  frequencyData: Uint8Array
}

export function useVoiceRecorder() {
  const recording = ref(false)
  const duration = ref(0)
  const frequencyData = ref(new Uint8Array(0))

  let mediaStream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let durationTimer: ReturnType<typeof setInterval> | null = null
  let rafId: number | null = null
  let startTime = 0
  let onAudioChunk: ((chunk: ArrayBuffer) => void) | null = null

  async function start(): Promise<void> {
    if (recording.value)
      return

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    })

    audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(mediaStream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 128
    source.connect(analyser)

    chunks = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    recorder = new MediaRecorder(mediaStream, { mimeType })

    recorder.ondataavailable = e => {
      if (e.data.size > 0) {
        chunks.push(e.data)
        if (onAudioChunk) {
          e.data.arrayBuffer().then(buf => {
            onAudioChunk?.(buf)
          }).catch(() => {})
        }
      }
    }

    recorder.start(250)
    recording.value = true
    startTime = Date.now()

    // Duration counter
    durationTimer = setInterval(() => {
      duration.value = (Date.now() - startTime) / 1000
    }, 100)

    // Frequency data animation loop
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    function tick() {
      if (!recording.value || !analyser)
        return
      analyser.getByteFrequencyData(dataArray)
      frequencyData.value = new Uint8Array(dataArray)
      rafId = requestAnimationFrame(tick)
    }
    tick()
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob([], { type: 'audio/webm' }))
        return
      }

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
        cleanup()
        resolve(blob)
      }

      recorder.onerror = e => {
        cleanup()
        reject(e)
      }

      recorder.stop()
    })
  }

  function cancel(): void {
    if (recorder && recorder.state !== 'inactive')
      recorder.stop()
    cleanup()
  }

  function cleanup(): void {
    recording.value = false
    duration.value = 0
    frequencyData.value = new Uint8Array(0)

    if (durationTimer) {
      clearInterval(durationTimer)
      durationTimer = null
    }
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop())
      mediaStream = null
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
      analyser = null
    }
    recorder = null
    chunks = []
    onAudioChunk = null
  }

  /** Register a callback that receives raw audio chunks as ArrayBuffer (for streaming STT). */
  function setOnAudioChunk(handler: ((chunk: ArrayBuffer) => void) | null): void {
    onAudioChunk = handler
  }

  return {
    recording,
    duration,
    frequencyData,
    start,
    stop,
    cancel,
    setOnAudioChunk,
  }
}
