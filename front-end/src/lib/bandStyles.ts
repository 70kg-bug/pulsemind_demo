/**
 * Band and provenance styling, in one place.
 *
 * Components read from these maps rather than branching on a band internally, so
 * adding or restyling a state is an edit here and nowhere else.
 *
 * Class names are written out in full because Tailwind scans source text for literal
 * strings — a template like `bg-band-${band}-tint` produces no CSS.
 */

import type { BandState, InputSource, RiskBand } from '../types/clinical'

export interface BandStyle {
  /** Pale fill for a cell. Always paired with `text-ink-950`. */
  tint: string
  /** Saturated colour for a mark, dot or the band word. */
  ink: string
  /** Border for a tinted cell, one step darker than its tint. */
  edge: string
  /** Fill for an SVG mark. */
  fill: string
  /** Stroke for an SVG mark. */
  stroke: string
  /** How many of four segments are filled — the non-colour ordinal channel. */
  segments: number
}

export const BAND_STYLES: Record<RiskBand, BandStyle> = {
  LOW: {
    tint: 'bg-band-low-tint',
    ink: 'text-band-low-ink',
    edge: 'border-band-low-edge',
    fill: 'fill-band-low-ink',
    stroke: 'stroke-band-low-ink',
    segments: 1,
  },
  MEDIUM: {
    tint: 'bg-band-medium-tint',
    ink: 'text-band-medium-ink',
    edge: 'border-band-medium-edge',
    fill: 'fill-band-medium-ink',
    stroke: 'stroke-band-medium-ink',
    segments: 2,
  },
  HIGH: {
    tint: 'bg-band-high-tint',
    ink: 'text-band-high-ink',
    edge: 'border-band-high-edge',
    fill: 'fill-band-high-ink',
    stroke: 'stroke-band-high-ink',
    segments: 3,
  },
  CRITICAL: {
    tint: 'bg-band-critical-tint',
    ink: 'text-band-critical-ink',
    edge: 'border-band-critical-edge',
    fill: 'fill-band-critical-ink',
    stroke: 'stroke-band-critical-ink',
    segments: 4,
  },
}

export interface ProvenanceStyle {
  /** Short word shown in a source column. */
  label: string
  /**
   * Prefix glyph. A cohort default carries `≈` because it is a population
   * estimate rather than a reading from this patient — true, and legible
   * without colour, in greyscale, and to a colour-blind reader.
   */
  glyph: string
  ink: string
  tint: string
  edge: string
  /** One sentence explaining what this state means, for the parameter screen. */
  meaning: string
}

export const PROVENANCE_STYLES: Record<InputSource, ProvenanceStyle> = {
  measured: {
    label: 'Measured',
    glyph: '',
    ink: 'text-prov-measured',
    tint: 'bg-surface',
    edge: 'border-rule',
    meaning: 'Read from the device at this timestamp.',
  },
  carried_forward: {
    label: 'Carried forward',
    glyph: '',
    ink: 'text-prov-carried',
    tint: 'bg-surface-sunken',
    edge: 'border-rule',
    meaning: 'The last measured value, shown again. Not remeasured.',
  },
  cohort_default: {
    label: 'Cohort default',
    glyph: '≈',
    ink: 'text-prov-default',
    tint: 'bg-prov-default-tint',
    edge: 'border-prov-default-edge',
    meaning: 'A population value. Never measured on this patient.',
  },
}

/** Wording for the hysteresis state, shown beside the band. */
export const BAND_STATE_LABEL: Record<BandState, string> = {
  confirmed: 'Confirmed',
  provisional: 'Promotion pending',
  demoting: 'Held above current score',
}

export const BAND_STATE_MEANING: Record<BandState, string> = {
  confirmed: 'The published band and the current score agree.',
  provisional: 'The score has crossed upward. The band changes once the crossing is sustained.',
  demoting:
    'The score has fallen below this band but not yet far enough, or for long enough, to step down.',
}

export const INSUFFICIENCY_REASON_LABEL = {
  imputed_share_above_floor: 'Too many inputs rest on population defaults.',
  documentation_share_above_floor: 'Too much of the reading is charting pattern rather than physiology.',
} as const
