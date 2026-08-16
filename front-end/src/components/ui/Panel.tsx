import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface PanelProps {
  children: ReactNode
  className?: string
  /** A recessed surface, for empty states and secondary regions. */
  sunken?: boolean
  /** A dashed edge, used only where data is absent rather than merely quiet. */
  dashed?: boolean
}

/**
 * A ruled region.
 *
 * There is no card here. `--surface` is identical to `--page`, so this draws a boundary
 * and nothing else — no fill, no shadow, no elevation. The previous version painted a
 * white card on a light grey page, and that one luminance step was most of what made
 * the product look like every other scaffolded dashboard.
 */
export function Panel({ children, className, sunken = false, dashed = false }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-[3px] border',
        dashed ? 'border-dashed border-rule-strong' : 'border-rule',
        sunken && 'bg-surface-sunken',
        className,
      )}
    >
      {children}
    </div>
  )
}
