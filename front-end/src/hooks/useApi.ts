import { useEffect, useRef, useState } from 'react'
import type { Assessment, ParameterHistoryPoint, ParameterName, PatientContext } from '@contract/clinical'
import { fetchHistory, fetchParameterHistory } from '../data/feed'

/**
 * Small fetch-on-mount hooks, one per thing a screen needs. Plain useState and
 * useEffect rather than a data library: three call sites do not justify a cache.
 *
 * All three read STORED history. Nothing here reconstructs a past band from a
 * past score — that is decided once and looked up afterwards.
 */

interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * `subject` is what the data is ABOUT, and every caller must pass one. Changing
 * it clears the previous answer; refetching the SAME subject keeps it on screen
 * until the new one lands. Optional, it silently disabled clearing for whoever
 * forgot — `undefined !== undefined` is never true — which is how the SpO2
 * series came to render under the FiO2 heading.
 */
function useFetch<T>(load: () => Promise<T>, deps: unknown[], subject: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastSubject = useRef(subject)

  useEffect(() => {
    let current = true
    setLoading(true)
    // Cleared when the SUBJECT changes, because a screen that renders `data`
    // while `loading` shows the previous subject's numbers under the new one's
    // name. Kept when the same subject merely has a newer reading: blanking on
    // every tick leaves the one chart showing a band history unreadable for
    // exactly as long as it is worth watching.
    if (lastSubject.current !== subject) {
      lastSubject.current = subject
      setData(null)
    }
    load()
      .then((result) => {
        if (current) {
          setData(result)
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : 'request failed')
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    // A patient can be switched while a request is in flight; `current` stops
    // the slower answer overwriting the newer one.
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}

/** Recent assessments for one patient, oldest first.
 *
 *  `revision` is the ward's, from `useWard()`. Without it the observation strip
 *  is fetched once on mount and then silently stops agreeing with the board
 *  beside it. */
export function usePatientHistory(patientId: string, revision = 0, limit = 14) {
  return useFetch<Assessment[]>(
    () => fetchHistory(patientId, limit),
    [patientId, limit, revision],
    patientId,
  )
}

/** One parameter's charting history, oldest first. */
export function useParameterHistory(
  patientId: string,
  parameterName: ParameterName,
  limit = 24,
) {
  return useFetch<ParameterHistoryPoint[]>(
    () => fetchParameterHistory(patientId, parameterName, limit),
    [patientId, parameterName, limit],
    `${patientId}:${parameterName}`,
  )
}

/** Borrowed demographics and comorbidities. Recorded context, not a prediction. */
export function usePatientContext(patientId: string) {
  return useFetch<PatientContext>(
    () => fetch(`/api/patient/${patientId}/context`).then((r) => {
      if (!r.ok) throw new Error(`context returned ${r.status}`)
      return r.json() as Promise<PatientContext>
    }),
    [patientId],
    patientId,
  )
}
