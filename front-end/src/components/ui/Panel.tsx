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
 * A ruled region. `--surface` equals `--page`, so a panel is a boundary and
 * never a fill: no card, no shadow, no elevation.
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
