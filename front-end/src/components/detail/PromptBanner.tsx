import type { Disposition, RiskPrompt } from '../../types/clinical'
import { formatAge, formatPercent, minutesSince } from '../../lib/format'

interface PromptBannerProps {
  prompt: RiskPrompt
  driverName: string
  driverShare: number
  now: Date
  onDispose: (disposition: Disposition) => void
}

const ACTIONS: Array<{ key: Disposition; label: string }> = [
  { key: 'acknowledged', label: 'Acknowledge' },
  { key: 'actioned', label: 'Record action' },
  { key: 'dismissed', label: 'Dismiss' },
  { key: 'escalated', label: 'Escalate' },
]

/**
 * A prompt requesting clinician review.
 *
 * These four buttons record a clinical review and close the prompt. They do not
 * silence anything: PulseMind has no alarm to silence, emits no sound, and the band
 * itself is unchanged by pressing any of them. That distinction is the reason the
 * banner says what it does — an acknowledge control is otherwise the behavioural
 * signature of an alarm system, and this is not one.
 *
 * Red is reserved. Escalate is weighted, not coloured, so that the only red on the
 * screen remains the CRITICAL band.
 */
export function PromptBanner({
  prompt,
  driverName,
  driverShare,
  now,
  onDispose,
}: PromptBannerProps) {
  return (
    <section className="rounded-[3px] border border-band-critical-edge bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 p-4">
        <div className="min-w-[18rem] flex-1">
          {/* Achromatic label, colour on the marker beside it — the same rule as the
              board row. Hue on text this small cannot be reliably discriminated. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-[1px] bg-band-critical-ink" aria-hidden="true" />
              <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-950">
                Risk prompt · awaiting clinician review
              </span>
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-400">
              raised {formatAge(minutesSince(prompt.raised_at, now))} ago
            </span>
          </div>

          <h2 className="mt-2 text-lg font-semibold tracking-[-0.01em] text-ink-950">
            Risk level reached {prompt.band_at_raise}. Clinical review is requested.
          </h2>

          <p className="mt-2 max-w-[58ch] text-xs leading-relaxed text-ink-700">
            {driverName} is the largest contribution to this reading, at{' '}
            {formatPercent(driverShare, 1)} of the score.
          </p>

          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Recording a review closes this prompt. It does not silence an alarm — PulseMind
            raises none — and it does not change the risk level.
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[12rem]">
          {ACTIONS.map((action, index) => (
            <button
              key={action.key}
              type="button"
              onClick={() => onDispose(action.key)}
              className={
                index === 0
                  ? 'rounded-[2px] bg-ink-950 px-4 py-2 text-2xs font-medium text-surface transition-colors hover:bg-accent'
                  : 'rounded-[2px] border border-rule-strong bg-surface px-4 py-2 text-2xs text-ink-950 transition-colors hover:border-ink-950'
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
