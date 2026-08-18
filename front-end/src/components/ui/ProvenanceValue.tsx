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
 * Four of the eleven parameters are majority cohort default — end-tidal CO₂ is
 * substituted with a population value in 82.6% of readings. Rendering a number
 * without its source therefore states a cohort statistic in a clinical voice, which
 * is the single easiest way for this product to mislead someone.
 *
 * A cohort default is prefixed `≈`. That is literally what it is — an approximation
 * drawn from a population, not a measurement of the patient in front of you — and
 * unlike colour it survives greyscale, colour-vision deficiency and a photocopy.
 *
 * Staleness is never encoded as fading. A faded value reads as disabled, and a stale
 * CRITICAL reading is not less important than a fresh one.
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
