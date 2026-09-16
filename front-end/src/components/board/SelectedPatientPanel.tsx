import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import type { Assessment } from '@contract/clinical'
import { isScored } from '@contract/clinical'
import { SUFFICIENCY_FLOOR, toObservations } from '../../data/feed'
import { usePatientHistory } from '../../hooks/useApi'
import { useWard } from '../../data/WardProvider'
import { bandMeaning } from '../../data/bands'
import { formatPercent, formatScore } from '../../lib/format'
import { BandTag } from '../ui/BandTag'
import { SectionHeading } from '../ui/SectionHeading'
import { Panel } from '../ui/Panel'
import { BreathRhythm } from '../charts/BreathRhythm'
import { ObservationStrip } from '../charts/ObservationStrip'

interface SelectedPatientPanelProps {
  assessment: Assessment
  now: Date
}

/** The side panel: what the board's selected patient looks like up close. */
export function SelectedPatientPanel({ assessment }: SelectedPatientPanelProps) {
  // Refetched whenever the ward is re-read, so the strip cannot disagree with
  // the board beside it.
  const { revision } = useWard()
  const { data: history } = usePatientHistory(assessment.patient_id, revision)
  return (
    <Panel className="p-4">
      <SectionHeading trailing={assessment.patient_id}>Selected patient</SectionHeading>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-lg font-medium text-ink-950">{assessment.bed_code}</h2>
        {isScored(assessment) && <BandTag band={assessment.risk_level} size="lg" />}
      </div>

      {isScored(assessment) ? (
        <>
          <div className="mt-4 flex items-end gap-3 border-t border-rule-faint pt-4">
            <span className="font-num text-4xl leading-none tabular-nums text-ink-950">
              {formatScore(assessment.risk_score)}
            </span>
            <span className="pb-1 text-2xs text-ink-500">
              calibrated probability
              <br />
              of respiratory deterioration
              <br />
              within 6 hours
            </span>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            {bandMeaning(assessment.risk_level)}
          </p>

          {/* One instance only, on the selected patient. Never on the rows themselves:
              viewers track three to four moving objects, and sub-Hz rate differences are
              imperceptible, so a breathing board would be noise carrying no signal. */}
          <div className="mt-5 border-t border-rule-faint pt-4">
            <SectionHeading className="mb-2">Ventilation</SectionHeading>
            <BreathRhythm assessment={assessment} band={assessment.risk_level} size="rail" />
          </div>

          <div className="mt-5 border-t border-rule-faint pt-4">
            <SectionHeading className="mb-3">Assessment history</SectionHeading>
            <ObservationStrip observations={toObservations(history ?? [])} />
          </div>

          {assessment.contributors.length > 0 && (
            <div className="mt-5 border-t border-rule-faint pt-4">
              <SectionHeading className="mb-2">Largest contribution</SectionHeading>
              <p className="text-sm text-ink-950">{assessment.contributors[0].feature_name}</p>
              <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-500">
                {formatPercent(assessment.contributors[0].share_of_decision, 1)} of this reading
                {assessment.contributors[0].is_imputed && ' · rests on a population default'}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 border-t border-rule-faint pt-4">
          <p className="text-sm text-ink-950">No score published for this reading.</p>
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            Too much of this reading rests on population defaults rather than measurements of
            this patient, so PulseMind publishes nothing rather than a number that is not
            about them. No prompt is raised.
          </p>
          <p className="mt-3 font-mono text-2xs tabular-nums text-ink-500">
            {formatPercent(assessment.imputed_share)} defaulted · floor is{' '}
            {formatPercent(SUFFICIENCY_FLOOR)}
          </p>
        </div>
      )}

      <Link
        to={`/patient/${assessment.patient_id}`}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-[2px] bg-ink-950 px-4 py-2.5 text-sm font-medium text-surface transition-colors hover:bg-accent"
      >
        Open patient detail
        <ArrowRight size={15} strokeWidth={2} />
      </Link>
    </Panel>
  )
}
