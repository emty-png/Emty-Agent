// ── Sound effects (Web Audio API synthesis) ───────────────────────────────────
// All sounds are synthesised on the fly — no audio files required.
// Sounds are intentionally subtle and professional.

let _ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!_ctx || _ctx.state === 'closed')
    _ctx = new AudioContext()
  return _ctx
}

/**
 * Resolves 0-100 volume to a Web Audio gain value (0.0 – 1.0).
 * Uses a mild curve so the slider feels natural.
 */
function toGain(volume: number): number {
  const clamped = Math.max(0, Math.min(100, volume))
  return (clamped / 100) * 0.6 // cap at 0.6 to avoid being too loud
}

// ── Completion sound ─────────────────────────────────────────────────────────
// A two-note ascending chime (E5 → G#5) with a soft attack and decay.
// Duration ~0.55 s. Feels like a gentle, pleasant notification.

export function playCompletionSound(volume: number): void {
  try {
    const ctx = getCtx()
    const gain = toGain(volume)
    if (gain === 0)
      return

    const now = ctx.currentTime

    // Each note: oscillator + individual envelope
    const notes = [
      { freq: 659.25, start: 0, duration: 0.35 }, // E5
      { freq: 830.61, start: 0.17, duration: 0.38 }, // G#5
    ]

    for (const note of notes) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.freq, now + note.start)

      // Soft attack → gentle decay
      env.gain.setValueAtTime(0, now + note.start)
      env.gain.linearRampToValueAtTime(gain, now + note.start + 0.02)
      env.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration)

      osc.connect(env)
      env.connect(ctx.destination)

      osc.start(now + note.start)
      osc.stop(now + note.start + note.duration)
    }
  }
  catch {
    // Silently ignore — audio is best-effort
  }
}

// ── Error sound ──────────────────────────────────────────────────────────────
// A short descending two-tone (A4 → E4) with a harder attack.
// Duration ~0.45 s. Clearly signals "something went wrong" without being harsh.

export function playErrorSound(volume: number): void {
  try {
    const ctx = getCtx()
    const gain = toGain(volume)
    if (gain === 0)
      return

    const now = ctx.currentTime

    const notes = [
      { freq: 440.0, start: 0, duration: 0.28 }, // A4
      { freq: 329.63, start: 0.15, duration: 0.32 }, // E4
    ]

    for (const note of notes) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()

      osc.type = 'triangle' // slightly richer than sine, less harsh than square
      osc.frequency.setValueAtTime(note.freq, now + note.start)

      env.gain.setValueAtTime(0, now + note.start)
      env.gain.linearRampToValueAtTime(gain * 0.85, now + note.start + 0.015)
      env.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration)

      osc.connect(env)
      env.connect(ctx.destination)

      osc.start(now + note.start)
      osc.stop(now + note.start + note.duration)
    }
  }
  catch {
    // Silently ignore
  }
}
