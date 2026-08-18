import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import type { RefusedAssessment } from '@contract/clinical'
import { INSUFFICIENCY_REASON_LABEL } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatAge, formatPercent, minutesSince } from '../../lib/format'

interface DataLimitedRowProps {
  assessment: RefusedAssessment
  selected: boolean
  onSelect: () => void
  now: Date
}

/**
 * A patient whose latest reading fell below the data-sufficiency floor.
 *
 * There is no score, no band and no prompt, and the row is styled so it cannot be
 * mistaken for a low one — refusing to answer and answering "low" are different facts,
 * and an earlier version of this data model could not tell them apart.
 *
 * This is a result, not an error and not a loading state.
 */
export function DataLimitedRow({ assessment, selected, onSelect, now }: DataLimitedRowProps) {
  return (
    <div
      className={cn(
        'border-t border-dashed border-rule-strong transition-colors first:border-t-0',
        selected ? 'bg-accent-tint' : 'hover:bg-surface-sunken',
      )}
    >
      <div className="flex items-stretch">
        <span
          className={cn('w-[3px] shrink-0', selected ? 'bg-accent' : 'bg-transparent')}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5 text-left sm:px-4"
        >
          <span className="flex min-w-[8rem] shrink-0 flex-col gap-0.5">
            <span className="font-mono text-sm font-medium text-ink-950">
              {assessment.bed_code}
            </span>
            <span className="font-mono text-2xs text-ink-500">{assessment.patient_id}</span>
          </span>

          <span className="shrink-0 rounded-[2px] border border-dashed border-rule-strong bg-surface-sunken px-2 py-[3px] text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
            No score published
          </span>

          <span className="min-w-[12rem] flex-1 text-2xs text-ink-500">
            {INSUFFICIENCY_REASON_LABEL[assessment.insufficiency_reason]}
          </span>

          <span className="hidden shrink-0 flex-col items-end gap-0.5 xl:flex">
            <span className="font-mono text-xs tabular-nums text-ink-500">
              {formatPercent(assessment.imputed_share)} defaulted ·{' '}
              {formatPercent(assessment.documentation_share)} charting
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-400">
              updated {formatAge(minutesSince(assessment.assessed_at, now))}
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
    </div>
  )
}
