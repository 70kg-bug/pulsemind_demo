import { useEffect, useState } from 'react'
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

function useFetch<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true)
    // Cleared, not left in place: a screen that renders `data` while `loading`
    // would show the previous patient's readings under the new patient's name.
    setData(null)
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

/** Recent assessments for one patient, oldest first. */
export function usePatientHistory(patientId: string, limit = 14) {
  return useFetch<Assessment[]>(() => fetchHistory(patientId, limit), [patientId, limit])
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
  )
}
