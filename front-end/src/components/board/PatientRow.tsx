import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import type { ScoredAssessment } from '@contract/clinical'
import { BAND_STATE_LABEL } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatAge, formatPercent, formatScore, minutesSince } from '../../lib/format'
import { BandTag } from '../ui/BandTag'

interface PatientRowProps {
  assessment: ScoredAssessment
  selected: boolean
  onSelect: () => void
  now: Date
}

/**
 * One patient on the triage board.
 *
 * Selecting a row only changes which patient the side panel describes. Opening the
 * patient is a separate, explicit action — on a triage board an accidental navigation
 * costs a clinician their place in the list.
 */
export function PatientRow({ assessment, selected, onSelect, now }: PatientRowProps) {
  const promptIsOpen = assessment.prompt?.status === 'open'
  const age = minutesSince(assessment.assessed_at, now)

  return (
    <div
      className={cn(
        'border-t border-rule-faint transition-colors first:border-t-0',
        selected ? 'bg-accent-tint' : 'hover:bg-surface-sunken',
      )}
    >
      <div className="flex items-stretch">
        {/* Selection is shown as a solid edge on an otherwise flat row, so it reads as
            "you are here" rather than as a severity signal. */}
        <span
          className={cn('w-[3px] shrink-0', selected ? 'bg-accent' : 'bg-transparent')}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-3 py-1.5 text-left sm:px-4"
        >
          {/* Bed and patient on ONE baseline. Both are identifiers for the same
              person, and stacked they were 39px — the row's binding height once
              the score was inlined. Eight rows of it was the difference between
              a board showing six beds and one showing all eight. */}
          <span className="flex min-w-[9.5rem] shrink-0 items-baseline gap-2">
            <span className="font-mono text-sm font-medium text-ink-950">
              {assessment.bed_code}
            </span>
            <span className="font-mono text-2xs text-ink-500">{assessment.patient_id}</span>
          </span>

          <BandTag band={assessment.risk_level} className="shrink-0" />

          {/* Numeral and caption on ONE baseline, not stacked. Stacked, this was
              44px and the tallest thing in the row — it, not the bed/patient
              pair, set the row height, and eight of them pushed two beds off a
              board whose whole job is showing all of them at once. Nothing is
              lost: the word still labels the number, beside it instead of under
              it. */}
          <span className="flex shrink-0 items-baseline gap-1.5">
            <span className="font-num text-xl tabular-nums leading-none text-ink-950">
              {formatScore(assessment.risk_score)}
            </span>
            <span className="text-xs uppercase tracking-[0.07em] text-ink-400">score</span>
          </span>

          <span className="hidden min-w-[10rem] flex-1 flex-col gap-0.5 lg:flex">
            <span className="text-2xs text-ink-700">
              {BAND_STATE_LABEL[assessment.band_state]}
            </span>
            <span className="font-mono text-xs text-ink-400">
              {assessment.readings_in_state} readings in band
              {assessment.instant_level !== assessment.risk_level &&
                ` · score alone implies ${assessment.instant_level}`}
            </span>
          </span>

          <span className="hidden shrink-0 flex-col items-end gap-0.5 xl:flex">
            <span className="font-mono text-xs tabular-nums text-ink-500">
              {formatPercent(assessment.imputed_share)} defaulted ·{' '}
              {formatPercent(assessment.documentation_share)} charting
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-400">
              updated {formatAge(age)}
            </span>
          </span>
        </button>

        <Link
          to={`/patient/${assessment.patient_id}`}
          className="flex shrink-0 items-center gap-1.5 border-l border-rule-faint px-3 text-2xs text-ink-500 transition-colors hover:bg-surface-sunken hover:text-accent"
          aria-label={`Open ${assessment.bed_code}, patient ${assessment.patient_id}`}
        >
          <span className="hidden sm:inline">Open</span>
          <ArrowRight size={13} strokeWidth={2} />
        </Link>
      </div>

      {/* The label is achromatic and the colour sits on a shape beside it. Coloured text
          this small cannot have its hue reliably discriminated, so the marker carries the
          signal and the words carry the meaning. */}
      {promptIsOpen && (
        <div className="ml-[3px] flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule-faint bg-surface-sunken px-3 py-1.5 sm:px-4">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-[1px] bg-band-critical-ink"
              aria-hidden="true"
            />
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-950">
              Awaiting clinician review
            </span>
          </span>
          <span className="font-mono text-xs tabular-nums text-ink-500">
            raised {formatAge(minutesSince(assessment.prompt!.raised_at, now))} ago at{' '}
            {assessment.prompt!.band_at_raise}
          </span>
        </div>
      )}
    </div>
  )
}
