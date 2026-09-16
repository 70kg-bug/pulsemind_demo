import { useMemo } from 'react'
import type { Assessment } from '@contract/clinical'
import { useClock } from './useClock'

/**
 * The clock the board measures staleness against.
 *
 * A simulated tick advances the ward an hour, because that is the grid the band
 * table's dwell was fitted on. The ward's newest reading therefore runs ahead of
 * the wall clock while the stream is running, and measuring against the browser
 * would give every bed a negative age on a screen whose whole job is to say how
 * fresh a value is.
 *
 * Ahead of the wall clock, the ward's own time wins. Otherwise this is exactly
 * `useClock`, so nothing changes when nobody is streaming.
 */
export function useWardClock(ward: Assessment[]): { now: Date; simulated: boolean } {
  const real = useClock()

  // `Math.max(x, NaN)` is NaN and stays NaN, which would leave `simulated` false
  // for ever and switch the whole feature off with nothing to see. Unreachable
  // today — `assessed_at` is a Mongoose Date — but the failure mode is silent.
  const newest = useMemo(
    () => ward.reduce((latest, a) => {
      const at = Date.parse(a.assessed_at)
      return Number.isFinite(at) ? Math.max(latest, at) : latest
    }, 0),
    [ward],
  )

  return useMemo(() => {
    // A whole minute of slack: seeding lands the newest reading on `now`, and
    // without it the ordinary idle board would flicker into "simulated" on
    // nothing more than clock jitter between the browser and the service.
    const simulated = newest - real.getTime() > 60_000
    return { now: simulated ? new Date(newest) : real, simulated }
  }, [newest, real])
}
