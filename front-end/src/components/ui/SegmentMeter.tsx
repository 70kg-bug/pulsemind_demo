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
            // In `rem`, not px: the tallest bar is deliberately the height of
            // the `text-2xs` label it sits beside, and in px that match held at
            // a 16px root and quietly stopped holding when the root grew.
            'w-[0.1875rem] rounded-[1px]',
            step === 1 && 'h-[0.3125rem]',
            step === 2 && 'h-[0.4375rem]',
            step === 3 && 'h-[0.5625rem]',
            step === 4 && 'h-[0.6875rem]',
            step <= segments ? cn('bg-current', ink) : 'bg-rule-strong',
          )}
        />
      ))}
    </span>
  )
}
