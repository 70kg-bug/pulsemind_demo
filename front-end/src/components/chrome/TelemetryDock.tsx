import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Call, Span } from '../../data/telemetry'
import { clear, snapshot, subscribe } from '../../data/telemetry'

/**
 * What the system did, while it did it.
 *
 * The board shows a conclusion — a band, a rationale. This shows the work
 * behind it: which service was called, how long each stage of the pipeline
 * took, and where the time actually went. Every figure is measured by the tier
 * that did the work and travels back on a W3C `Server-Timing` header; nothing
 * here is estimated, and nothing is computed from a number the browser
 * happened to have.
 *
 * ⚠️ A STAGE THAT DID NOT RUN IS ABSENT, NEVER ZERO. A `0 ms` beside a stage
 * name is indistinguishable from a real measurement of a fast stage, so a
 * failed or skipped measurement would read as a successful one — which is the
 * same defect as a defaulted clinician name in an audit record (PM-CLIN-001).
 *
 * ⚠️ NO RESPONSE BODY REACHES THIS COMPONENT. The store holds route templates
 * and durations and nothing else, so the generated explanation cannot appear
 * here even by mistake (PM-LOG-003).
 */

/**
 * The span tree, as the request actually nests.
 *
 * Drawn flat, these would read as consecutive steps and their durations would
 * appear to sum — but `upstream` CONTAINS every model-service stage and `total`
 * contains `upstream`. Indentation is not decoration here; it is the difference
 * between "generation took 26 s of a 26 s request" and "something took 52 s".
 *
 * `kind` separates the five published pipeline stages (docs figure 3) from the
 * transport and storage around them. A queue wait is not a stage of clinical
 * reasoning and must not be shown as one.
 */
const TREE: { name: string; label: string; indent: number; kind: 'infra' | 'stage' }[] = [
  { name: 'total', label: 'API · Node/Express', indent: 0, kind: 'infra' },
  { name: 'upstream', label: 'model service · FastAPI', indent: 1, kind: 'infra' },
  { name: 'queue', label: 'waiting for the model thread', indent: 2, kind: 'infra' },
  { name: 'collect', label: '1 · Collect', indent: 2, kind: 'stage' },
  { name: 'order', label: '2 · Order in time', indent: 2, kind: 'stage' },
  { name: 'assess', label: '3 · Assess — booster + calibration', indent: 2, kind: 'stage' },
  { name: 'decide', label: '4 · Decide the level — hysteresis', indent: 2, kind: 'stage' },
  { name: 'rank', label: '5 · Explain — rank the reasons', indent: 2, kind: 'stage' },
  { name: 'floor', label: '5 · Explain — sufficiency floor', indent: 2, kind: 'stage' },
  { name: 'baseline', label: '5 · Explain — deterministic template', indent: 2, kind: 'stage' },
  { name: 'load', label: '5 · Explain — load the weights', indent: 2, kind: 'stage' },
  { name: 'explain', label: '5 · Explain — write the rationale', indent: 2, kind: 'stage' },
  { name: 'ground', label: '5 · Explain — check every sentence', indent: 2, kind: 'stage' },
  { name: 'mongo', label: 'MongoDB Atlas', indent: 1, kind: 'infra' },
]

/** Entries that carry no duration: an observation, not a measurement. */
const NOTES: Record<string, string> = {
  depth: 'model queue on arrival',
  refused: 'refused',
}

function duration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`
  if (ms >= 10) return `${Math.round(ms)}ms`
  if (ms >= 0.1) return `${ms.toFixed(1)}ms`
  // ⚠️ A REAL MEASUREMENT MUST NEVER RENDER AS `0.0ms`. The deterministic
  // template takes about 0.05 ms and rounded to exactly that on screen — and
  // this panel draws a stage that did not run as *absent*, so a zero is the one
  // value a reader would read as something else entirely. Keeping the data
  // honest is not enough if the formatter throws the distinction away.
  return '<0.1ms'
}

function clock(at: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
    + `.${pad(at.getMilliseconds(), 3)}`
}

function SpanRows({ call }: { call: Call }) {
  const byName = new Map(call.spans.map((s) => [s.name, s]))
  // The client round trip is the outermost thing actually measured, so it is
  // what every bar is a fraction of. Server spans can only be smaller.
  const scale = call.clientMs ?? 0

  const rows = TREE.filter((row) => byName.get(row.name)?.ms !== undefined)
  const notes = call.spans.filter((s) => s.ms === undefined && NOTES[s.name])

  if (!rows.length && !notes.length) {
    return (
      <p className="px-3 py-2 text-2xs text-chrome-ink-dim">
        {call.status === undefined
          ? 'In flight — the response carries the timings.'
          : 'No timings on this response.'}
      </p>
    )
  }

  return (
    <ul className="py-1">
      <li className="flex items-center gap-2 px-3 py-0.5 font-mono text-2xs tabular-nums">
        <span className="min-w-0 flex-1 truncate text-chrome-ink">browser round trip</span>
        <span className="w-20 shrink-0 text-right text-chrome-ink">
          {call.clientMs === undefined ? '—' : duration(call.clientMs)}
        </span>
      </li>
      {rows.map((row) => {
        const span = byName.get(row.name) as Span
        const ms = span.ms as number
        return (
          <li
            key={row.name}
            className="flex items-center gap-2 px-3 py-0.5 font-mono text-2xs tabular-nums"
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                row.kind === 'stage' ? 'text-chrome-ink' : 'text-chrome-ink-dim',
              )}
              style={{ paddingLeft: `${row.indent * 0.85}rem` }}
            >
              {row.label}
              {span.desc && <span className="text-chrome-ink-dim"> · {span.desc}</span>}
            </span>
            {/* Proportional, and deliberately so: a 26 s generation beside a 2 ms
                band decision makes the second invisible, which is the true
                shape of this pipeline. The figure is always printed. */}
            <span className="hidden h-1 w-24 shrink-0 bg-chrome-ink/10 sm:block">
              <span
                className={cn(
                  'block h-full',
                  row.kind === 'stage' ? 'bg-accent' : 'bg-chrome-ink/45',
                )}
                style={{ width: scale > 0 ? `${Math.min(100, (ms / scale) * 100)}%` : '0%' }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-chrome-ink">{duration(ms)}</span>
          </li>
        )
      })}
      {notes.map((span) => (
        <li
          key={span.name}
          className="flex items-center gap-2 px-3 py-0.5 font-mono text-2xs text-chrome-ink-dim"
        >
          <span className="min-w-0 flex-1 truncate">
            {NOTES[span.name]}
            {span.desc ? ` · ${span.desc}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TelemetryDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const calls = useSyncExternalStore(subscribe, snapshot)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Follow the newest call unless a specific one is being read. Without this
  // the panel is empty until someone clicks, which during a live stream is the
  // one moment nobody has a hand free.
  const selected = calls.find((c) => c.id === selectedId) ?? calls[0]

  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  if (!open) return null

  return (
    <section
      aria-label="Pipeline activity"
      className="shrink-0 border-t border-chrome-rule bg-chrome text-chrome-ink"
    >
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="flex items-center gap-3 py-1.5">
          <span className="text-2xs font-semibold uppercase tracking-[0.09em] text-chrome-ink-dim">
            Pipeline activity
          </span>
          <span className="font-mono text-2xs tabular-nums text-chrome-ink-dim">
            {calls.length} call{calls.length === 1 ? '' : 's'}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-2xs text-chrome-ink-dim lg:inline">
            Every duration is measured by the tier that did the work and returned on a
            Server-Timing header
          </span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-2xs text-chrome-ink-dim underline underline-offset-2 hover:text-chrome-ink"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pipeline activity"
            className="shrink-0 text-chrome-ink-dim hover:text-chrome-ink"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        {/* Tall enough that a whole tick fits without scrolling: eleven span rows
            plus the route line. At h-44 the last two stages sat below the fold,
            which on a pipeline panel is the opposite of the point. */}
        <div className="flex h-52 flex-col gap-px border-t border-chrome-rule/60 md:flex-row md:gap-4">
          <ul className="min-h-0 flex-1 overflow-y-auto md:max-w-[26rem]">
            {calls.length === 0 && (
              <li className="px-1 py-2 text-2xs text-chrome-ink-dim">
                Nothing yet. Stream the ward, or open a patient.
              </li>
            )}
            {calls.map((call) => (
              <li key={call.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(call.id)}
                  aria-current={selected?.id === call.id}
                  className={cn(
                    'flex w-full items-center gap-2 border-t border-rule-faint/30 px-1 py-1 text-left',
                    'font-mono text-2xs tabular-nums transition-colors',
                    selected?.id === call.id
                      ? 'bg-chrome-ink/10 text-chrome-ink'
                      : 'text-chrome-ink-dim hover:text-chrome-ink',
                  )}
                >
                  <span className="shrink-0">{clock(call.at)}</span>
                  <span className="w-9 shrink-0">{call.method}</span>
                  <span className="min-w-0 flex-1 truncate">{call.route}</span>
                  <span
                    className={cn(
                      'w-8 shrink-0 text-right',
                      call.failed && 'text-band-critical-edge',
                    )}
                  >
                    {call.status ?? '···'}
                  </span>
                  <span className="w-16 shrink-0 text-right">
                    {call.clientMs === undefined ? '' : duration(call.clientMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-chrome-rule/60 md:border-l md:border-t-0">
            {selected
              ? (
                <>
                  <p className="px-3 pt-2 font-mono text-2xs text-chrome-ink-dim">
                    {selected.method} {selected.route}
                    {selected.requestId && (
                      // The same id Node logs and the model service echoes:
                      // one request, one identifier, across three processes.
                      <span> · {selected.requestId.slice(0, 8)}</span>
                    )}
                  </p>
                  <SpanRows call={selected} />
                </>
              )
              : (
                <p className="px-3 py-2 text-2xs text-chrome-ink-dim">
                  Select a call to see where its time went.
                </p>
              )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** The control that opens the dock. Lives in the prototype feed bar, so the
 *  dock costs no vertical space at all while it is closed — the board is fitted
 *  to exactly one screen and a second permanent chrome band would take a bed. */
export function TelemetryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const calls = useSyncExternalStore(subscribe, snapshot)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-[2px] border px-2 py-1 text-2xs',
        'font-medium transition-colors',
        open
          ? 'border-chrome-ink text-chrome-ink'
          : 'border-chrome-rule text-chrome-ink-dim hover:text-chrome-ink',
      )}
    >
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className={cn('transition-transform', !open && '-rotate-90')}
      />
      Pipeline
      {calls.length > 0 && (
        <span className="font-mono tabular-nums text-chrome-ink-dim">{calls.length}</span>
      )}
    </button>
  )
}
