/**
 * The single boundary between the screens and wherever patient data comes from.
 *
 * Today it reads the simulated ward in `mockFeed.ts`. When a real transport is agreed,
 * only this file changes — no component imports `mockFeed` directly.
 */

import type {
  Assessment,
  ParameterHistoryPoint,
  ParameterName,
  PatientContext,
  RefusedAssessment,
  ScoredAssessment,
} from '../types/clinical'
import { isScored } from '../types/clinical'
import { bandRank } from './bands'
import { parametersFromSource } from './deviceSources'
import { parameterHistory, scoreHistory, type ScoreObservation } from './history'
import { PATIENT_CONTEXT, WARD } from './mockFeed'

export function getWard(): Assessment[] {
  return WARD
}

export function getAssessment(patientId: string): Assessment | undefined {
  return WARD.find((assessment) => assessment.patient_id === patientId)
}

export function getPatientContext(patientId: string): PatientContext | undefined {
  return PATIENT_CONTEXT[patientId]
}

/**
 * Patients that produced a score, ordered for triage: an open prompt first, then by
 * published band, then by score. The published band is used as given — never re-derived.
 */
export function rankedPatients(ward: Assessment[]): ScoredAssessment[] {
  return ward
    .filter(isScored)
    .slice()
    .sort((a, b) => {
      const promptDifference = Number(hasOpenPrompt(b)) - Number(hasOpenPrompt(a))
      if (promptDifference !== 0) {
        return promptDifference
      }
      const bandDifference = bandRank(b.risk_level) - bandRank(a.risk_level)
      if (bandDifference !== 0) {
        return bandDifference
      }
      return b.risk_score - a.risk_score
    })
}

/**
 * Patients whose latest reading fell below the data-sufficiency floor. They are listed
 * separately and never ranked, so a refusal cannot be read as a low score.
 */
export function dataLimitedPatients(ward: Assessment[]): RefusedAssessment[] {
  return ward.filter((assessment): assessment is RefusedAssessment => !isScored(assessment))
}

export function hasOpenPrompt(assessment: Assessment): boolean {
  return isScored(assessment) && assessment.prompt?.status === 'open'
}

/** Recent assessments for one patient, as independent observations. */
export function getScoreHistory(assessment: ScoredAssessment, now: Date): ScoreObservation[] {
  return scoreHistory(assessment.patient_id, assessment.risk_score, now)
}

/** Charting history for one parameter, carrying provenance per point. */
export function getParameterHistory(
  assessment: Assessment,
  parameterName: ParameterName,
  now: Date,
): ParameterHistoryPoint[] {
  const reading = assessment.parameters.find(
    (parameter) => parameter.parameter_name === parameterName,
  )
  return parameterHistory(
    assessment.patient_id,
    parameterName,
    reading?.value ?? null,
    reading?.source ?? 'cohort_default',
    now,
  )
}

/**
 * How much of a reading each parameter a lost source carries is assumed to be worth.
 *
 * Calibrated so the ventilator — which supplies eight of the eleven parameters — takes
 * every patient below the floor on its own, while the bedside monitor degrades the
 * shares without silencing the board. That is the honest outcome: a ventilation risk
 * model without the ventilator feed genuinely has nothing left to score.
 */
const SHARE_PER_LOST_PARAMETER = 0.04

/**
 * Recompute the ward with some input sources switched off.
 *
 * Pure, so the provider holds the set of offline device IDs and nothing else. The
 * consequences follow the real contract: a lost source means its parameters stop being
 * measured and are carried forward instead, and enough carried-forward inputs pushes the
 * reading below the data-sufficiency floor, at which point no score may be published.
 *
 * ⚠️ Two parts of this are simulation, not schema. The device-to-parameter mapping in
 * `deviceSources.ts` is a prototype assumption, and the `imputed_share` delta applied
 * here is a stand-in for a model-side quantity the frontend cannot compute. Both are
 * labelled in the UI.
 */
export function applyOfflineDevices(ward: Assessment[], offline: Set<string>): Assessment[] {
  if (offline.size === 0) {
    return ward
  }

  return ward.map((assessment) => {
    const lostSources = assessment.devices.filter((device) => offline.has(device.device_id))
    if (lostSources.length === 0) {
      return assessment
    }

    const lostParameters = new Set(
      lostSources.flatMap((device) => parametersFromSource(device.label)),
    )

    const devices = assessment.devices.map((device) =>
      offline.has(device.device_id) ? { ...device, state: 'offline' as const } : device,
    )

    // A lost source does not erase its last value — it stops refreshing it.
    const parameters = assessment.parameters.map((reading) =>
      lostParameters.has(reading.parameter_name) && reading.source === 'measured'
        ? { ...reading, source: 'carried_forward' as const, age_minutes: reading.age_minutes ?? 0 }
        : reading,
    )

    // The delta is over every parameter the lost source supplies, not only the ones
    // that happened to be freshly measured — the model loses the whole feed, not just
    // this instant's values.
    const imputedShare = Math.min(
      0.95,
      assessment.imputed_share + lostParameters.size * SHARE_PER_LOST_PARAMETER,
    )

    // Below the floor, nothing may be published — not a low score, nothing.
    if (isScored(assessment) && imputedShare > SUFFICIENCY_FLOOR) {
      const refused: RefusedAssessment = {
        patient_id: assessment.patient_id,
        bed_code: assessment.bed_code,
        unit: assessment.unit,
        assessed_at: assessment.assessed_at,
        assessment_status: 'insufficient_data',
        insufficiency_reason: 'imputed_share_above_floor',
        readings_since_admission: assessment.readings_in_state,
        imputed_share: imputedShare,
        documentation_share: assessment.documentation_share,
        parameters,
        devices,
      }
      return refused
    }

    return { ...assessment, parameters, devices, imputed_share: imputedShare }
  })
}

/** Above this share of defaulted inputs, no score is published. */
export const SUFFICIENCY_FLOOR = 0.3

/** Search by patient ID or bed code, matching the board's search field. */
export function matchesQuery(assessment: Assessment, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return true
  }
  return (
    assessment.patient_id.toLowerCase().includes(needle) ||
    assessment.bed_code.toLowerCase().includes(needle)
  )
}

export type { ScoreObservation }
