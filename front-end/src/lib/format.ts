/**
 * Display formatting. Every function here is pure and takes only what it needs, so a
 * component never has to reach for a date library or reimplement rounding.
 *
 * Wording note: nothing in this file describes change over time. The model has no trend
 * inputs, so "3 min ago" is a statement about staleness, never about direction.
 */

/** Calibrated probability, always two decimals: 0.78 */
export function formatScore(score: number): string {
  return score.toFixed(2)
}

/** A share of the decision or a data-quality share: 0.184 -> "18%" */
export function formatPercent(share: number, decimals = 0): string {
  return `${(share * 100).toFixed(decimals)}%`
}

/** A parameter value at its own precision. */
export function formatValue(value: number | null, decimals: number): string {
  if (value === null) {
    return '—'
  }
  return value.toFixed(decimals)
}

/** How stale a reading is: "just now", "14 min", "2 h 14 min". */
export function formatAge(minutes: number | null): string {
  if (minutes === null) {
    return '—'
  }
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)} min`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = Math.floor(minutes % 60)
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`
}

/**
 * How stale a reading is, phrased as elapsed time: "just now", "14 min ago".
 *
 * Separate from `formatAge` because appending "ago" to its output produces
 * "just now ago" — caught by driving the real UI rather than by reading the code.
 */
export function formatAgo(minutes: number | null): string {
  if (minutes === null) {
    return '—'
  }
  if (minutes < 1) {
    return 'just now'
  }
  return `${formatAge(minutes)} ago`
}

/** Wall clock in 24-hour form: "14:22:07" */
export function formatClock(date: Date, withSeconds = true): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  if (!withSeconds) {
    return `${hours}:${minutes}`
  }
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thu, 13 Aug 2026" — paired with an explicit device-local-time note in the header. */
export function formatDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** Minutes between an ISO timestamp and now, for staleness display. */
export function minutesSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 60000
}

/** Pluralise a count with its noun: "1 patient", "3 patients". */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
