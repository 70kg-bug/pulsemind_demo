import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import type { ParameterName } from '@contract/clinical'
import { isScored } from '@contract/clinical'
import { useParameterHistory } from '../hooks/useApi'
import { useAssessment } from '../data/WardProvider'
import { PARAMETERS } from '../data/parameters'
import { PROVENANCE_STYLES } from '../lib/bandStyles'
import { cn } from '../lib/cn'
import { formatAge, formatPercent, formatValue } from '../lib/format'
import { ProvenanceTrace } from '../components/charts/ProvenanceTrace'
import { SectionHeading } from '../components/ui/SectionHeading'
import { Panel } from '../components/ui/Panel'
import { ProvenanceValue } from '../components/ui/ProvenanceValue'

export function ParameterDetail() {
  const { patientId = '', parameterName = '' } = useParams()

  const assessment = useAssessment(patientId)
  const definition = PARAMETERS.find((parameter) => parameter.name === parameterName)

  // Before the early return, not after. On a deep link the ward has not loaded
  // yet, so `assessment` is undefined on the first render and defined on the
  // next -- a hook below the guard is called a different number of times each
  // time, which React treats as a fatal error. Empty until the request lands;
  // the hook reports `null` before the first response, so a destructuring
  // default would not cover it.
  const loaded = useParameterHistory(patientId, parameterName as ParameterName)
  const history = loaded.data ?? []

  const reading = assessment?.parameters.find((p) => p.parameter_name === parameterName)
  if (!assessment || !definition || !reading) {
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <p className="text-2xs text-ink-500">No such parameter.</p>
        <Link to="/" className="mt-3 inline-block text-2xs text-accent">
          Back to overview
        </Link>
      </div>
    )
  }

  const provenance = PROVENANCE_STYLES[reading.source]

  const isScoreFactor =
    isScored(assessment) &&
    assessment.contributors.some((contributor) => contributor.parameter === definition.name)

  const measuredCount = history.filter((point) => point.source === 'measured').length

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            to={`/patient/${patientId}`}
            className="inline-flex items-center gap-1.5 text-2xs text-ink-500 transition-colors hover:text-accent"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Back to {assessment.bed_code}
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-[-0.015em] text-ink-950">
            {definition.label}
          </h1>
          <p className="mt-0.5 text-2xs text-ink-500">
            {definition.description} · {assessment.patient_id}
          </p>
        </div>

        {/* Parameter switcher. Eleven is the whole frozen set, so it fits on one strip. */}
        <nav className="flex max-w-full flex-wrap gap-1.5">
          {PARAMETERS.map((parameter) => (
            <Link
              key={parameter.name}
              to={`/patient/${patientId}/parameter/${parameter.name}`}
              className={cn(
                'rounded-[2px] border px-2 py-1 font-mono text-xs transition-colors',
                parameter.name === definition.name
                  ? 'border-ink-950 bg-ink-950 text-surface'
                  : 'border-rule bg-surface text-ink-500 hover:border-rule-strong',
              )}
            >
              {parameter.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Panel className="p-4">
            <SectionHeading>Current value</SectionHeading>
            <div className="mt-3">
              <ProvenanceValue
                value={reading.value}
                unit={reading.unit}
                source={reading.source}
                decimals={definition.decimals}
                size="hero"
              />
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionHeading>Source</SectionHeading>
            <p className={cn('mt-3 text-sm font-medium', provenance.ink)}>
              {provenance.glyph && <span aria-hidden="true">{provenance.glyph} </span>}
              {provenance.label}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{provenance.meaning}</p>
          </Panel>

          <Panel className="p-4">
            <SectionHeading>Last measured</SectionHeading>
            {reading.source === 'population_reference' ? (
              <>
                <p className="mt-3 font-num text-lg text-ink-950">Never</p>
                <p className="mt-1.5 text-2xs text-ink-500">
                  No measurement on record for this patient.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 font-num text-lg tabular-nums text-ink-950">
                  {formatAge(reading.age_minutes)}
                </p>
                <p className="mt-1.5 text-2xs text-ink-500">
                  {measuredCount} of the last {history.length} readings were measured.
                </p>
              </>
            )}
          </Panel>

          <Panel className="p-4">
            <SectionHeading>Model use</SectionHeading>
            <p
              className={cn(
                'mt-3 text-sm font-medium',
                isScoreFactor ? 'text-ink-950' : 'text-ink-500',
              )}
            >
              {isScoreFactor ? 'Score factor' : 'Available'}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              {isScoreFactor
                ? 'Among the ranked drivers of the current reading.'
                : 'Available to the model, not among the ranked drivers.'}
            </p>
          </Panel>
        </div>

        <Panel className="p-4">
          <SectionHeading trailing={`last ${history.length} readings`}>Charting provenance</SectionHeading>
          <div className="mt-4">
            <ProvenanceTrace history={history} definition={definition} />
          </div>
        </Panel>

        <div className="flex flex-col gap-4 lg:flex-row">
          <Panel className="min-w-0 flex-[1.4] p-4">
            <SectionHeading>Population default</SectionHeading>
            <div className="mt-3 flex flex-wrap items-end gap-8">
              <div>
                <p className="text-2xs text-ink-500">Value substituted when missing</p>
                <p className="mt-1 font-num text-2xl tabular-nums text-ink-950">
                  {formatValue(definition.cohortDefaultValue, definition.decimals)}
                  <span className="ml-1 font-sans text-2xs text-ink-500">{definition.unit}</span>
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xs text-ink-500">Defaulted across the training cohort</p>
                <p
                  className={cn(
                    'mt-1 font-num text-2xl tabular-nums',
                    definition.cohortDefaultRate >= 0.5 ? 'text-prov-default' : 'text-ink-950',
                  )}
                >
                  {formatPercent(definition.cohortDefaultRate, 1)}
                </p>
                <span className="mt-2 block h-[5px] w-full overflow-hidden rounded-[2px] bg-rule-faint">
                  <span
                    className={cn(
                      'block h-full rounded-[2px]',
                      definition.cohortDefaultRate >= 0.5 ? 'bg-prov-default' : 'bg-ink-800',
                    )}
                    style={{ width: `${definition.cohortDefaultRate * 100}%` }}
                  />
                </span>
              </div>
            </div>
            <p className="mt-4 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-500">
              Used only when no measured or recent value is available, and flagged wherever it
              drives a score.
              {!definition.rateIsMeasured && ' Prototype figure — not a published rate.'}
            </p>
          </Panel>

          <Panel className="min-w-0 flex-1 p-4">
            <SectionHeading>Parameter metadata</SectionHeading>
            <dl className="mt-2">
              {[
                ['Unit', definition.unit],
                [
                  'Display range',
                  `${definition.displayRange[0]}–${definition.displayRange[1]} ${definition.unit}`,
                ],
                ['Group', definition.group],
                ['Score factor', isScoreFactor ? 'Yes' : 'No'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-3 border-t border-rule-faint py-2 first:border-t-0"
                >
                  <dt className="text-2xs text-ink-500">{label}</dt>
                  <dd className="text-right font-mono text-2xs text-ink-950">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  )
}
