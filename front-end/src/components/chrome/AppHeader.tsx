import { Link } from 'react-router'
import { Moon, Sun } from 'lucide-react'
import { useClock } from '../../hooks/useClock'
import { useTheme } from '../../hooks/useTheme'
import { formatClock, formatDate } from '../../lib/format'

/**
 * The persistent chrome.
 *
 * This is where the petrol lives — at a lightness where its chroma is actually visible,
 * rather than as a near-imperceptible cast spread over the whole page.
 *
 * Two things here are load-bearing rather than decorative. The status indicator does not
 * pulse: a flashing indicator is the defining visual signature of an alarm signal, and
 * PulseMind raises none. And the categorical label is permanent at every viewport width,
 * so the product cannot be seen — or screenshotted — without it.
 */
export function AppHeader() {
  const now = useClock()
  const [theme, toggleTheme] = useTheme()

  return (
    <header className="sticky top-0 z-20 bg-chrome text-chrome-ink">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-2 sm:px-6">
        <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:flex-1 sm:justify-start">
          <Link to="/" className="display shrink-0 text-lg tracking-[0.02em] text-chrome-ink">
            PulseMind
          </Link>
          <span className="shrink-0 rounded-[2px] border border-chrome-rule px-2 py-[3px] text-2xs font-semibold uppercase tracking-[0.07em] text-chrome-ink-dim">
            <span className="hidden sm:inline">Decision support · </span>Not an alarm
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="h-[6px] w-[6px] rounded-full bg-verified" aria-hidden="true" />
          <span className="hidden text-2xs font-semibold uppercase tracking-[0.09em] text-chrome-ink-dim sm:inline">
            Receiving
          </span>
          <span className="font-mono text-lg tabular-nums leading-none text-chrome-ink">
            {formatClock(now)}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
          <span className="hidden font-mono text-2xs uppercase tracking-[0.05em] text-chrome-ink-dim lg:inline">
            {formatDate(now)} · device local time
          </span>
          <span className="hidden shrink-0 text-2xs text-chrome-ink-dim md:inline">
            ICU Clinician
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="shrink-0 rounded-[2px] border border-chrome-rule p-1.5 text-chrome-ink-dim transition-colors hover:text-chrome-ink"
            aria-label={theme === 'day' ? 'Switch to night ground' : 'Switch to day ground'}
            title={theme === 'day' ? 'Night' : 'Day'}
          >
            {theme === 'day' ? (
              <Moon size={13} strokeWidth={2} />
            ) : (
              <Sun size={13} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
