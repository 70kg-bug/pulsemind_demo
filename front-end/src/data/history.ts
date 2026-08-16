/**
 * Simulated history.
 *
 * Two important properties, both required by the contract rather than chosen for looks:
 *
 * 1. Risk-score history is a list of *independent observations*, not a curve. Each score
 *    was computed on its own from the values available at that moment. Nothing here
 *    interpolates between two observations, because the model cannot support a claim
 *    about what happened in between.
 *
 * 2. Parameter history carries provenance per point. A carried-forward point repeats the
 *    previous value exactly — it is the same measurement shown again, not a new one.
 */

import type { ParameterHistoryPoint, ParameterName, RiskBand } from '../types/clinical'
import { BANDS } from './bands'
import { parameterDefinition } from './parameters'

/** One risk assessment, as plotted. Deliberately not called a "data point". */
export interface ScoreObservation {
  at: Date
  score: number
  band: RiskBand
}

/**
 * Small deterministic generator so the prototype looks the same on every reload.
 * Mulberry32 — short, well-behaved, and good enough for sample data.
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Which band a historical score fell into.
 *
 * This exists only to generate plausible sample data. In production each past
 * assessment carries its own published `risk_level`, already decided by the
 * hysteresis machine, and the strip reads that field rather than computing anything.
 */
function bandForScore(score: number): RiskBand {
  const match = BANDS.find((definition) => score >= definition.scoreFrom && score < definition.scoreTo)
  return match ? match.band : 'CRITICAL'
}

/**
 * Build the recent assessment history for one patient.
 *
 * Observations are spaced irregularly, the way real assessments arrive, so that gaps in
 * the record are visible as gaps rather than being smoothed away.
 */
export function scoreHistory(
  patientId: string,
  currentScore: number,
  now: Date,
  count = 14,
  windowMinutes = 360,
): ScoreObservation[] {
  const random = seededRandom(seedFrom(patientId))
  const observations: ScoreObservation[] = []

  // Past readings sit around a centre pulled below the current score, with a spread
  // that widens as risk rises. Sicker patients genuinely vary more between readings,
  // and it means the strip shows band changes rather than one flat lane.
  const centre = currentScore * 0.75
  const spread = 0.15 + currentScore * 0.4

  for (let i = count - 1; i >= 1; i -= 1) {
    // Irregular spacing: each step back is between 0.6 and 1.4 of the nominal interval.
    const nominal = windowMinutes / count
    const jitter = 0.6 + random() * 0.8
    const minutesBack = nominal * i * jitter
    const score = clamp(centre + (random() - 0.5) * spread, 0.02, 0.97)

    observations.push({
      at: new Date(now.getTime() - minutesBack * 60000),
      score,
      band: bandForScore(score),
    })
  }

  observations.push({ at: now, score: currentScore, band: bandForScore(currentScore) })
  observations.sort((a, b) => a.at.getTime() - b.at.getTime())
  return observations
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Build the charting history for one parameter.
 *
 * A cohort-default parameter has no patient history at all — every point is the same
 * population value, which is exactly the fact the parameter screen exists to show.
 */
export function parameterHistory(
  patientId: string,
  parameterName: ParameterName,
  currentValue: number | null,
  currentSource: 'measured' | 'carried_forward' | 'cohort_default',
  now: Date,
  count = 24,
  windowMinutes = 360,
): ParameterHistoryPoint[] {
  const definition = parameterDefinition(parameterName)
  const random = seededRandom(seedFrom(`${patientId}:${parameterName}`))
  const points: ParameterHistoryPoint[] = []

  if (currentSource === 'cohort_default') {
    for (let i = count - 1; i >= 0; i -= 1) {
      points.push({
        assessed_at: new Date(now.getTime() - (windowMinutes / count) * i * 60000).toISOString(),
        value: definition.cohortDefaultValue,
        source: 'cohort_default',
        age_minutes: null,
      })
    }
    return points
  }

  // Measured parameters are charted every few readings; the gaps are carried forward.
  const base = currentValue ?? definition.cohortDefaultValue
  const [low, high] = definition.displayRange
  const measureEvery = 2 + Math.floor(random() * 3)

  let lastMeasured = base
  let minutesSinceMeasurement = 0

  for (let i = count - 1; i >= 0; i -= 1) {
    const at = new Date(now.getTime() - (windowMinutes / count) * i * 60000)
    const isMeasured = i % measureEvery === 0

    if (isMeasured) {
      const drift = (random() - 0.5) * (high - low) * 0.08
      lastMeasured = clamp(lastMeasured + drift, low, high)
      minutesSinceMeasurement = 0
    } else {
      minutesSinceMeasurement += windowMinutes / count
    }

    points.push({
      assessed_at: at.toISOString(),
      value: Number(lastMeasured.toFixed(definition.decimals)),
      source: isMeasured ? 'measured' : 'carried_forward',
      age_minutes: isMeasured ? 0 : Math.round(minutesSinceMeasurement),
    })
  }

  return points
}
