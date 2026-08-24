/**
 * Production-ready serializer / concurrency limiter.
 *
 * Two layers:
 * 1. Global semaphore — at most `globalLimit` tool calls run concurrently across all keys.
 *    The 31st concurrent call throws `ConcurrencyLimitError` immediately (no queue).
 * 2. Per-key FIFO queue — when `exclusive:true`, calls on the same key run one-by-one
 *    in order; `exclusive:false` runs immediately (subject only to the global limit).
 *
 * No timeouts, no metrics — wait-forever as requested. Minimal deps.
 */

export class ConcurrencyLimitError extends Error {
  override name = 'ConcurrencyLimitError'
  constructor(public readonly limit: number, public readonly active: number) {
    super(`Global concurrency limit ${limit} exceeded (active: ${active})`)
  }
}

interface RunOptions {
  /** When true, calls on the same key are serialized FIFO. Default false (parallel). */
  exclusive?: boolean
  /** Optional abort signal — if aborted while queued, removes from queue and rejects. */
  signal?: AbortSignal
}

interface QueueEntry<T> {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

interface KeyState {
  queue: QueueEntry<unknown>[]
  running: boolean
}

export class Serializer {
  private readonly globalLimit: number
  private activeCount = 0
  private readonly keyStates = new Map<string, KeyState>()

  constructor(options?: { globalLimit?: number }) {
    const limit = options?.globalLimit ?? 30
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error(`globalLimit must be a positive integer, got ${limit}`)
    this.globalLimit = limit
  }

  get running(): number {
    return this.activeCount
  }

  get limit(): number {
    return this.globalLimit
  }

  get totalQueued(): number {
    let n = 0
    for (const s of this.keyStates.values())
      n += s.queue.length
    return n
  }

  private getOrCreateState(key: string): KeyState {
    let state = this.keyStates.get(key)
    if (!state) {
      state = { queue: [], running: false }
      this.keyStates.set(key, state)
    }
    return state
  }

  private tryRunNext(key: string): void {
    const state = this.keyStates.get(key)
    if (!state || state.running || state.queue.length === 0)
      return

    // Global limit check at dequeue time as well — if at limit, keep queued
    // The caller that enqueued will be rejected immediately at enqueue if over limit,
    // but activeCount may have grown due to parallel non-exclusive calls.
    if (this.activeCount >= this.globalLimit) {
      // Do not dequeue now; next release will retry
      return
    }

    const entry = state.queue.shift()!
    if (entry.signal?.aborted) {
      // Clean up abort listener
      if (entry.onAbort)
        entry.signal.removeEventListener('abort', entry.onAbort)
      entry.reject(entry.signal.reason ?? new DOMException('Aborted', 'AbortError'))
      // Try next in queue
      this.tryRunNext(key)
      // Cleanup empty state
      if (state.queue.length === 0 && !state.running)
        this.keyStates.delete(key)
      return
    }

    state.running = true
    this.activeCount++

    // Remove abort listener once running (abort during execution is caller's responsibility via fn's signal handling)
    if (entry.onAbort && entry.signal)
      entry.signal.removeEventListener('abort', entry.onAbort)

    void (async () => {
      try {
        const result = await entry.run()
        entry.resolve(result as never)
      }
      catch (e) {
        entry.reject(e)
      }
      finally {
        this.activeCount--
        state.running = false

        // Cleanup if empty
        if (state.queue.length === 0)
          this.keyStates.delete(key)
        else
          this.tryRunNext(key)

        // Opportunity: other keys may now have capacity
        // No need to scan all keys — next enqueue or release will trigger tryRunNext for relevant key
        // But global-limit-blocked queues need a nudge: scan one pending key if any
        if (this.activeCount < this.globalLimit) {
          for (const [k, st] of this.keyStates) {
            if (!st.running && st.queue.length > 0) {
              this.tryRunNext(k)
              break
            }
          }
        }
      }
    })()
  }

  /**
   * Run `fn` under the serializer.
   * - If `exclusive:false` (default), runs immediately subject only to the global 30 limit (parallel allowed).
   * - If `exclusive:true`, serializes per `key` FIFO; still respects global limit.
   * - If global limit exceeded at call time, throws `ConcurrencyLimitError` immediately.
   * - If `signal` aborts while queued, rejects and removes from queue.
   */
  run<T>(key: string, fn: () => Promise<T>, options?: RunOptions): Promise<T> {
    const exclusive = options?.exclusive ?? false
    const signal = options?.signal

    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))

    // Fast path: non-exclusive — no per-key queue, just global semaphore
    if (!exclusive) {
      if (this.activeCount >= this.globalLimit)
        return Promise.reject(new ConcurrencyLimitError(this.globalLimit, this.activeCount))

      this.activeCount++
      // Not queuing, so signal handling during run is fn's job

      return (async () => {
        try {
          return await fn()
        }
        finally {
          this.activeCount--
          // Nudge any queued exclusive waiters that were blocked by global limit
          if (this.activeCount < this.globalLimit) {
            for (const [k, st] of this.keyStates) {
              if (!st.running && st.queue.length > 0) {
                this.tryRunNext(k)
                break
              }
            }
          }
        }
      })()
    }

    // Exclusive path: per-key FIFO
    const normalizedKey = key // caller normalizes (FileLockManager does path normalization)
    const state = this.getOrCreateState(normalizedKey)

    // If nothing running and nothing queued, try to run immediately — but still respect global limit
    // Do not bypass queue if there's already a queue; must FIFO

    return new Promise<T>((resolve, reject) => {
      if (this.activeCount >= this.globalLimit && !state.running && state.queue.length === 0) {
        // Direct throw for first-queued item when at global limit — matches spec: 31st concurrent throws
        // But if we allow queuing, the 31st would wait forever; spec says throw, so throw immediately
        // Only throw if this call would exceed limit and no queue yet; queued items will be re-checked at dequeue
        // To keep spec simple: if at global limit, reject immediately even for exclusive
        this.keyStates.delete(normalizedKey) // cleanup if we just created it and not queuing
        if (state.queue.length === 0 && !state.running)
          this.keyStates.delete(normalizedKey)
        reject(new ConcurrencyLimitError(this.globalLimit, this.activeCount))
        return
      }

      const entry: QueueEntry<T> = {
        run: fn,
        resolve,
        reject,
        ...(signal !== undefined ? { signal } : {}),
      }

      if (signal) {
        const onAbort = () => {
          const idx = state.queue.indexOf(entry as QueueEntry<unknown>)
          if (idx !== -1) {
            state.queue.splice(idx, 1)
            signal.removeEventListener('abort', onAbort)
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            if (state.queue.length === 0 && !state.running)
              this.keyStates.delete(normalizedKey)
          }
        }
        entry.onAbort = onAbort
        signal.addEventListener('abort', onAbort, { once: true })
      }

      state.queue.push(entry as QueueEntry<unknown>)

      // If this is the only item and nothing running, try to run
      if (!state.running && state.queue.length === 1)
        this.tryRunNext(normalizedKey)
      // Otherwise it will run when predecessor finishes
    })
  }

  /** Alias for FS compatibility — same as `run`. */
  withLock<T>(key: string, fn: () => Promise<T>, options?: RunOptions): Promise<T> {
    return this.run(key, fn, options)
  }

  /** For tests / debug: inspect per-key queue length. */
  queuedFor(key: string): number {
    return this.keyStates.get(key)?.queue.length ?? 0
  }

  /** Clear all state — for tests only. */
  _reset(): void {
    this.keyStates.clear()
    this.activeCount = 0
  }
}

// Default shared instance used by FileLockManager wrapper (global limit 30)
export const globalSerializer = new Serializer({ globalLimit: 30 })
