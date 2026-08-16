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
 * This replaces the tracked-uppercase eyebrow that previously labelled every region.
 * That device had three problems at once: it was used around forty times, which made
 * tracked uppercase the dominant texture of the whole product; it was set in an ink
 * that failed AA; and it rendered a paragraph, so eight labelled regions on the patient
 * screen were invisible to the document outline.
 *
 * Sentence case, sans, and a real heading element. Small tracked labels still exist —
 * `.field-label` — but only for labelling a value, never a region.
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
