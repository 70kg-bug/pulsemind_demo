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
  Explanation,
  ParameterHistoryPoint,
  ParameterName,
  PatientContext,
  RefusedAssessment,
  RiskBand,
  ScoredAssessment,
} from '@contract/clinical'
import { isScored } from '@contract/clinical'

import * as telemetry from './telemetry'
import { bandRank } from './bands'

/** Relative, because Vite proxies /api to the Node service in development. */
const API = '/api'

/**
 * The API answers a failure with RFC 9457 `problem+json`, or with a `message`.
 * Read it: a status code alone turns "seeding needs PM_ALLOW_DESTRUCTIVE" and
 * "the ward was never seeded" into the same unactionable number on screen.
 */
async function failure(path: string, response: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await response.json()
    const raw = body?.detail ?? body?.message
    // FastAPI's validation errors put an ARRAY of objects in `detail`, so the
    // obvious read renders as "[object Object]" on screen. Flatten to the
    // messages, which is the part a reader can act on.
    detail = Array.isArray(raw)
      ? raw.map((item) => item?.msg ?? JSON.stringify(item)).join('; ')
      : typeof raw === 'string' ? raw : ''
  } catch {
    // A non-JSON body is itself worth nothing to a reader; fall through.
  }
  return new Error(detail || `${path} returned ${response.status}`)
}

/**
 * Every request the dashboard makes passes through here, which is why the
 * telemetry log can be honest about coverage: one place to instrument, and a
 * call that skipped it would be a call the panel silently never showed.
 *
 * `route` is the TEMPLATE, passed in rather than derived from `path`. Deriving
 * it would mean pattern-matching identifiers back out of a URL, and getting
 * that subtly wrong puts a patient id on screen. The server logs the matched
 * route for the same reason (PM-LOG-001).
 */
async function readJson<T>(path: string, route: string): Promise<T> {
  const settle = telemetry.begin('GET', route)
  const started = performance.now()
  let response: Response
  try {
    response = await fetch(`${API}${path}`)
  } catch (transportFailure) {
    // A refused connection never produces a response, and a log that only shows
    // completed calls hides exactly the case someone is debugging.
    settle({ clientMs: performance.now() - started, failed: true })
    throw transportFailure
  }
  settle({
    status: response.status,
    headers: response.headers,
    clientMs: performance.now() - started,
    failed: !response.ok,
  })
  if (!response.ok) {
    throw await failure(path, response)
  }
  return response.json() as Promise<T>
}

async function sendJson<T>(path: string, route: string, body: unknown): Promise<T> {
  const settle = telemetry.begin('POST', route)
  const started = performance.now()
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (transportFailure) {
    settle({ clientMs: performance.now() - started, failed: true })
    throw transportFailure
  }
  settle({
    status: response.status,
    headers: response.headers,
    clientMs: performance.now() - started,
    failed: !response.ok,
  })
  if (!response.ok) {
    throw await failure(path, response)
  }
  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every bed's current assessment. */
export function fetchWard(): Promise<Assessment[]> {
  return readJson<Assessment[]>('/ward', '/ward')
}

/** One patient's recent assessments, oldest first. `Assessment[]`, not
 *  `ScoredAssessment[]`: a stay that dipped below the floor has refusals in its
 *  history and the endpoint returns them. Consumers narrow first. */
export function fetchHistory(patientId: string, limit = 14): Promise<Assessment[]> {
  return readJson<Assessment[]>(
    `/patient/${patientId}/history?limit=${limit}`,
    '/patient/:id/history',
  )
}

/** Borrowed demographics and comorbidities. Recorded context, not a prediction.
 *
 *  Here rather than hand-rolled in the hook that uses it: it used to call
 *  `fetch` directly, which meant it neither parsed a problem+json body nor
 *  appeared in the telemetry log — one invisible call is enough to make the
 *  log's coverage a claim rather than a property. */
export function fetchPatientContext(patientId: string): Promise<PatientContext> {
  return readJson<PatientContext>(`/patient/${patientId}/context`, '/patient/:id/context')
}

/** One parameter's charting history, oldest first. */
export function fetchParameterHistory(
  patientId: string,
  parameterName: ParameterName,
  limit = 24,
): Promise<ParameterHistoryPoint[]> {
  return readJson<ParameterHistoryPoint[]>(
    `/patient/${patientId}/parameter/${parameterName}?limit=${limit}`,
    '/patient/:id/parameter/:name',
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Advance every bed by one reading. `at` is the ward's own clock, which a tick
 *  moves forward an hour — not the wall clock. */
export function tickWard(): Promise<{ at: string }> {
  return sendJson('/ward/tick', '/ward/tick', {})
}

/** Rebuild the ward from nothing.
 *
 *  DESTRUCTIVE: it deletes every assessment, prompt and stay state, and the
 *  server refuses unless PM_ALLOW_DESTRUCTIVE is set. Why the demo passes the
 *  backfill it does is at `DEMO_BACKFILL`, not here. */
export function seedWard(backfillTicks: number): Promise<{ patients: number }> {
  return sendJson('/ward/seed', '/ward/seed', { backfill_ticks: backfillTicks })
}

/** Load the 7B before anyone asks for an explanation. Stores nothing: the
 *  alternative, explaining some bed to warm the weights, leaves a real
 *  explanation attached to a reading nobody asked about. */
export function warmExplainer(): Promise<{ explainer: string; was_loaded: boolean }> {
  return sendJson('/ward/warmup', '/ward/warmup', {})
}

/** Switch input sources off, or back on.
 *
 *  Takes a LIST because the server's write is read-modify-write on one array:
 *  three restores as three requests read the same list, saved last-write-wins,
 *  and exactly one device came back. Each response was individually correct,
 *  which is why it looked like nothing was wrong. */
export function setDevicesOffline(
  patientId: string,
  deviceIds: string[],
  offline: boolean,
): Promise<{ offline_devices: string[] }> {
  return sendJson(`/patient/${patientId}/device`, '/patient/:id/device', {
    device_ids: deviceIds,
    offline,
  })
}

/** Ask the local model to write the explanation. Takes tens of seconds.
 *
 *  `assessedAt` names the reading to explain. Worth passing whenever the board
 *  is moving: generation takes 18-23 s, and the server's default of "the latest"
 *  is resolved when the request arrives, so the text can land on a row several
 *  readings older than the one the clinician was looking at.
 *
 *  `useLlm: false` selects the deterministic template instead — no GPU, instant,
 *  and the only way to exercise this path on a busy card. */
export function generateExplanation(
  patientId: string,
  options: { assessedAt?: string; useLlm?: boolean } = {},
): Promise<Explanation> {
  return sendJson(`/patient/${patientId}/explain`, '/patient/:id/explain', {
    ...(options.assessedAt ? { assessed_at: options.assessedAt } : {}),
    ...(options.useLlm === false ? { use_llm: false } : {}),
  })
}

/** Record a clinician's disposition of a prompt. */
export function reviewPrompt(
  promptId: string,
  disposition: string,
  note?: string,
): Promise<unknown> {
  return sendJson(`/prompt/${promptId}/review`, '/prompt/:id/review', { disposition, note })
}

// ---------------------------------------------------------------------------
// Selectors — synchronous, over data already held by WardProvider
// ---------------------------------------------------------------------------

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
