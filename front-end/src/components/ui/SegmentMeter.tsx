import type { RiskBand } from '@contract/clinical'
import { BAND_STYLES } from '../../lib/bandStyles'
import { cn } from '../../lib/cn'

interface SegmentMeterProps {
  band: RiskBand
  className?: string
}

/**
 * Four segments, filled up to the band's rank.
 *
 * This is the channel that does not depend on colour at all. It survives greyscale,
 * every form of colour-vision deficiency, and a badly calibrated monitor — and it is
 * the reason the dark theme can carry a four-level scale that colour alone cannot.
 */
export function SegmentMeter({ band, className }: SegmentMeterProps) {
  const { segments, ink } = BAND_STYLES[band]

  return (
    <span
      className={cn('inline-flex items-end gap-[2px]', className)}
      aria-hidden="true"
    >
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={cn(
            'w-[3px] rounded-[1px]',
            step === 1 && 'h-[5px]',
            step === 2 && 'h-[7px]',
            step === 3 && 'h-[9px]',
            step === 4 && 'h-[11px]',
            step <= segments ? cn('bg-current', ink) : 'bg-rule-strong',
          )}
        />
      ))}
    </span>
  )
}
