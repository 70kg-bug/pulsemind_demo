/**
 * Spreading crowded labels along a shared axis.
 *
 * A bed label is a fixed ~78px wide; the axis it sits on is fluid. When two
 * patients score close together their labels overlap, and the previous approach
 * — stack into one of three rows, decide by a fixed distance in SCORE space —
 * failed twice over: the row counter saturated and wrote surplus labels on top
 * of each other without checking, and the score-space threshold was worth 116px
 * at one viewport and 48px at another.
 *
 * This works in pixels, and moves labels sideways rather than upwards. Every
 * label keeps its full text; the leader line is what ties it back to its mark.
 */

/** Clear space between two labels sharing a row, in pixels. */
const GUTTER = 12

/** Vertical distance between label rows, in pixels. */
export const ROW_PITCH = 20

/** Rows are cheap but not free — each one pushes the axis further down. */
const MAX_ROWS = 3

export interface Placeable {
  id: string
  /** Position along the axis, 0..1. */
  value: number
}

export interface Placement {
  id: string
  /** Where the mark belongs, in px. */
  trueX: number
  /** Where the label is drawn, in px. */
  placedX: number
  row: number
}

/**
 * Rows are for VERTICAL clearance, not for capacity.
 *
 * Two labels on different rows may overlap horizontally as much as they like, so
 * alternating rows lets neighbours sit `need / rows` apart instead of `need`.
 * That is the whole reason to add a row: it buys horizontal room, which is what
 * decides how far a label has to travel from its own mark.
 */
function rowsFor(xs: number[], need: number, trackWidth: number, labelWidth: number): number {
  const tightest = xs.length < 2
    ? Infinity
    : Math.min(...xs.slice(1).map((x, i) => x - xs[i]))

  let rows = 1
  if (tightest < need) rows = 2
  if (tightest < need / 2) rows = 3

  // And enough rows that the whole run physically fits the track.
  const usable = Math.max(trackWidth - labelWidth, 1)
  const forFit = Math.ceil(((xs.length - 1) * need) / usable)

  return Math.min(MAX_ROWS, Math.max(1, rows, forFit))
}

/**
 * Merge overlapping labels into groups, centre each group on its members' mean
 * position, and keep the run inside the track.
 *
 * Centring on the mean rather than pushing rightwards keeps the displacement
 * symmetric: a cluster opens outwards from where it actually sits instead of
 * drifting off in one direction.
 */
function spread(items: Placeable[], gap: number, trackWidth: number, labelWidth: number) {
  const half = gap / 2
  const edge = labelWidth / 2
  let groups = items.map((item) => ({ items: [item], centre: item.value * trackWidth }))

  // Bounded rather than `while (true)`: each pass either merges a pair or stops,
  // so it cannot run longer than the number of items, and the guard keeps a
  // future edit from turning a layout bug into a frozen tab.
  for (let pass = 0; pass < items.length + 1; pass++) {
    for (const group of groups) {
      const reach = ((group.items.length - 1) * gap) / 2 + edge
      // A label at score 0 used to hang ~39px off the left edge of the track.
      group.centre = Math.min(Math.max(group.centre, reach), trackWidth - reach)
    }

    let merged = false
    for (let i = 0; i < groups.length - 1; i++) {
      const left = groups[i]
      const right = groups[i + 1]
      if (left.centre + left.items.length * half > right.centre - right.items.length * half) {
        const combined = [...left.items, ...right.items]
        groups.splice(i, 2, {
          items: combined,
          centre: combined.reduce((sum, it) => sum + it.value * trackWidth, 0) / combined.length,
        })
        merged = true
        break
      }
    }
    if (!merged) break
  }

  const placed = new Map<string, number>()
  for (const group of groups) {
    const start = group.centre - ((group.items.length - 1) * gap) / 2
    group.items.forEach((item, i) => placed.set(item.id, start + i * gap))
  }
  return placed
}

/**
 * Place every label. `labelWidth` and `trackWidth` are measured, not assumed —
 * see `useMeasuredWidth`. Returns nothing until both are known, so the first
 * paint draws no labels rather than drawing them all at zero.
 *
 * ONE placement pass over every label, in score order, with rows assigned round
 * robin afterwards. Placing each row separately looked reasonable and was not:
 * two rows centred on their own members drift independently, so a label could
 * end up left of one whose mark is further left, and the leader lines crossed.
 * A crossed leader is worse than a crowded one — it points at the wrong patient.
 * Placing globally keeps position monotonic in score, so they cannot cross.
 */
export function placeLabels(
  items: Placeable[],
  trackWidth: number,
  labelWidth: number,
): { placements: Placement[]; rows: number } {
  if (!items.length || trackWidth <= 0 || labelWidth <= 0) {
    return { placements: [], rows: 1 }
  }

  const need = labelWidth + GUTTER
  const ordered = [...items].sort((a, b) => a.value - b.value)
  const rows = rowsFor(ordered.map((i) => i.value * trackWidth), need, trackWidth, labelWidth)

  // Neighbours land on different rows, so they only need `need / rows` between
  // them; labels `rows` apart share a row and are a full `need` apart.
  const placed = spread(ordered, need / rows, trackWidth, labelWidth)

  return {
    rows,
    placements: ordered.map((item, index) => ({
      id: item.id,
      trueX: item.value * trackWidth,
      placedX: placed.get(item.id) ?? item.value * trackWidth,
      row: index % rows,
    })),
  }
}
