import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import {
  dataLimitedPatients,

  hasOpenPrompt,
  matchesQuery,
  rankedPatients,
} from '../data/feed'
import { useWard } from '../data/WardProvider'
import { useWardClock } from '../hooks/useWardClock'
import { cn } from '../lib/cn'
import { pluralise } from '../lib/format'
import { DataLimitedRow } from '../components/board/DataLimitedRow'
import { InputStatusPanel } from '../components/board/InputStatusPanel'
import { PatientRow } from '../components/board/PatientRow'
import { SelectedPatientPanel } from '../components/board/SelectedPatientPanel'
import { SectionHeading } from '../components/ui/SectionHeading'
import { WardScale } from '../components/board/WardScale'
import { Panel } from '../components/ui/Panel'

type Filter = 'all' | 'awaiting' | 'limited'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'awaiting', label: 'Awaiting review' },
  { key: 'limited', label: 'Data-limited' },
]

export function PatientOverviewBoard() {
  const { ward, loading, error } = useWard()
  // Ward time, not browser time: a simulated tick moves the ward an hour, so
  // ages measured against the wall clock would go negative while it streams.
  const { now } = useWardClock(ward)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Null until a bed exists. The ward arrives over the network, so the first
  // render has none — reading `ward[0]` here was safe against a fixture and is
  // not against a fetch.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visible = useMemo(
    () => ward.filter((assessment) => matchesQuery(assessment, query)),
    [ward, query],
  )

  const ranked = rankedPatients(visible)
  const limited = dataLimitedPatients(visible)
  const awaitingCount = ward.filter(hasOpenPrompt).length

  const showRanked = filter !== 'limited' && ranked.length > 0
  const showLimited = filter !== 'awaiting' && limited.length > 0
  const rankedRows = filter === 'awaiting' ? ranked.filter(hasOpenPrompt) : ranked

  const selected = ward.find((assessment) => assessment.patient_id === selectedId) ?? ward[0]

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <p className="text-2xs text-ink-500">Loading the ward…</p>
      </div>
    )
  }

  // A board with no beds is a real state, not an error: the ward has not been
  // seeded. Saying which is more use than an empty screen.
  if (error || ward.length === 0) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <Panel dashed sunken className="max-w-[60ch] px-4 py-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
            {error ? 'The ward could not be loaded' : 'No patients on the board'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-700">
            {error
              ? error
              : 'Nothing has been scored yet. Seed the ward with POST /api/ward/seed.'}
          </p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col px-4 py-3 sm:px-6 xl:h-full xl:min-h-0">
      {/* The one display-tier element on the screen. Everything else is text.
          Set down from 4xl/5xl: at 49-61px it and its note cost 116px of a
          876px screen, which is two ward beds. The tier survives — deleting the
          h1 would remove display type from the board entirely — but it earns
          its space on one line beside the note.

          ⚠️ Now `text-xl`, down from `text-2xl`. The comment above said "24px"
          while the class said 2xl, which is 31 — it had been describing an
          intention rather than the screen.

          ⚠️ And this is NOT where the height is. Measured on an 876px viewport
          at an 18px root — the largest scale tried, so the most favourable case
          for finding room here — the block was 77px of which the h1 was 27 and
          the NOTE was 69. They sit side by side, so the taller one sets the
          height: dropping the h1 a step bought SIX PIXELS. Widening the note's
          `56ch` measure would recover ~23px and is not worth the reading
          comfort. The board's real height is in the bed rows, seven of them at
          87px, each carrying an "awaiting clinician review" banner. Do not come
          here expecting to find it. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
        <h1 className="display text-xl text-ink-950">Adult ventilated ICU patients</h1>
        <p className="max-w-[56ch] text-xs leading-relaxed text-ink-700">
          A prompt is raised only when a band change is sustained and confirmed — roughly one
          in every 34 readings. A patient held at HIGH for six hours is one interruption, not
          seventy.
        </p>
      </div>

      {/* The ward on one calibrated axis. Segment widths are the real cut points, so the
          geometry says something true: most readings sit in a band that occupies an
          eighth of the scale, and nearly half the scale is CRITICAL. */}
      <div className="mb-2 shrink-0 border-y border-rule py-2">
        <SectionHeading
          className="mb-2"
          trailing={`${ranked.length} scored · ${limited.length} data-limited`}
        >
          Respiratory-risk scale
        </SectionHeading>
        {/* Past the loading guard the ward is non-empty, so `selected` exists. */}
        <WardScale
          patients={ranked}
          selectedId={selected.patient_id}
          onSelect={setSelectedId}
        />
      </div>

      {/* `min-h-0` on the row AND on both panes: without it each flex child
          keeps its automatic minimum height, refuses to shrink, and the
          overflow rule never applies — the page just grows again. */}
      <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row xl:items-stretch">
        <section className="flex min-w-0 flex-1 flex-col gap-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
          <Panel className="flex flex-wrap items-center gap-3 p-2.5">
            <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-[2px] border border-rule bg-surface-sunken px-2.5">
              <Search size={14} strokeWidth={2} className="shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search bed or patient ID"
                className="w-full bg-transparent py-2 font-mono text-2xs text-ink-950 outline-none placeholder:text-ink-400"
              />
            </label>

            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  className={cn(
                    'rounded-[2px] border px-2.5 py-1.5 text-2xs font-medium transition-colors',
                    filter === option.key
                      ? 'border-ink-950 bg-ink-950 text-surface'
                      : 'border-rule bg-surface text-ink-700 hover:border-rule-strong',
                  )}
                >
                  {option.label}
                  {option.key === 'awaiting' && awaitingCount > 0 && (
                    <span className="ml-1.5 font-mono tabular-nums opacity-70">
                      {awaitingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Panel>

          {showRanked && (
            <div>
              <SectionHeading
                className="mb-2 px-1"
                trailing={`${pluralise(rankedRows.length, 'patient')} · prompt first, then band`}
              >
                Triage board · ranked
              </SectionHeading>
              <Panel className="overflow-hidden">
                {rankedRows.map((assessment) => (
                  <PatientRow
                    key={assessment.patient_id}
                    assessment={assessment}
                    selected={assessment.patient_id === selectedId}
                    onSelect={() => setSelectedId(assessment.patient_id)}
                    now={now}
                  />
                ))}
              </Panel>
            </div>
          )}

          {showLimited && (
            <div className="mt-1">
              <SectionHeading
                className="mb-2 px-1"
                trailing={`${pluralise(limited.length, 'patient')} below the sufficiency floor`}
              >
                Data-limited · not ranked
              </SectionHeading>
              <Panel dashed sunken className="overflow-hidden">
                {limited.map((assessment) => (
                  <DataLimitedRow
                    key={assessment.patient_id}
                    assessment={assessment}
                    selected={assessment.patient_id === selectedId}
                    onSelect={() => setSelectedId(assessment.patient_id)}
                    now={now}
                  />
                ))}
              </Panel>
            </div>
          )}

          {rankedRows.length === 0 && limited.length === 0 && (
            <Panel dashed sunken className="px-4 py-10 text-center">
              <p className="text-2xs text-ink-500">
                {query
                  ? `No patient matches “${query}” in this filter.`
                  : 'No patient in this filter.'}
              </p>
            </Panel>
          )}
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 xl:min-h-0 xl:w-[23rem] xl:overflow-y-auto xl:pl-1">
          <SelectedPatientPanel assessment={selected} now={now} />
          <InputStatusPanel
            devices={selected.devices}
            now={now}
            patientId={selected.patient_id}
          />
        </aside>
      </div>
    </div>
  )
}
