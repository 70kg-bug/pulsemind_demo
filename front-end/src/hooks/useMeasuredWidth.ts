import { useCallback, useState } from 'react'

/**
 * The rendered width of an element, in CSS pixels.
 *
 * The first DOM measurement in this codebase, and it exists for one reason: the
 * ward scale places labels along a fluid track, but a label is a fixed pixel
 * width. Any collision rule written in score-space is therefore right at one
 * viewport and wrong at every other — which is exactly how three bed codes came
 * to be drawn on top of one another.
 *
 * Returned as a callback ref rather than a `useRef` + effect so the first
 * measurement happens the moment the node attaches, with no render showing an
 * unmeasured zero. The cleanup return is React 19's ref-cleanup contract.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0)

  const ref = useCallback((node: T | null) => {
    if (!node) return undefined
    setWidth(node.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      // BORDER box, not `contentRect`. `contentRect` excludes padding, so a
      // label measured through it came back 8px narrower than it draws (px-1
      // each side) the moment the observer first fired — and the collision
      // maths then reserved 70px for a 78px label, which is exactly how the
      // leftmost one came to hang 4px off the end of the track.
      const entry = entries[0]
      const measured = entry?.borderBoxSize?.[0]?.inlineSize
        ?? node.getBoundingClientRect().width
      // Ignore a zero: a hidden or detached node reports 0, and propagating it
      // would collapse every placement to the same point.
      if (measured) setWidth(measured)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
