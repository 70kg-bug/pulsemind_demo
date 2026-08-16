import { useEffect, useState } from 'react'

/** Current time, refreshed every second. Used for the header clock and staleness counters. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return now
}
