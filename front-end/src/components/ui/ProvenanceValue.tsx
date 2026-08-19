import type { InputSource } from '@contract/clinical'
import { PROVENANCE_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { formatValue } from '../../lib/format'

interface ProvenanceValueProps {
  value: number | null
  unit?: string | null
  source: InputSource
  decimals: number
  size?: 'sm' | 'md' | 'lg' | 'hero'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
  hero: 'text-3xl',
} as const

/**
 * A parameter value and where it came from, as one inseparable unit.
 *
 * A population default is prefixed with the approximation sign, because a bare
 * numeral reads as a measurement of this patient: etCO2 is substituted in 82.6%
 * of readings, and 4 of the 11 parameters are majority cohort default.
 *
 * Staleness is disclosed in words, never encoded as fading -- a dimmed number is
 * still read as a number.
 */
export function ProvenanceValue({
  value,
  unit,
  source,
  decimals,
  size = 'sm',
  className,
}: ProvenanceValueProps) {
  const { glyph, ink, label } = PROVENANCE_STYLES[source]
  const formatted = formatValue(value, decimals)

  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <span
        className={cn('font-num tabular-nums', SIZE_CLASSES[size], ink)}
        title={label}
      >
        {glyph && (
          <span className="mr-[1px] font-normal opacity-90" aria-hidden="true">
            {glyph}
          </span>
        )}
        {formatted}
      </span>
      {unit && unit !== '—' && (
        <span className="font-sans text-2xs text-ink-500">{unit}</span>
      )}
      {/* Spoken form, so a screen reader never hears a bare number. */}
      <span className="sr-only">
        {source === 'population_reference'
          ? `approximately ${formatted}, population default, not measured on this patient`
          : `${formatted}, ${label.toLowerCase()}`}
      </span>
    </span>
  )
}
