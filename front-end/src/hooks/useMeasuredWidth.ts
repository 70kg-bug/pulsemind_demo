import { useCallback, useState } from 'react'

/**
 * The rendered width AND height of an element, in CSS pixels.
 *
 * ⚠️ Height is here because the alternative failed. The label row pitch was
 * derived from the root font size read at module load — and in Vite dev the
 * stylesheet is injected by JS *after* the modules evaluate, so
 * `getComputedStyle(html).fontSize` was still the browser's 16px default. The
 * pitch stayed 20px while the labels grew to 19px tall: one pixel of clearance,
 * measured in the running app. Nothing threw. Measuring the rendered box has no
 * such ordering hazard, and it measures the constraint itself rather than a
 * proxy for it.
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
export function useMeasuredWidth<T extends HTMLElement>():
  [(node: T | null) => void, number, number] {
  const [box, setBox] = useState({ width: 0, height: 0 })

  const ref = useCallback((node: T | null) => {
    if (!node) return undefined
    const first = node.getBoundingClientRect()
    setBox({ width: first.width, height: first.height })

    const observer = new ResizeObserver((entries) => {
      // BORDER box, not `contentRect`. `contentRect` excludes padding, so a
      // label measured through it came back 8px narrower than it draws (px-1
      // each side) the moment the observer first fired — and the collision
      // maths then reserved 70px for a 78px label, which is exactly how the
      // leftmost one came to hang 4px off the end of the track.
      const entry = entries[0]
      const rect = node.getBoundingClientRect()
      const width = entry?.borderBoxSize?.[0]?.inlineSize ?? rect.width
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? rect.height
      // Ignore a zero: a hidden or detached node reports 0, and propagating it
      // would collapse every placement to the same point.
      if (width) setBox({ width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, box.width, box.height]
}
