import {
  createContext,
  useCallback,
  useRef,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Assessment } from '@contract/clinical'
import { fetchWard, setDevicesOffline as setDeviceOffline, tickWard } from './feed'
import { useWardStream, type WardStream } from '../hooks/useWardStream'

interface WardValue {
  ward: Assessment[]
  loading: boolean
  error: string | null
  /** Re-read the board from the API. */
  refresh: () => Promise<void>
  /** Advance every bed by one reading, then re-read. REJECTS if the tick fails:
   *  `refresh` swallows its own failures and leaves the board readable, but the
   *  stream driver needs this one to reach it, or the loop keeps firing against
   *  a ward that stopped advancing. Every caller must handle the rejection. */
  advance: () => Promise<void>
  /** Switch one patient's input source off or on, then re-read. */
  toggleDevice: (patientId: string, deviceId: string) => Promise<void>
  /** Many devices, one write. Use for anything that touches more than one. */
  setDevices: (patientId: string, deviceIds: string[], offline: boolean) => Promise<void>
  offlineDeviceIds: Set<string>
  stream: WardStream
  /** Bumped after every successful re-read. Anything holding data fetched
   *  alongside the ward — a patient's history, a parameter series — puts this in
   *  its dependencies so it reloads too. Keyed to the stream's tick count it
   *  missed device toggles and re-seeds, which change the ward just as much. */
  revision: number
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

  const [revision, setRevision] = useState(0)
  // The FIRST load is not a change. Bumping on it too meant anything mounted
  // before the ward arrived — a deep link straight to a patient — fetched its
  // history once at revision 0 and again the moment the provider settled.
  const loaded = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setWard(await fetchWard())
      if (loaded.current) setRevision((n) => n + 1)
      loaded.current = true
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

  const stream = useWardStream(advance)

  const toggleDevice = useCallback(
    async (patientId: string, deviceId: string) => {
      const patient = ward.find((a) => a.patient_id === patientId)
      const device = patient?.devices.find((d) => d.device_id === deviceId)
      await setDeviceOffline(patientId, [deviceId], device?.state !== 'offline')
      await refresh()
    },
    [ward, refresh],
  )

  /** Every named device to one state, in ONE write. Firing N single toggles
   *  concurrently raced the server's read-modify-write and restored one. */
  const setDevices = useCallback(
    async (patientId: string, deviceIds: string[], offline: boolean) => {
      if (deviceIds.length === 0) return
      await setDeviceOffline(patientId, deviceIds, offline)
      await refresh()
    },
    [refresh],
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
    () => ({ ward, loading, error, refresh, advance, toggleDevice, setDevices, offlineDeviceIds,
             stream, revision }),
    [ward, loading, error, refresh, advance, toggleDevice, setDevices, offlineDeviceIds,
     stream, revision],
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
