import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Assessment } from '../types/clinical'
import { applyOfflineDevices, getWard } from './feed'

interface WardValue {
  ward: Assessment[]
  offlineDeviceIds: Set<string>
  toggleDevice: (deviceId: string) => void
  resetDevices: () => void
}

const WardContext = createContext<WardValue | null>(null)

/**
 * The only stateful thing in the product.
 *
 * Everything a screen renders is still derived — the single piece of state here is which
 * input sources have been switched off in the simulation. `applyOfflineDevices` is pure,
 * so `feed.ts` remains the one boundary between the screens and the data, and swapping
 * in a real transport is still a change to that file alone.
 */
export function WardProvider({ children }: { children: ReactNode }) {
  const [offlineDeviceIds, setOfflineDeviceIds] = useState<Set<string>>(() => new Set())

  const toggleDevice = useCallback((deviceId: string) => {
    setOfflineDeviceIds((current) => {
      const next = new Set(current)
      if (next.has(deviceId)) {
        next.delete(deviceId)
      } else {
        next.add(deviceId)
      }
      return next
    })
  }, [])

  const resetDevices = useCallback(() => setOfflineDeviceIds(new Set()), [])

  const value = useMemo<WardValue>(
    () => ({
      ward: applyOfflineDevices(getWard(), offlineDeviceIds),
      offlineDeviceIds,
      toggleDevice,
      resetDevices,
    }),
    [offlineDeviceIds, toggleDevice, resetDevices],
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
