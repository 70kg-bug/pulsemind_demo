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
 * Achromatic text on a tinted ground, and the band word is always spelled out:
 * hue on text this small cannot be reliably discriminated. The meter repeats the
 * same order without relying on colour at all.
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
