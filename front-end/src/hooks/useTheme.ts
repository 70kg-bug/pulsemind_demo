import { useEffect, useState } from 'react'

export type Theme = 'day' | 'night'

const STORAGE_KEY = 'pulsemind-theme'

/**
 * Day or night ground.
 *
 * Day is the default and neither is ever selected automatically. An ICU is a lit room
 * around the clock, so which ground suits a given bay is a judgement the clinician
 * makes, not something inferred from the hour or from an OS preference.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    return window.localStorage.getItem(STORAGE_KEY) === 'night' ? 'night' : 'day'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('night', theme === 'night')
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  function toggle() {
    setTheme((current) => (current === 'day' ? 'night' : 'day'))
  }

  return [theme, toggle]
}
