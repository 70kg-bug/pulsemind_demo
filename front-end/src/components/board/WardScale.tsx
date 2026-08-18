import type { ScoredAssessment } from '@contract/clinical'
import { BANDS } from '../../data/bands'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatScore } from '../../lib/format'

interface WardScaleProps {
  patients: ScoredAssessment[]
  selectedId: string
  onSelect: (patientId: string) => void
}

/** Marks closer together than this share a row, so their labels would collide. */
const COLLISION_DISTANCE = 0.075
const LABEL_ROWS = 3

/**
 * Assign each mark to a label row so nearby bed codes do not overlap.
 * Patients are taken in score order and pushed up a row while they are too close to
 * the previous one.
 */
function assignRows(patients: ScoredAssessment[]): Map<string, number> {
  const ordered = [...patients].sort((a, b) => a.risk_score - b.risk_score)
  const rows = new Map<string, number>()
  const lastScoreInRow: number[] = new Array(LABEL_ROWS).fill(-Infinity)

  for (const patient of ordered) {
    let row = 0
    while (row < LABEL_ROWS - 1 && patient.risk_score - lastScoreInRow[row] < COLLISION_DISTANCE) {
      row += 1
    }
    lastScoreInRow[row] = patient.risk_score
    rows.set(patient.patient_id, row)
  }

  return rows
}

/**
 * The ward on one calibrated axis.
 *
 * Segment widths are the real cut points from the band table, not four equal quarters,
 * so the geometry itself carries a fact about the model: the LOW band is narrow in score
 * terms yet holds 71.5% of all readings, and nearly half the probability space sits
 * above the CRITICAL cut. A decorative four-equal-segment bar would quietly misrepresent
 * that.
 *
 * The scale explains where a patient sits. It never decides a band — the published band
 * arrives already settled by the hysteresis machine, and re-deriving it here would throw
 * that away.
 */
export function WardScale({ patients, selectedId, onSelect }: WardScaleProps) {
  const rows = assignRows(patients)

  return (
    <section aria-label="All ventilated patients on the risk scale" className="select-none">
      {/* Bed labels, stacked into rows so nearby marks stay readable. */}
      <div className="relative" style={{ height: `${LABEL_ROWS * 20}px` }}>
        {patients.map((patient) => {
          const row = rows.get(patient.patient_id) ?? 0
          const selected = patient.patient_id === selectedId
          return (
            <button
              key={patient.patient_id}
              type="button"
              onClick={() => onSelect(patient.patient_id)}
              className="absolute -translate-x-1/2 whitespace-nowrap px-1 font-mono text-2xs tabular-nums transition-colors"
              style={{
                left: `${patient.risk_score * 100}%`,
                bottom: `${row * 20}px`,
              }}
            >
              <span className={cn(selected ? 'font-medium text-ink-950' : 'text-ink-700')}>
                {patient.bed_code.replace('Bed ', '')}
              </span>
              <span
                className={cn(
                  'ml-1',
                  selected ? 'text-ink-700' : 'text-ink-500',
                )}
              >
                {formatScore(patient.risk_score)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Leader lines from each label down to the axis. */}
      <div className="relative h-2">
        {patients.map((patient) => (
          <span
            key={patient.patient_id}
            className={cn(
              'absolute bottom-0 w-px',
              patient.patient_id === selectedId ? 'h-2 bg-ink-950' : 'h-1.5 bg-ink-300',
            )}
            style={{ left: `${patient.risk_score * 100}%` }}
            aria-hidden="true"
          />
        ))}
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

        {/* Each patient's position, drawn over the segments. */}
        {patients.map((patient) => (
          <span
            key={patient.patient_id}
            className={cn(
              'absolute top-0 h-full -translate-x-1/2',
              patient.patient_id === selectedId
                ? 'w-[3px] bg-ink-950 ring-1 ring-page'
                : 'w-px bg-ink-950/55',
            )}
            style={{ left: `${patient.risk_score * 100}%` }}
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
