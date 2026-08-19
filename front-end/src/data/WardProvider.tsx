import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Assessment } from '@contract/clinical'
import { fetchWard, setDeviceOffline, tickWard } from './feed'

interface WardValue {
  ward: Assessment[]
  loading: boolean
  error: string | null
  /** Re-read the board from the API. */
  refresh: () => Promise<void>
  /** Advance every bed by one reading, then re-read. */
  advance: () => Promise<void>
  /** Switch one patient's input source off or on, then re-read. */
  toggleDevice: (patientId: string, deviceId: string) => Promise<void>
  offlineDeviceIds: Set<string>
}

const WardContext = createContext<WardValue | null>(null)

/**
 * Holds the ward, and nothing else.
 *
 * No client-side simulation: switching a source off used to be recomputed in the
 * browser with a made-up `imputed_share` delta. It is now a request, and the
 * consequence comes back from the model — only the model knows how much of the
 * decision rested on the values that stopped arriving.
 */
export function WardProvider({ children }: { children: ReactNode }) {
  const [ward, setWard] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setWard(await fetchWard())
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the ward could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const advance = useCallback(async () => {
    await tickWard()
    await refresh()
  }, [refresh])

  const toggleDevice = useCallback(
    async (patientId: string, deviceId: string) => {
      const patient = ward.find((a) => a.patient_id === patientId)
      const device = patient?.devices.find((d) => d.device_id === deviceId)
      await setDeviceOffline(patientId, deviceId, device?.state !== 'offline')
      await refresh()
    },
    [ward, refresh],
  )

  // Derived, not stored: the board already reports each source's state, and a
  // second copy is a thing that can disagree.
  const offlineDeviceIds = useMemo(
    () =>
      new Set(
        ward.flatMap((assessment) =>
          assessment.devices.filter((d) => d.state === 'offline').map((d) => d.device_id),
        ),
      ),
    [ward],
  )

  const value = useMemo<WardValue>(
    () => ({ ward, loading, error, refresh, advance, toggleDevice, offlineDeviceIds }),
    [ward, loading, error, refresh, advance, toggleDevice, offlineDeviceIds],
  )

  return <WardContext.Provider value={value}>{children}</WardContext.Provider>
}

export function useWard(): WardValue {
  const value = useContext(WardContext)
  if (!value) {
    throw new Error('useWard must be used inside a WardProvider')
  }
  return value
}

/** One patient from the current ward, or undefined if the ID is unknown. */
export function useAssessment(patientId: string): Assessment | undefined {
  const { ward } = useWard()
  return ward.find((assessment) => assessment.patient_id === patientId)
}
