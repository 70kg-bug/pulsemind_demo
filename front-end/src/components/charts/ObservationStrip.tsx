import { useState } from 'react'
import type { RiskBand } from '@contract/clinical'
import type { ScoreObservation } from '../../data/feed'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatClock, formatScore } from '../../lib/format'

interface ObservationStripProps {
  observations: ScoreObservation[]
  className?: string
}

/** Top lane first, so severity increases upward the way a reader expects. */
const LANES: RiskBand[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

/** Four evenly spaced slots get a timestamp; the rest would collide at this size. */
function labelledIndexes(count: number): Set<number> {
  const last = count - 1
  return new Set([0, Math.round(last / 3), Math.round((last * 2) / 3), last])
}

/**
 * Assessment history, as a log rather than a curve.
 *
 * The model has no trend inputs. Every score is computed independently from the values
 * available at that moment, so any mark-to-mark line would assert something the model
 * cannot support — that is a named safety violation, not a stylistic preference.
 *
 * Three properties make that structurally impossible here rather than merely avoided:
 *
 *   - Slots are categorical and equal-width, so there is no continuous time axis for a
 *     slope to exist on. Each slot carries its own timestamp instead.
 *   - Only the band is plotted, never the underlying score. A continuous score drawn
 *     over time is a slope waiting to be read; a sequence of band marks is a record.
 *   - Nothing connects two marks, and a refused reading leaves a visible gap rather
 *     than being bridged.
 */
export function ObservationStrip({ observations, className }: ObservationStripProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const active = hovered === null ? observations.length - 1 : hovered

  return (
    <figure className={cn('m-0', className)}>
      <div className="flex gap-3">
        {/* Lane labels. The band name is present as text on every row, so the chart
            never relies on the colour of a mark to say which band it is. */}
        <div className="flex w-14 shrink-0 flex-col justify-between py-[3px]">
          {LANES.map((band) => (
            <div key={band} className="flex h-6 items-center">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">
                {band}
              </span>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative">
            {LANES.map((band, laneIndex) => (
              <div
                key={band}
                className={cn(
                  'flex h-6 items-center border-t',
                  laneIndex === 0 ? 'border-rule' : 'border-rule-faint',
                )}
              >
                <div
                  className="grid w-full"
                  style={{
                    gridTemplateColumns: `repeat(${observations.length}, minmax(0, 1fr))`,
                  }}
                >
                  {observations.map((observation, index) =>
                    observation.band === band ? (
                      <button
                        key={index}
                        type="button"
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(index)}
                        onBlur={() => setHovered(null)}
                        className="flex items-center justify-center"
                        aria-label={`${formatClock(observation.at, false)}, ${observation.band}, score ${formatScore(observation.score)}`}
                      >
                        <span
                          className={cn(
                            'block h-[11px] w-[11px] rounded-[1px] transition-transform',
                            BAND_STYLES[band].ink,
                            'bg-current',
                            index === observations.length - 1 && 'ring-2 ring-surface',
                            index === active && 'scale-125',
                          )}
                        />
                      </button>
                    ) : (
                      <span key={index} />
                    ),
                  )}
                </div>
              </div>
            ))}
            <div className="border-t border-rule" />
          </div>

          {/* Timestamps carry the timing the categorical axis deliberately gives up.
              Only a few are drawn — enough to anchor the sequence without colliding. */}
          <div
            className="mt-1.5 grid"
            style={{ gridTemplateColumns: `repeat(${observations.length}, minmax(0, 1fr))` }}
          >
            {observations.map((observation, index) => (
              <span
                key={index}
                className={cn(
                  'text-center font-mono text-2xs tabular-nums',
                  index === active ? 'text-ink-700' : 'text-ink-300',
                )}
              >
                {labelledIndexes(observations.length).has(index)
                  ? formatClock(observation.at, false)
                  : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule-faint pt-2.5">
        <span className="text-2xs text-ink-500">
          Each score is computed independently from the values available at that moment.
          PulseMind does not use previous scores and makes no claim about direction of change.
        </span>
        {observations[active] && (
          <span className="font-mono text-2xs tabular-nums text-ink-700">
            {formatClock(observations[active].at)} · {observations[active].band} ·{' '}
            {formatScore(observations[active].score)}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
