/**
 * What the system actually did, as it did it.
 *
 * Every API call the dashboard makes is recorded here with the durations each
 * tier measured for itself, so the pipeline behind a risk band can be watched
 * rather than described. The board shows a conclusion; this shows the work.
 *
 * A MODULE, NOT A CONTEXT. `feed.ts` is where every request goes through, and
 * it is not a React module -- it cannot import a hook. A plain observable store
 * read through `useSyncExternalStore` lets the one choke point stay ordinary
 * TypeScript while the panel still re-renders.
 *
 * ⚠️ NOTHING FROM A RESPONSE BODY IS STORED HERE. Method, route template,
 * status, request id and timings, and that is the whole shape. The explanation
 * is prose about one patient's physiology and is the single most tempting thing
 * to keep while debugging a grounding failure (PM-LOG-003) -- so the buffer is
 * built so that it cannot hold it, rather than trusted not to.
 */

/** One span as some tier measured it. `ms` is absent when the entry is an
 *  observation rather than a duration -- a queue depth, a model id. It is never
 *  0 standing in for "not measured": a stage that did not run has no span. */
export interface Span {
  name: string
  ms?: number
  desc?: string
}

export interface Call {
  /** Monotonic within a session; the key React needs and the clock does not give. */
  id: number
  /** Wall clock at which the request was issued. */
  at: Date
  method: 'GET' | 'POST'
  /**
   * The ROUTE TEMPLATE, never the resolved path. Our URLs carry patient
   * identifiers and this one renders on a screen someone may be recording.
   * The server logs the same way and for the same reason (PM-LOG-001).
   */
  route: string
  /** Absent while the call is still in flight. */
  status?: number
  /** Round trip as the browser saw it: always at least the server's `total`. */
  clientMs?: number
  /** From `X-Request-Id` — the same id Node logs and FastAPI now echoes. */
  requestId?: string
  /** Parsed from `Server-Timing`, in the order the tiers emitted them. */
  spans: Span[]
  /** Set when the request threw or answered non-2xx. Never the response body. */
  failed?: boolean
}

/** Bounded: a demo left streaming at a 2 s cadence issues a call every couple of
 *  seconds for as long as it runs, and an unbounded log is a leak with a nice UI. */
const LIMIT = 200

let calls: Call[] = []
let nextId = 1
const listeners = new Set<() => void>()

const emit = () => {
  // A NEW ARRAY EVERY TIME. `useSyncExternalStore` compares snapshots by
  // identity, so mutating in place would update the buffer and never the screen.
  calls = calls.slice(0, LIMIT)
  listeners.forEach((fn) => fn())
}

export const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const snapshot = () => calls

export const clear = () => {
  calls = []
  emit()
}

/**
 * Parse a `Server-Timing` header into spans.
 *
 * Hand-written rather than via `PerformanceResourceTiming.serverTiming`: that
 * reads from a resource entry which has to be located by URL after the fact,
 * and the URLs here carry patient ids. Reading the header off the response the
 * call already holds is both simpler and keeps the identifier out of the lookup.
 *
 * Only same-origin makes this readable at all; `/api` is origin-relative through
 * the Vite proxy, which is what makes it work in development.
 */
export function parseServerTiming(header: string | null): Span[] {
  if (!header) return []
  const spans: Span[] = []
  // Split on commas that are not inside a quoted desc.
  for (const raw of header.match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) ?? []) {
    const parts = raw.trim().split(';')
    const name = parts.shift()?.trim()
    if (!name) continue
    const span: Span = { name }
    for (const part of parts) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      const key = part.slice(0, eq).trim().toLowerCase()
      let value = part.slice(eq + 1).trim()
      if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1')
      if (key === 'dur') {
        const ms = Number(value)
        // NaN would render as a plausible-looking blank. An unparseable
        // duration is a missing measurement, and missing is a state the panel
        // draws differently from zero.
        if (Number.isFinite(ms)) span.ms = ms
      } else if (key === 'desc') {
        span.desc = value
      }
    }
    spans.push(span)
  }
  return spans
}

/** Record a call as it is issued. Returns the settle callback. */
export function begin(method: 'GET' | 'POST', route: string) {
  const call: Call = { id: nextId++, at: new Date(), method, route, spans: [] }
  calls = [call, ...calls]
  emit()

  return (result: { status?: number; headers?: Headers; clientMs: number; failed?: boolean }) => {
    // Replaced rather than mutated, for the same identity reason as `emit`.
    const settled: Call = {
      ...call,
      status: result.status,
      clientMs: result.clientMs,
      failed: result.failed,
      requestId: result.headers?.get('X-Request-Id') ?? undefined,
      spans: parseServerTiming(result.headers?.get('Server-Timing') ?? null),
    }
    calls = calls.map((c) => (c.id === call.id ? settled : c))
    emit()
  }
}
