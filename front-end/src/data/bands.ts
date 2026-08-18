/**
 * The band table.
 *
 * Figures come from the band calibration in `planning/pulsemind_data_dictionary.md` §8,
 * measured on the respiratory arm of composite deterioration within 6 hours.
 *
 * These cut points describe and explain a band. They never compute one: `risk_level`
 * arrives already decided by the hysteresis machine, and re-deriving it from the score
 * would discard that and bring back the band flicker the machine exists to remove.
 */

import type { RiskBand } from '@contract/clinical'

/** Rate of the outcome across the whole cohort, for comparison against each band. */
export const COHORT_BASE_RATE = 0.0833

export interface BandDefinition {
  band: RiskBand
  /** Inclusive lower bound of the score range. */
  scoreFrom: number
  /** Exclusive upper bound. 1 for the top band. */
  scoreTo: number
  /** Share of all readings that land in this band. */
  shareOfReadings: number
  /** Share of readings in this band followed by deterioration within 6 hours. */
  observedRate: number
  /** Observed rate divided by the cohort base rate. */
  lift: number
  /** Rank used for sorting a board, highest risk last. */
  rank: number
}

export const BANDS: BandDefinition[] = [
  {
    band: 'LOW',
    scoreFrom: 0,
    scoreTo: 0.1253,
    shareOfReadings: 0.715,
    observedRate: 0.0383,
    lift: 0.46,
    rank: 1,
  },
  {
    band: 'MEDIUM',
    scoreFrom: 0.1253,
    scoreTo: 0.2556,
    shareOfReadings: 0.177,
    observedRate: 0.1101,
    lift: 1.32,
    rank: 2,
  },
  {
    band: 'HIGH',
    scoreFrom: 0.2556,
    scoreTo: 0.543,
    shareOfReadings: 0.072,
    observedRate: 0.248,
    lift: 2.98,
    rank: 3,
  },
  {
    band: 'CRITICAL',
    scoreFrom: 0.543,
    scoreTo: 1,
    shareOfReadings: 0.036,
    observedRate: 0.5189,
    lift: 6.23,
    rank: 4,
  },
]

const BY_BAND = new Map(BANDS.map((definition) => [definition.band, definition]))

export function bandDefinition(band: RiskBand): BandDefinition {
  const definition = BY_BAND.get(band)
  if (!definition) {
    throw new Error(`Unknown band: ${band}`)
  }
  return definition
}

/** Sort rank for the triage board. Higher means more urgent. */
export function bandRank(band: RiskBand): number {
  return bandDefinition(band).rank
}

/** Short sentence explaining what a band means, for the reading-state panel. */
export function bandMeaning(band: RiskBand): string {
  const { observedRate, lift } = bandDefinition(band)
  const percent = (observedRate * 100).toFixed(1)
  return `${percent}% of readings in this band were followed by respiratory deterioration within 6 hours — ${lift.toFixed(2)}× the rate across all ventilated patients.`
}
