import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import type { Disposition } from '@contract/clinical'
import { isScored } from '@contract/clinical'
import { SUFFICIENCY_FLOOR, reviewPrompt, toObservations } from '../data/feed'
import { useAssessment, useWard } from '../data/WardProvider'
import { bandMeaning } from '../data/bands'
import { useWardClock } from '../hooks/useWardClock'
import { usePatientHistory } from '../hooks/useApi'
import {
  BAND_STATE_LABEL,
  BAND_STATE_MEANING,
  INSUFFICIENCY_REASON_LABEL,
} from '../lib/bandStyles'
import { formatClock, formatPercent, formatScore, pluralise } from '../lib/format'
import { BandScale } from '../components/charts/BandScale'
import { BreathRhythm } from '../components/charts/BreathRhythm'
import { ObservationStrip } from '../components/charts/ObservationStrip'
import { ContributorList } from '../components/detail/ContributorList'
import { ExplanationPanel } from '../components/detail/ExplanationPanel'
import { ParameterTable } from '../components/detail/ParameterTable'
import { PromptBanner } from '../components/detail/PromptBanner'
import { PatientContextDrawer } from '../components/detail/PatientContextDrawer'
import { BandTag } from '../components/ui/BandTag'
import { SectionHeading } from '../components/ui/SectionHeading'
import { Panel } from '../components/ui/Panel'

export function PatientDetail() {
  const { patientId = '' } = useParams()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const { refresh, ward, revision } = useWard()
  const { now } = useWardClock(ward)
  const assessment = useAssessment(patientId)
  const { data: history } = usePatientHistory(patientId, revision)

  if (!assessment) {
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <p className="text-2xs text-ink-500">No patient with ID {patientId}.</p>
        <Link to="/" className="mt-3 inline-block text-2xs text-accent">
          Back to overview
        </Link>
      </div>
    )
  }

  const scored = isScored(assessment) ? assessment : null
  const promptIsOpen = scored?.prompt?.status === 'open'
  // `disposition` and not the object: a review is only a review once someone
  // has recorded one, and an empty shell renders as "closed as at NaN:NaN:NaN".
  const review = scored?.review?.disposition ? scored.review : null

  // The disposition is persisted, not held in component state. It is the only
  // human-authored record in the system, and the screen previously said "Review
  // recorded" having sent nothing at all.
  const recordDisposition = async (disposition: Disposition) => {
    const promptId = scored?.prompt?._id
    if (!promptId) {
      setReviewError('this prompt has no id -- re-seed the ward')
      return
    }
    setRecording(true)
    setReviewError(null)
    try {
      await reviewPrompt(promptId, disposition)
      await refresh()
    } catch (failure) {
      setReviewError(failure instanceof Error ? failure.message : 'the review was not recorded')
    } finally {
      setRecording(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-2xs text-ink-500 transition-colors hover:text-accent"
          >
            <ArrowLeft size={13} strokeWidth={2} />
            Back to overview
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-medium text-ink-950">
              {assessment.bed_code}
            </h1>
            <span className="font-mono text-2xs text-ink-500">
              {assessment.patient_id} · {assessment.unit}
            </span>
            {scored && <BandTag band={scored.risk_level} size="lg" />}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-[2px] border border-rule-strong bg-surface px-3 py-2 text-2xs text-ink-950 transition-colors hover:border-ink-950"
        >
          View patient context
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {promptIsOpen && scored?.prompt && (
          <PromptBanner
            prompt={scored.prompt}
            driverName={scored.contributors[0]?.feature_name ?? 'No ranked driver'}
            driverShare={scored.contributors[0]?.share_of_decision ?? 0}
            now={now}
            busy={recording}
            onDispose={(disposition) => void recordDisposition(disposition)}
          />
        )}

        {reviewError && (
          <Panel className="px-4 py-2.5">
            <span className="text-2xs text-ink-700">
              The review was not recorded: {reviewError}
            </span>
          </Panel>
        )}

        {review && (
          <Panel className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-[0.09em] text-verified">
              Review recorded
            </span>
            <span className="text-2xs text-ink-700">
              Prompt closed as <span className="font-medium">{review.disposition}</span> at{' '}
              {formatClock(new Date(review.reviewed_at))}
              {review.attributed
                ? ` by ${review.clinician}.`
                : ' — not attributed to a named clinician, because this build has no authentication.'}
            </span>
          </Panel>
        )}

        {!isScored(assessment) && (
          <Panel dashed sunken className="px-4 py-4">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
              No score published for this reading
            </p>
            <p className="mt-2 max-w-[70ch] text-xs leading-relaxed text-ink-700">
              {INSUFFICIENCY_REASON_LABEL[assessment.insufficiency_reason]} PulseMind reports
              nothing rather than a score that is not sufficiently about this patient. No risk
              level is published and no prompt is raised.
            </p>
            <p className="mt-2 font-mono text-2xs tabular-nums text-ink-500">
              {formatPercent(assessment.imputed_share)} of inputs defaulted ·{' '}
              {formatPercent(assessment.documentation_share)} charting · floor is{' '}
              {formatPercent(SUFFICIENCY_FLOOR)}
            </p>
          </Panel>
        )}

        {scored && (
          <>
            <Panel className="p-4">
              <SectionHeading trailing={`last ${history?.length ?? 0} readings`}>Assessment history</SectionHeading>
              <div className="mt-4">
                <ObservationStrip observations={toObservations(history ?? [])} />
              </div>
            </Panel>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <Panel className="flex-1 p-4 lg:max-w-[20rem]">
                <SectionHeading>Respiratory-risk score</SectionHeading>
                <div className="mt-4 flex items-end gap-3">
                  <span className="font-num text-4xl leading-none tabular-nums text-ink-950">
                    {formatScore(scored.risk_score)}
                  </span>
                  <span className="pb-1 text-2xs leading-snug text-ink-500">
                    within
                    <br />6 hours
                  </span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  {bandMeaning(scored.risk_level)}
                </p>
                <BandScale
                  score={scored.risk_score}
                  band={scored.risk_level}
                  className="mt-5 border-t border-rule-faint pt-4"
                />

                {/* Runs at this patient's charted respiratory rate. The band sets only
                    how deep the breath is — severity never sets the rate. */}
                <div className="mt-5 border-t border-rule-faint pt-4">
                  <p className="field-label mb-2">Ventilation rhythm</p>
                  <BreathRhythm assessment={scored} band={scored.risk_level} />
                </div>
              </Panel>

              <Panel className="flex-1 p-4 lg:max-w-[22rem]">
                <SectionHeading>Reading state</SectionHeading>
                <dl className="mt-2">
                  {[
                    ['Published band', scored.risk_level],
                    ['Band state', BAND_STATE_LABEL[scored.band_state]],
                    ['Held for', pluralise(scored.readings_in_state, 'reading')],
                    ['Score alone implies', scored.instant_level],
                    // Named "model inputs" on purpose. This is a share over the model's
                    // whole feature set, not over the eleven parameters shown below,
                    // and the two figures are never equal.
                    [
                      'Model inputs defaulted',
                      `${formatPercent(scored.imputed_share)} · ${formatPercent(scored.documentation_share)} charting`,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-3 border-t border-rule-faint py-2 first:border-t-0"
                    >
                      <dt className="text-2xs text-ink-500">{label}</dt>
                      <dd className="text-right font-mono text-2xs tabular-nums text-ink-950">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 border-t border-rule-faint pt-2.5 text-xs leading-relaxed text-ink-500">
                  {BAND_STATE_MEANING[scored.band_state]}
                </p>

              </Panel>

              <Panel className="min-w-0 flex-[1.6] p-4">
                <SectionHeading trailing="point-in-time · this reading">Ranked factors</SectionHeading>
                <div className="mt-2">
                  <ContributorList contributors={scored.contributors} />
                </div>
              </Panel>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <Panel className="min-w-0 flex-[1.6] p-4">
                <SectionHeading>Plain-language explanation</SectionHeading>
                <div className="mt-3">
                  <ExplanationPanel
                    explanation={scored.explanation}
                    patientId={scored.patient_id}
                    assessedAt={scored.assessed_at}
                  />
                </div>
              </Panel>

              <Panel className="min-w-0 flex-1 p-4">
                <SectionHeading>Guideline references</SectionHeading>
                {scored.citations.length > 0 ? (
                  <>
                    <ul className="mt-2">
                      {scored.citations.map((citation) => (
                        <li
                          key={citation.source}
                          className="border-t border-rule-faint py-2.5 first:border-t-0"
                        >
                          <p className="text-xs leading-relaxed text-ink-800">
                            {citation.claim}
                          </p>
                          <p className="mt-1 font-mono text-xs text-ink-400">
                            {citation.source}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 border-t border-rule-faint pt-2.5 text-xs text-ink-400">
                      Retrieved from a fixed approved library — not generated. Prototype uses
                      sample citations.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-2xs text-ink-500">
                    No references retrieved for this reading.
                  </p>
                )}
              </Panel>
            </div>
          </>
        )}

        <Panel className="p-4">
          <SectionHeading trailing={`synchronised ${formatClock(now)}`}>Respiratory parameters</SectionHeading>
          <div className="mt-3">
            <ParameterTable
              patientId={assessment.patient_id}
              parameters={assessment.parameters}
              contributors={scored?.contributors ?? []}
            />
          </div>
        </Panel>
      </div>

      <PatientContextDrawer
        patientId={assessment.patient_id}
        bedCode={assessment.bed_code}
        devices={assessment.devices}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
