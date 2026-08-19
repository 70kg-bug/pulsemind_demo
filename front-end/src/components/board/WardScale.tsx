import type { ScoredAssessment } from '@contract/clinical'
import { BANDS } from '../../data/bands'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatScore } from '../../lib/format'
import { ROW_PITCH, placeLabels } from '../../lib/labelPlacement'
import { useMeasuredWidth } from '../../hooks/useMeasuredWidth'

interface WardScaleProps {
  patients: ScoredAssessment[]
  selectedId: string
  onSelect: (patientId: string) => void
}

/** Clear space between the lowest label row and the axis, in pixels. Tall enough
 *  that a displaced leader line leans rather than lies flat: the widest travel
 *  measured on this ward is 63px, which over 22px reads as a line and not as a
 *  rule. */
const LEADER_HEIGHT = 22

/**
 * A reading moves a bed along the axis; it must travel there rather than appear
 * there. A band change is the moment the board exists to show, and a mark that
 * teleports across a cut reads as a redraw instead of a patient deteriorating.
 *
 * Inline rather than a utility class because all three layers must carry
 * identical timing — a label arriving before its own leader line reads as a
 * glitch. 700 ms sits under the fastest cadence, so a mark is visibly at rest
 * before the next reading moves it. `prefers-reduced-motion` is handled once,
 * globally, in index.css, and a stylesheet `!important` beats an inline style,
 * so these need no guard of their own.
 *
 * Position only. Colour is NOT transitioned and never was: `transition` is not
 * inherited, these sit on the button, and every colour lives on its child spans.
 *
 * This only animates because every mark is keyed by `patient_id`. Key these by
 * index and the ranked re-sort swaps element identity on each tick, which the
 * browser renders as marks jumping between beds.
 */
const EASE = 'cubic-bezier(0, 0, 0.2, 1)'
const SLIDE = `left 700ms ${EASE}`
const SLIDE_LABEL = `${SLIDE}, bottom 700ms ${EASE}`
const SLIDE_LEADER = `${SLIDE}, height 700ms ${EASE}, transform 700ms ${EASE}`

/**
 * The ward on one calibrated axis.
 *
 * Segment widths are the real cut points, so the geometry carries a fact: the
 * LOW band is narrow in score terms yet holds 71.5% of all readings, and nearly
 * half the probability space sits above the CRITICAL cut.
 *
 * It explains where a patient sits and never decides a band.
 */
export function WardScale({ patients: given, selectedId, onSelect }: WardScaleProps) {
  const [trackRef, trackWidth] = useMeasuredWidth<HTMLDivElement>()
  const [probeRef, labelWidth] = useMeasuredWidth<HTMLSpanElement>()

  // A non-finite score would place its label at `left: NaN%`, which the browser
  // ignores — so the bed would sit at the far left looking like a real reading
  // rather than a broken one. Drop it instead; a bed missing from the axis is
  // visible, a bed lying about its position is not.
  const patients = given.filter((p) => Number.isFinite(p.risk_score))

  // Measured off a hidden copy rather than off the labels themselves, which
  // would need a second render pass to place what the first pass just drew.
  // Built from the longest bed code actually present, so a longer one later
  // widens the probe instead of quietly under-reserving space.
  const widestCode = patients.reduce(
    (widest, p) => (p.bed_code.length > widest.length ? p.bed_code : widest),
    'ICU 00',
  )

  const { placements, rows } = placeLabels(
    patients.map((p) => ({ id: p.patient_id, value: p.risk_score })),
    trackWidth,
    labelWidth,
  )
  const byId = new Map(placements.map((p) => [p.id, p]))
  const labelsHeight = rows * ROW_PITCH
  const pct = (px: number) => (trackWidth > 0 ? (px / trackWidth) * 100 : 0)

  return (
    <section aria-label="All ventilated patients on the risk scale" className="relative select-none">
      {/* Invisible but LAID OUT, so its width is the real rendered width of a
          label at this font rather than an estimate. `visibility: hidden` and
          not an off-screen offset: a negative `left` risks the horizontal
          overflow this design guarantees against. */}
      <span
        ref={probeRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap px-1 font-mono text-2xs tabular-nums"
      >
        {widestCode}
        <span className="ml-1">0.00</span>
      </span>

      {/* Labels and their leader lines share one positioned box: a label on the
          upper row needs a line that reaches down THROUGH the lower row, which
          it cannot do from a sibling strip. */}
      <div
        ref={trackRef}
        className="relative"
        style={{ height: `${labelsHeight + LEADER_HEIGHT}px` }}
      >
        {patients.map((patient) => {
          const placement = byId.get(patient.patient_id)
          if (!placement) return null
          const selected = patient.patient_id === selectedId

          // The line is anchored at the mark and rotated about its own foot, so
          // its head lands on the displaced label by construction: with a
          // rotation of atan(shift / rise) and a length of hypot(shift, rise),
          // the top end is exactly `shift` across and `rise` up.
          const shift = placement.placedX - placement.trueX
          const rise = LEADER_HEIGHT + placement.row * ROW_PITCH
          const length = Math.hypot(shift, rise)
          const angle = (Math.atan2(shift, rise) * 180) / Math.PI

          return (
            <span
              key={`leader-${patient.patient_id}`}
              className={cn(
                'absolute bottom-0 w-px origin-bottom',
                selected ? 'bg-ink-950' : 'bg-ink-300',
              )}
              style={{
                left: `${pct(placement.trueX)}%`,
                height: `${length}px`,
                transform: `translateX(-50%) rotate(${angle}deg)`,
                transition: SLIDE_LEADER,
              }}
              aria-hidden="true"
            />
          )
        })}

        {patients.map((patient) => {
          const placement = byId.get(patient.patient_id)
          if (!placement) return null
          const selected = patient.patient_id === selectedId
          return (
            <button
              key={patient.patient_id}
              type="button"
              onClick={() => onSelect(patient.patient_id)}
              // `bg-page` is an occluder, not decoration: a label on an upper row
              // sends its leader line down THROUGH the rows beneath it, and
              // without this the line strikes through their text. The scale sits
              // directly on the page ground, so the mask is invisible.
              className="absolute -translate-x-1/2 whitespace-nowrap bg-page px-1 font-mono text-2xs tabular-nums"
              style={{
                left: `${pct(placement.placedX)}%`,
                bottom: `${LEADER_HEIGHT + placement.row * ROW_PITCH}px`,
                transition: SLIDE_LABEL,
              }}
            >
              <span className={cn(selected ? 'font-medium text-ink-950' : 'text-ink-700')}>
                {patient.bed_code}
              </span>
              <span className={cn('ml-1', selected ? 'text-ink-700' : 'text-ink-500')}>
                {formatScore(patient.risk_score)}
              </span>
            </button>
          )
        })}
      </div>

      {/* The axis. Segment widths are the calibrated cut points. */}
      <div className="relative flex h-7 overflow-hidden rounded-[2px]">
        {BANDS.map((definition) => (
          <div
            key={definition.band}
            className={cn(
              'flex items-center justify-center border-r border-page/40 last:border-r-0',
              BAND_STYLES[definition.band].tint,
            )}
            style={{ width: `${(definition.scoreTo - definition.scoreFrom) * 100}%` }}
          >
            <span className="truncate px-1 text-2xs font-semibold uppercase tracking-[0.07em] text-ink-950">
              {definition.band}
            </span>
          </div>
        ))}

        {/* Each patient's position, drawn over the segments. Always the true
            score — the label may have moved, the mark never does. */}
        {patients.map((patient) => (
          <span
            key={patient.patient_id}
            className={cn(
              'absolute top-0 h-full -translate-x-1/2',
              patient.patient_id === selectedId
                ? 'w-[3px] bg-ink-950 ring-1 ring-page'
                : 'w-px bg-ink-950/55',
            )}
            style={{ left: `${patient.risk_score * 100}%`, transition: SLIDE }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Cut points. */}
      <div className="relative mt-1.5 h-4">
        <span className="absolute left-0 font-mono text-2xs tabular-nums text-ink-500">0.00</span>
        {BANDS.slice(1).map((definition) => (
          <span
            key={definition.band}
            className="absolute -translate-x-1/2 font-mono text-2xs tabular-nums text-ink-500"
            style={{ left: `${definition.scoreFrom * 100}%` }}
          >
            {formatScore(definition.scoreFrom)}
          </span>
        ))}
        <span className="absolute right-0 font-mono text-2xs tabular-nums text-ink-500">1.00</span>
      </div>
    </section>
  )
}
