/**
 * Voice Activity Detection (VAD) composable.
 * Analyzes frequency data from useVoiceRecorder to detect speech vs silence.
 */

import { ref, watch } from 'vue'

export interface VoiceActivityConfig {
  /** RMS threshold to consider audio as speech (0–1). */
  noiseGateThreshold: number
  /** How long silence must last before auto-pause (ms). */
  silenceThresholdMs: number
}

const DEFAULT_CONFIG: VoiceActivityConfig = {
  noiseGateThreshold: 0.08,
  silenceThresholdMs: 4000,
}

export function useVoiceActivity(
  frequencyData: ReturnType<typeof ref<Uint8Array>>,
  isRecording: ReturnType<typeof ref<boolean>>,
  config: Partial<VoiceActivityConfig> = {},
) {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const isSpeaking = ref(false)
  const silenceDuration = ref(0)
  const rmsLevel = ref(0)

  let silenceStart = 0
  let wasSpeaking = false

  watch([frequencyData, isRecording], ([data, recording]) => {
    if (!recording) {
      reset()
      return
    }

    if (!data || data.length === 0) {
      silenceDuration.value = 0
      rmsLevel.value = 0
      return
    }

    // Compute RMS level from frequency data
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const normalized = data[i]! / 255
      sum += normalized * normalized
    }
    const rms = Math.sqrt(sum / data.length)
    rmsLevel.value = rms

    const speaking = rms >= cfg.noiseGateThreshold
    isSpeaking.value = speaking

    if (speaking) {
      wasSpeaking = true
      silenceStart = 0
      silenceDuration.value = 0
    }
    else if (wasSpeaking) {
      if (silenceStart === 0)
        silenceStart = Date.now()
      silenceDuration.value = Date.now() - silenceStart
    }
  })

  function reset(): void {
    isSpeaking.value = false
    silenceDuration.value = 0
    rmsLevel.value = 0
    silenceStart = 0
    wasSpeaking = false
  }

  /** Check if silence threshold has been exceeded. Call this from a timer or watch. */
  const isSilenceExpired = ref(false)

  watch(silenceDuration, d => {
    isSilenceExpired.value = d >= cfg.silenceThresholdMs
  })

  return {
    isSpeaking,
    silenceDuration,
    isSilenceExpired,
    rmsLevel,
  }
}
