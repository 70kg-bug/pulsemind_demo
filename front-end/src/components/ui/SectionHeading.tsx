import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface SectionHeadingProps {
  children: ReactNode
  /** Heading level. Regions inside a screen are `h2`; regions inside those are `h3`. */
  as?: 'h2' | 'h3'
  className?: string
  /** Optional count or note, set on the same baseline to the right. */
  trailing?: ReactNode
}

/**
 * A region heading.
 *
 * A real heading element: eight labelled regions were previously invisible to
 * the document outline, and the styling failed AA. Sentence case. `.field-label`
 * labels a value, never a region.
 */
export function SectionHeading({
  children,
  as: Tag = 'h2',
  className,
  trailing,
}: SectionHeadingProps) {
  const heading = (
    <Tag className="text-base font-semibold tracking-[-0.005em] text-ink-950">{children}</Tag>
  )

  if (!trailing) {
    return <div className={className}>{heading}</div>
  }

  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3', className)}>
      {heading}
      {/* min-w-0 matters: without it this refuses to shrink below its content
          width and pushes the whole page wider than a narrow viewport. */}
      <p className="min-w-0 font-mono text-2xs text-ink-700">{trailing}</p>
    </div>
  )
}
