import type { InputSource, ParameterHistoryPoint } from '@contract/clinical'
import type { ParameterDefinition } from '../../data/parameters'
import { formatClock } from '../../lib/format'

interface ProvenanceTraceProps {
  history: ParameterHistoryPoint[]
  definition: ParameterDefinition
}

/** Stroke colour per provenance. Read from the tokens at render so the theme follows. */
const STROKE: Record<InputSource, string> = {
  measured: 'var(--prov-measured)',
  carried_forward: 'var(--prov-carried)',
  population_reference: 'var(--prov-default)',
}

/**
 * One parameter's charting history.
 *
 * The path is stepped, and here that is truthful rather than a compromise: a
 * carried-forward value genuinely does hold flat until it is remeasured, so a
 * horizontal run is a fact about the record. This is the opposite of the risk-score
 * history, where nothing holds between observations and any connecting line would be
 * an invention.
 *
 * Colour carries provenance, not slope. What this chart shows is when a value was
 * measured, reused or defaulted — not a clinical trend.
 */
export function ProvenanceTrace({ history, definition }: ProvenanceTraceProps) {
  if (history.length < 2) {
    return (
      <p className="py-8 text-center text-2xs text-ink-500">
        No charting history for this parameter.
      </p>
    )
  }

  const [low, high] = definition.displayRange
  const toX = (index: number) => (index / (history.length - 1)) * 100
  const toY = (value: number) => (1 - (value - low) / (high - low)) * 100

  // One segment per adjacent pair, coloured by the provenance of the point it lands on.
  const segments = history.slice(1).map((point, index) => {
    const previous = history[index]
    return {
      key: point.assessed_at,
      source: point.source,
      d: `M ${toX(index)},${toY(previous.value)} L ${toX(index + 1)},${toY(previous.value)} L ${toX(index + 1)},${toY(point.value)}`,
    }
  })

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        <div className="flex w-10 shrink-0 flex-col-reverse justify-between py-[1px] text-right">
          {ticks.map((fraction) => (
            <span key={fraction} className="font-mono text-2xs tabular-nums text-ink-400">
              {(low + (high - low) * fraction).toFixed(definition.decimals)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-44 border-b border-l border-rule">
            {ticks.slice(1).map((fraction) => (
              <span
                key={fraction}
                className="absolute inset-x-0 border-t border-rule-faint"
                style={{ bottom: `${fraction * 100}%` }}
              />
            ))}

            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              role="img"
              aria-label={`${definition.label} charting history, coloured by provenance`}
            >
              {segments.map((segment) => (
                <path
                  key={segment.key}
                  d={segment.d}
                  fill="none"
                  stroke={STROKE[segment.source]}
                  strokeWidth={segment.source === 'carried_forward' ? 1.2 : 1.7}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="miter"
                />
              ))}

            </svg>

            {/* Markers sit outside the SVG. The path is drawn in a non-uniformly scaled
                coordinate space, which would stretch a circle into an ellipse. */}
            {history.map((point, index) =>
              point.source === 'measured' || index === history.length - 1 ? (
                <span
                  key={point.assessed_at}
                  className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]"
                  style={{
                    left: `${toX(index)}%`,
                    top: `${toY(point.value)}%`,
                    borderColor: STROKE[point.source],
                    background:
                      point.source === 'carried_forward' ? 'var(--surface)' : STROKE[point.source],
                  }}
                />
              ) : null,
            )}
          </div>

          <div className="mt-1.5 flex justify-between font-mono text-2xs tabular-nums text-ink-400">
            <span>{formatClock(new Date(history[0].assessed_at), false)}</span>
            <span>{formatClock(new Date(history[history.length - 1].assessed_at), false)}</span>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule-faint pt-2.5">
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4" style={{ background: STROKE.measured }} />
          <span className="text-xs text-ink-500">Measured</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4" style={{ background: STROKE.carried_forward }} />
          <span className="text-xs text-ink-500">Carried forward</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4" style={{ background: STROKE.population_reference }} />
          <span className="text-xs text-ink-500">Population default</span>
        </span>
        <span className="min-w-0 flex-1 text-right text-xs text-ink-400">
          Shows when each value was measured, reused or defaulted — not a clinical trend.
        </span>
      </figcaption>
    </figure>
  )
}
