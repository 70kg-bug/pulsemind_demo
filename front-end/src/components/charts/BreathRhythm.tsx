import { useState } from 'react'
import { Play } from 'lucide-react'
import type { Assessment, RiskBand } from '../../types/clinical'
import { cn } from '../../lib/cn'

interface BreathRhythmProps {
  assessment: Assessment
  /** Published band, or null for a reading below the sufficiency floor. */
  band: RiskBand | null
  /** `rail` is the compact form for the board's side panel. */
  size?: 'rail' | 'detail'
}

/** Enough bars to read as a travelling wave rather than a row of ticks. */
const BAR_COUNT = 28
/** How many breaths one press plays. */
const CYCLES = 6

/** Peak height of the breath, as a fraction of the track. Amplitude is the band channel. */
const PEAK: Record<RiskBand, number> = {
  LOW: 0.42,
  MEDIUM: 0.6,
  HIGH: 0.8,
  CRITICAL: 1,
}

function respiratoryRate(assessment: Assessment): number | null {
  const reading = assessment.parameters.find(
    (parameter) => parameter.parameter_name === 'respiratory_rate_total',
  )
  return reading?.value ?? null
}

/**
 * The patient's ventilation, as motion.
 *
 * Period comes from the charted respiratory rate. Amplitude comes from the band. That
 * split is deliberate and it is the whole safety argument: IEC 60601-1-8 specifies alarm
 * indicators by flash frequency — 1.4–2.8 Hz high priority, 0.4–0.8 Hz medium — so
 * frequency is the channel that carries alarm priority. Here frequency is set by the
 * patient's physiology and never by severity. Amplitude, which the standard is silent
 * on, is what varies with band.
 *
 * The effect the viewer sees is still "faster when sicker", because respiratory rate
 * genuinely tracks band in ventilated patients — but it is true rather than encoded.
 *
 * Four further properties, and it should not ship without any of them:
 *
 *   - It never auto-starts. Six breaths on a press, then it stops. WCAG 2.2.2 therefore
 *     never attaches, so no pause control is needed — which matters, because a pause
 *     control is one of the behaviours that would make this read as an alarm.
 *   - Bounded fill in a fixed track, never a growing glyph. Looming motion captures
 *     attention involuntarily; a bar rising inside a fixed frame does not.
 *   - Continuous, 100% duty, no off phase. A flashing indicator is a two-state square
 *     wave at 20–60% duty; 100% duty is the standard's non-flashing row.
 *   - Achromatic, and beside the numeral it encodes rather than replacing it. Colouring
 *     a moving element with the severity hue is the one combination that would read as
 *     an alarm indicator.
 *
 * Under a reduced-motion preference the global rule freezes the animation on its first
 * frame, which is why the resting frame is drawn as a legible flat trace.
 */
export function BreathRhythm({ assessment, band, size = 'detail' }: BreathRhythmProps) {
  const [run, setRun] = useState(0)
  const rate = respiratoryRate(assessment)

  if (rate === null) {
    return null
  }

  const periodSeconds = 60 / rate
  const peak = band ? PEAK[band] : 0.3
  const playing = run > 0

  return (
    <div className="w-full">
      <div
        className={cn(
          'flex w-full items-end gap-[2px] rounded-[2px] border border-rule bg-surface-sunken px-2 pb-1 pt-2 text-ink-700',
          size === 'detail' ? 'h-24' : 'h-16',
        )}
        aria-hidden="true"
        onAnimationEnd={() => setRun(0)}
      >
        {Array.from({ length: BAR_COUNT }, (_, index) => (
          <span
            key={`${run}-${index}`}
            className="block h-full flex-1 origin-bottom rounded-[1px] bg-current"
            style={{
              transform: 'scaleY(0.06)',
              // Each bar lags the one before it, so the breath reads as a wave
              // travelling across the track rather than every bar rising together.
              animation: playing
                ? `pm-breath ${periodSeconds}s ease-in-out ${(index * periodSeconds) / BAR_COUNT}s ${CYCLES}`
                : undefined,
              ['--breath-peak' as string]: peak,
            }}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-ink-500">
          {Math.round(rate)} breaths/min · one breath every {periodSeconds.toFixed(1)}s
        </p>
        <button
          type="button"
          onClick={() => setRun((current) => current + 1)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] border border-rule-strong px-2.5 py-1 text-2xs font-medium text-ink-950 transition-colors hover:border-ink-950 hover:bg-surface-sunken"
        >
          <Play size={11} strokeWidth={2.5} />
          {playing ? 'Breathing…' : 'Play rhythm'}
        </button>
      </div>
    </div>
  )
}
