import type { RiskBand } from '@contract/clinical'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'
import { SegmentMeter } from './SegmentMeter'

interface BandTagProps {
  band: RiskBand
  /** `sm` for a table row, `lg` beside a hero score. */
  size?: 'sm' | 'lg'
  className?: string
}

/**
 * The band, named and tinted.
 *
 * The text is achromatic on a tinted ground rather than coloured text on white. Two
 * reasons: display guidance asks that either foreground or background be achromatic,
 * and a coloured alphanumeric string needs to be noticeably larger before its colour
 * can be reliably discriminated. A tint carries colour as area, which has no such floor.
 *
 * The band word is always spelled out, and the segment meter repeats the ordering
 * without colour, so nothing here depends on hue alone.
 */
export function BandTag({ band, size = 'sm', className }: BandTagProps) {
  const { tint, edge } = BAND_STYLES[band]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-[2px] border text-ink-950',
        tint,
        edge,
        size === 'sm' ? 'px-2 py-[3px]' : 'px-2.5 py-1',
        className,
      )}
    >
      <span
        className={cn(
          'font-semibold uppercase tracking-[0.08em]',
          size === 'sm' ? 'text-2xs' : 'text-sm',
        )}
      >
        {band}
      </span>
      <SegmentMeter band={band} />
    </span>
  )
}
