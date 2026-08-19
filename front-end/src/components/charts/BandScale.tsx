import type { RiskBand } from '@contract/clinical'
import { BANDS } from '../../data/bands'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatScore } from '../../lib/format'

interface BandScaleProps {
  score: number
  band: RiskBand
  className?: string
}

/** The LOW and MEDIUM segments are narrow, so their labels are abbreviated to fit. */
const SHORT_LABEL: Record<RiskBand, string> = {
  LOW: 'LOW',
  MEDIUM: 'MED',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
}

/**
 * Where this score sits across the whole scale.
 *
 * Segment widths are the real calibrated cut points: almost half the probability
 * space above 0.543 is CRITICAL. The scale explains the band, never computes one.
 */
export function BandScale({ score, band, className }: BandScaleProps) {
  return (
    <div className={cn('select-none', className)}>
      <div className="flex" aria-hidden="true">
        {BANDS.map((definition) => (
          <span
            key={definition.band}
            className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-400"
            style={{ width: `${(definition.scoreTo - definition.scoreFrom) * 100}%` }}
          >
            {SHORT_LABEL[definition.band]}
          </span>
        ))}
      </div>

      <div className="relative mt-1 h-2 overflow-hidden rounded-[1px]">
        <div className="flex h-full">
          {BANDS.map((definition) => (
            <span
              key={definition.band}
              className={cn(
                BAND_STYLES[definition.band].tint,
                definition.band === band && 'ring-1 ring-inset ring-ink-950/25',
              )}
              style={{ width: `${(definition.scoreTo - definition.scoreFrom) * 100}%` }}
            />
          ))}
        </div>
        <span
          className={cn(
            'absolute top-[-3px] h-[14px] w-[2px] rounded-[1px] ring-2 ring-surface',
            BAND_STYLES[band].ink,
            'bg-current',
          )}
          style={{ left: `${score * 100}%` }}
        />
      </div>

      <div className="relative mt-1.5 h-3">
        {BANDS.slice(1).map((definition) => (
          <span
            key={definition.band}
            className="absolute -translate-x-1/2 font-mono text-2xs tabular-nums text-ink-400"
            style={{ left: `${definition.scoreFrom * 100}%` }}
          >
            {formatScore(definition.scoreFrom)}
          </span>
        ))}
      </div>
    </div>
  )
}
