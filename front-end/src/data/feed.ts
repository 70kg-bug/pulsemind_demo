/**
 * The single boundary between the screens and wherever patient data comes from.
 *
 * `WardProvider` does the fetching; the selectors below stay synchronous over
 * data already in memory, which is what let the transport change without
 * touching a component.
 *
 * Two things this file deliberately does NOT do. It never derives a band from a
 * score — `risk_level` is the published band after hysteresis, and comparing the
 * score against a cut brings back the flicker the band table removes. And it
 * never fabricates history: both history functions read stored assessments.
 */

import type {
  Assessment,
  ParameterHistoryPoint,
  ParameterName,
  PatientContext,
  RefusedAssessment,
  RiskBand,
  ScoredAssessment,
} from '@contract/clinical'
import { isScored } from '@contract/clinical'
import { bandRank } from './bands'

/** Relative, because Vite proxies /api to the Node service in development. */
const API = '/api'

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function sendJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`)
  }
  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every bed's current assessment. */
export function fetchWard(): Promise<Assessment[]> {
  return readJson<Assessment[]>('/ward')
}

/** One patient's recent assessments, oldest first. `Assessment[]`, not
 *  `ScoredAssessment[]`: a stay that dipped below the floor has refusals in its
 *  history and the endpoint returns them. Consumers narrow first. */
export function fetchHistory(patientId: string, limit = 14): Promise<Assessment[]> {
  return readJson<Assessment[]>(`/patient/${patientId}/history?limit=${limit}`)
}

/** One parameter's charting history, oldest first. */
export function fetchParameterHistory(
  patientId: string,
  parameterName: ParameterName,
  limit = 24,
): Promise<ParameterHistoryPoint[]> {
  return readJson<ParameterHistoryPoint[]>(
    `/patient/${patientId}/parameter/${parameterName}?limit=${limit}`,
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Advance every bed by one reading. */
export function tickWard(): Promise<{ at: string }> {
  return sendJson('/ward/tick', {})
}

/** Switch an input source off, or back on. */
export function setDeviceOffline(
  patientId: string,
  deviceId: string,
  offline: boolean,
): Promise<{ offline_devices: string[] }> {
  return sendJson(`/patient/${patientId}/device`, { device_id: deviceId, offline })
}

/** Ask the local model to write the explanation. Takes tens of seconds. */
export function generateExplanation(patientId: string): Promise<{
  status: string
  explanation_text: string
  grounding_status: string
}> {
  return sendJson(`/patient/${patientId}/explain`, {})
}

/** Record a clinician's disposition of a prompt. */
export function reviewPrompt(
  promptId: string,
  disposition: string,
  note?: string,
): Promise<unknown> {
  return sendJson(`/prompt/${promptId}/review`, { disposition, note })
}

// ---------------------------------------------------------------------------
// Selectors — synchronous, over data already held by WardProvider
// ---------------------------------------------------------------------------

export function getAssessment(
  ward: Assessment[],
  patientId: string,
): Assessment | undefined {
  return ward.find((assessment) => assessment.patient_id === patientId)
}

/** Scored patients, ordered for triage: open prompt, then published band, then
 *  score. The band is used as given — never re-derived. */
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

/** Patients below the data-sufficiency floor. Listed separately and never
 *  ranked, so a refusal cannot be read as a low score. */
export function dataLimitedPatients(ward: Assessment[]): RefusedAssessment[] {
  return ward.filter((assessment): assessment is RefusedAssessment => !isScored(assessment))
}

export function hasOpenPrompt(assessment: Assessment): boolean {
  return isScored(assessment) && assessment.prompt?.status === 'open'
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

/** One risk assessment, as plotted. Deliberately not called a "data point". */
export interface ScoreObservation {
  at: Date
  score: number
  band: RiskBand
}

/**
 * Stored assessments, as the observation strip plots them.
 *
 * Each point carries the band PUBLISHED at the time, not one computed from its
 * score now. Where the two differ the patient was in a `demoting` stretch, and
 * that difference is the whole reason the strip exists. Refusals are dropped
 * rather than plotted at zero — a gap is the honest rendering of no score.
 */
export function toObservations(history: Assessment[]): ScoreObservation[] {
  return history.filter(isScored).map((assessment) => ({
    at: new Date(assessment.assessed_at),
    score: assessment.risk_score,
    band: assessment.risk_level,
  }))
}

export type { PatientContext }
