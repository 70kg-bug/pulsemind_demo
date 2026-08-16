import type { InputSource } from '../../types/clinical'
import { PROVENANCE_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatAge } from '../../lib/format'

interface ProvenanceTagProps {
  source: InputSource
  /** Null for a cohort default — a population value has no age. */
  ageMinutes: number | null
  className?: string
}

/**
 * The source of a value, in words, with its age.
 *
 * Age is always disclosed and never gates anything: the sufficiency floor deliberately
 * has no staleness condition, so a stale value is shown, dated, and left for the
 * clinician to weigh.
 */
export function ProvenanceTag({ source, ageMinutes, className }: ProvenanceTagProps) {
  const { label, glyph, ink, tint, edge } = PROVENANCE_STYLES[source]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[2px] text-2xs',
        tint,
        edge,
        ink,
        className,
      )}
    >
      <span className="font-medium uppercase tracking-[0.07em]">
        {glyph && <span aria-hidden="true">{glyph} </span>}
        {label}
      </span>
      {source !== 'cohort_default' && ageMinutes !== null && (
        <span className="font-mono text-ink-500">{formatAge(ageMinutes)}</span>
      )}
    </span>
  )
}
