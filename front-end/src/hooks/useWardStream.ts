import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Cadences offered in the simulation panel. */
export const STREAM_CADENCES = [2000, 3000, 5000] as const
const DEFAULT_CADENCE = 3000

export interface WardStream {
  streaming: boolean
  /** Completed ticks in the current run. Reset by `start`, because it is read
   *  as "how much have I sent since I pressed play" — anything that needs a
   *  change signal uses the ward's `revision` instead. */
  ticks: number
  error: string | null
  cadenceMs: number
  setCadenceMs: (ms: number) => void
  start: () => void
  stop: () => void
  clearError: () => void
  /**
   * Hold the stream for the duration of `work`, then let it continue.
   * Waits out any tick already in flight first, so `work` is not the thing
   * blocking a tick that already holds the model-thread slot.
   */
  withPause: <T>(work: () => Promise<T>) => Promise<T>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Drives the ward forward one reading at a time.
 *
 * SELF-CLOCKING, not `setInterval`. One tick is eight sequential scorings on a
 * single GPU thread and roughly two dozen Mongo round-trips behind them — call
 * it a second or two, not an instant. A fixed interval cannot know the previous
 * tick is still running, and the server single-flights `/api/ward/tick` and
 * 409s the overlap, so a stacked request would simply stop the stream.
 *
 * EPOCH-GUARDED. `stop()` cannot end a loop that is parked in `sleep()`, so a
 * pause followed by a resume inside the cadence window used to leave the old
 * loop alive and start a second one beside it — doubling the tick rate, which
 * is the exact condition this hook exists to prevent. Each loop captures an
 * epoch and exits the moment it is no longer the current one.
 */
export function useWardStream(advance: () => Promise<void>): WardStream {
  const [streaming, setStreaming] = useState(false)
  const [ticks, setTicks] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cadenceMs, setCadenceMs] = useState<number>(DEFAULT_CADENCE)

  const running = useRef(false)
  const epoch = useRef(0)
  // A DEPTH, not a flag: two things can hold the stream at once, and the first
  // to finish must not release it for the other.
  const paused = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)

  // Read through refs so changing the cadence mid-run takes effect on the next
  // tick without restarting the loop.
  const advanceRef = useRef(advance)
  advanceRef.current = advance
  const cadenceRef = useRef(cadenceMs)
  cadenceRef.current = cadenceMs

  const loop = useCallback(async (mine: number) => {
    while (epoch.current === mine) {
      // A PREVIOUS loop's tick may still be open. `stop()` ends a loop; it cannot
      // recall a request already in the air, so a Pause immediately followed by a
      // Play used to issue a second tick alongside the first. The server
      // single-flights ward operations, so that collision came back as a 409 —
      // which this loop then treated as fatal, killing the stream on a two-click
      // gesture. Wait the old one out instead.
      if (inFlight.current) {
        await inFlight.current.catch(() => undefined)
        // Yield once: awaiting a settled promise only drains microtasks, and the
        // owning loop's `finally` needs to run before we look again.
        await sleep(0)
        continue
      }
      if (paused.current > 0) {
        await sleep(100)
        continue
      }
      let tick: Promise<void> | undefined
      try {
        tick = advanceRef.current()
        inFlight.current = tick
        await tick
      } catch (failure) {
        // A tick that fails because the user stopped mid-flight is not an error
        // worth showing; anything else stops the stream rather than retrying,
        // because the plausible causes — an unseeded ward, an overlapping
        // operation, a shed request — are not fixed by an identical second call.
        if (epoch.current === mine) {
          running.current = false
          epoch.current += 1
          setStreaming(false)
          setError(failure instanceof Error ? failure.message : 'the ward stopped advancing')
        }
        return
      } finally {
        // Only if it is still OURS. Cleared unconditionally, an abandoned loop
        // wipes a newer loop's handle — `withPause` then sees nothing in flight,
        // skips its wait, and lets the 7B load race a live scoring tick on the
        // one thread that owns the GPU.
        if (tick && inFlight.current === tick) inFlight.current = null
      }
      if (epoch.current !== mine) return
      setTicks((n) => n + 1)
      await sleep(cadenceRef.current)
    }
  }, [])

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    epoch.current += 1
    setStreaming(true)
    setError(null)
    setTicks(0)
    // `paused` is deliberately untouched: a generation already holding the
    // stream must keep holding it across a start.
    void loop(epoch.current)
  }, [loop])

  const stop = useCallback(() => {
    running.current = false
    epoch.current += 1
    setStreaming(false)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const withPause = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    paused.current += 1
    try {
      // One GPU thread serves scoring and the 7B both, so these cannot overlap.
      // Waiting out the in-flight tick first means `work` queues behind one tick
      // rather than a tick queueing behind 18-23 s of generation.
      if (inFlight.current) await inFlight.current.catch(() => undefined)
      return await work()
    } finally {
      paused.current -= 1
    }
  }, [])

  // The provider wraps the router, so navigation does not unmount this — the
  // stream is meant to survive it, which is why the patient screen can pause it.
  // This is for the provider itself going away: a reload, or HMR.
  useEffect(() => () => {
    running.current = false
    epoch.current += 1
  }, [])

  return useMemo(
    () => ({
      streaming, ticks, error, cadenceMs, setCadenceMs,
      start, stop, clearError, withPause,
    }),
    [streaming, ticks, error, cadenceMs, start, stop, clearError, withPause],
  )
}
