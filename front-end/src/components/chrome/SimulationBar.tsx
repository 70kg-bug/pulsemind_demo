import { useState } from 'react'
import { Flame, Pause, Play, RotateCcw } from 'lucide-react'
import { useWard } from '../../data/WardProvider'
import { seedWard, warmExplainer } from '../../data/feed'
import { STREAM_CADENCES } from '../../hooks/useWardStream'
import { cn } from '../../lib/cn'
import { TelemetryToggle } from './TelemetryDock'

/**
 * Backfill used by "Restart ward".
 *
 * Short on purpose. The shipped default of 24 puts thirteen of this ward's
 * seventeen band changes behind the stream before it starts, including every one
 * of the early promotions. Four leaves two promotions on the first streamed
 * tick, the first COMPLETED demotion on the tenth, and the two-step recovery at
 * the twenty-second and twenty-fourth.
 *
 * "Completed" is load-bearing: three demotions go pending earlier and never
 * finish, so "the first demotion" would be wrong by eight ticks.
 */
const DEMO_BACKFILL = 4

/**
 * The stand-in for a telemetry feed.
 *
 * There is no HL7 interface and no message broker; in production readings arrive
 * on their own and none of this exists. It is a request like any other — the
 * consequence is computed by the model service and read back, never invented
 * here.
 *
 * IN THE CHROME, not the aside. It is entirely prototype affordance, and at 307px
 * it was the third-tallest thing in the clinician's own column — pushing the
 * ward off the bottom of the screen to hold controls no clinician will ever see.
 * One line of chrome costs ~40px and is reachable without scrolling.
 */
export function SimulationBar({
  pipelineOpen,
  onTogglePipeline,
}: {
  pipelineOpen: boolean
  onTogglePipeline: () => void
}) {
  const { stream, refresh } = useWard()
  const [busy, setBusy] = useState<'seed' | 'warm' | null>(null)
  // ARMED, NOT TIMED. Restarting deletes every assessment, prompt and clinician
  // disposition — the last of which is the only human-authored record the system
  // holds and the one thing a re-seed cannot reproduce. It sits one click from
  // "Stream ward" in permanent chrome, so it asks first. A countdown or a
  // hover-reveal would both expire on their own, which this interface does not
  // do: a nurse returning to an interrupted screen must find it as they left it.
  const [armed, setArmed] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  function begin(what: 'seed' | 'warm') {
    setBusy(what)
    setNote(null)
    setFailure(null)
    // Cleared, not left to outrank what happens next: a stale stream error used
    // to render beside this action's success note.
    stream.clearError()
  }

  async function restart() {
    setArmed(false)
    stream.stop()
    begin('seed')
    try {
      // Through `withPause`, not straight after `stop()`. Seeding deletes all
      // three collections and the server refuses a ward operation while a tick
      // is open, so an unwaited restart simply 409'd whenever it landed inside
      // one — and the recovery control is the worst one to have fail on stage.
      await stream.withPause(async () => {
        await seedWard(DEMO_BACKFILL)
        await refresh()
      })
      setNote(`Rebuilt · ${DEMO_BACKFILL} readings of history`)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the ward could not be rebuilt')
    } finally {
      setBusy(null)
    }
  }

  async function warm() {
    begin('warm')
    try {
      // Holds the stream: the weights load on the one thread that also scores.
      const result = await stream.withPause(warmExplainer)
      setNote(result.was_loaded ? 'Explainer already loaded' : 'Explainer loaded')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the explainer did not load')
    } finally {
      setBusy(null)
    }
  }

  const button = 'inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 '
    + 'text-2xs font-medium transition-colors disabled:cursor-progress disabled:opacity-50'

  return (
    <div className="border-b border-chrome-rule bg-chrome text-chrome-ink">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 sm:px-6">
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.09em] text-chrome-ink-dim">
          Prototype feed
        </span>

        <button
          type="button"
          onClick={() => (stream.streaming ? stream.stop() : stream.start())}
          disabled={busy !== null}
          className={cn(button, 'border-chrome-ink/40 text-chrome-ink hover:border-chrome-ink')}
        >
          {stream.streaming
            ? <><Pause size={12} strokeWidth={2.5} /> Pause</>
            : <><Play size={12} strokeWidth={2.5} /> Stream ward</>}
        </button>

        <button
          type="button"
          onClick={() => (armed ? void restart() : setArmed(true))}
          disabled={busy !== null}
          className={cn(
            button,
            armed
              ? 'border-band-critical-edge text-chrome-ink'
              : 'border-chrome-rule text-chrome-ink-dim hover:text-chrome-ink',
          )}
        >
          <RotateCcw size={12} strokeWidth={2.5} />
          {busy === 'seed' ? 'Rebuilding…' : armed ? 'Delete ward and rebuild?' : 'Restart'}
        </button>

        {armed && busy === null && (
          <button
            type="button"
            onClick={() => setArmed(false)}
            className={cn(button, 'border-chrome-rule text-chrome-ink-dim hover:text-chrome-ink')}
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          onClick={() => void warm()}
          disabled={busy !== null}
          className={cn(button, 'border-chrome-rule text-chrome-ink-dim hover:text-chrome-ink')}
        >
          <Flame size={12} strokeWidth={2.5} />
          {busy === 'warm' ? 'Loading…' : 'Warm explainer'}
        </button>

        <TelemetryToggle open={pipelineOpen} onToggle={onTogglePipeline} />

        <div className="flex shrink-0 items-center gap-1">
          {STREAM_CADENCES.map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => stream.setCadenceMs(ms)}
              aria-pressed={stream.cadenceMs === ms}
              aria-label={`Tick every ${ms / 1000} seconds`}
              className={cn(
                'rounded-[2px] border px-1.5 py-1 font-mono text-2xs tabular-nums transition-colors',
                stream.cadenceMs === ms
                  ? 'border-chrome-ink bg-chrome-ink text-chrome'
                  : 'border-chrome-rule text-chrome-ink-dim hover:text-chrome-ink',
              )}
            >
              {ms / 1000}s
            </button>
          ))}
        </div>

        {/* `aria-live` because a 40 s warm-up finishing is otherwise announced to
            nobody. `failure` outranks a stale stream error; the note is hidden
            while either is showing so they cannot contradict each other. */}
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-2xs">
          {(failure ?? stream.error)
            ? <span className="text-band-critical-edge">{failure ?? stream.error}</span>
            : note
              ? <span className="text-chrome-ink-dim">{note}</span>
              : (
                <span className="hidden text-chrome-ink-dim lg:inline">
                  No hospital feed in this build · each tick is one reading per bed, an hour
                  later on the ward's clock
                </span>
              )}
        </p>

        {stream.streaming && (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-chrome-ink-dim">
            {stream.ticks} sent
          </span>
        )}
      </div>
    </div>
  )
}
