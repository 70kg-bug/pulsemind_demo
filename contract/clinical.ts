/**
 * The PulseMind data contract, as types. Shared by both halves of the demo.
 *
 * OUTSIDE front-end/ deliberately: the dashboard is scheduled to be replaced by
 * a finalised UI, and a contract living inside the app being swapped out goes
 * with it.
 *
 * Field names come from `planning/PulseMind_Frontend_Data_Contract.pdf` and the
 * data dictionary; every value on screen traces to a schema field. Where the two
 * disagree the dictionary wins, which is why `InputSource` reads
 * `population_reference` and not the PDF's `cohort_default`.
 */

// ---------------------------------------------------------------------------
// Closed value sets
// ---------------------------------------------------------------------------

/** Band names are final. Renaming one is expensive once prompts are built on it. */
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type AssessmentStatus = 'assessed' | 'insufficient_data'

export type InsufficiencyReason =
  | 'imputed_share_above_floor'
  | 'documentation_share_above_floor'

/**
 * Where the displayed band sits relative to the raw score. `provisional` — a
 * promotion is pending. `demoting` — the band is held above the score.
 *
 * Promotion is immediate with the shipped machine, so `provisional` does not
 * currently occur: 58,765 golden-set readings show only `confirmed` and
 * `demoting`. It stays in the union because the dwell is a property of the band
 * table, not the model.
 */
export type BandState = 'confirmed' | 'provisional' | 'demoting'

/**
 * How a parameter value was obtained. Never render a value without this.
 *
 * Three states, not two: `population_reference` means the model used a cohort
 * default, a population statistic, never to be narrated as an observation. Four
 * of the eleven parameters are majority cohort default across the cohort.
 */
export type InputSource = 'measured' | 'carried_forward' | 'population_reference'

export type ContributorKind = 'physiology' | 'documentation'

export type PromptStatus = 'open' | 'reviewed' | 'expired'

export type ExplanationStatus = 'generated' | 'unavailable'

export type GroundingStatus = 'passed' | 'violations_found' | 'not_checked'

export type Disposition = 'acknowledged' | 'actioned' | 'dismissed' | 'escalated'

/** The eleven parameters are a frozen set. */
export type ParameterName =
  | 'spo2'
  | 'fio2'
  | 'flow_rate'
  | 'peep'
  | 'pip'
  | 'respiratory_rate_total'
  | 'minute_volume'
  | 'tidal_volume_observed'
  | 'etco2'
  | 'inspiratory_ratio'
  | 'expiratory_ratio'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export interface ParameterReading {
  parameter_name: ParameterName
  value: number | null
  unit: string | null
  source: InputSource
  /** Null for a cohort default — a population value has no age. */
  age_minutes: number | null
}

/** One earlier reading of a single parameter. Used to show provenance over time. */
export interface ParameterHistoryPoint {
  assessed_at: string
  value: number
  source: InputSource
  age_minutes: number | null
}

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

export interface RiskContributor {
  feature_name: string
  /** The parameter this feature derives from, null for a static or intervention
   *  feature. The only safe join key: `feature_name` is a display label and
   *  several features share one parameter. */
  parameter: ParameterName | null
  /** |contribution| over the total across ALL 109 features, not over the stored eight. */
  share_of_decision: number
  rank: number
  kind: ContributorKind
  is_imputed: boolean
}

export interface Citation {
  source: string
  claim: string
}

export interface Explanation {
  status: ExplanationStatus
  /** Fixed strings when unavailable — never substitute generated prose. */
  explanation_text: string
  grounding_status: GroundingStatus
}

export interface RiskPrompt {
  /** Mongo's `_id`, so a disposition can be posted back against it. */
  _id?: string
  raised_at: string
  band_at_raise: RiskBand
  status: PromptStatus
}

export interface ClinicianReview {
  disposition: Disposition
  note: string | null
  reviewed_at: string
  clinician: string
}

export type DeviceState = 'streaming' | 'available' | 'intermittent' | 'offline'

/** An input source such as a ventilator or bedside monitor. */
export interface InputDevice {
  label: string
  device_make_model: string
  device_id: string
  state: DeviceState
  /** When this source was last heard from. Rendered as a live counter. */
  last_signal_at: string
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/** Fields present on every assessment, scored or refused. */
interface AssessmentBase {
  patient_id: string
  bed_code: string
  unit: string
  assessed_at: string
  imputed_share: number
  documentation_share: number
  parameters: ParameterReading[]
  devices: InputDevice[]
}

/** A reading that met the data-sufficiency floor. `risk_level` is the published
 *  band after hysteresis — never re-derive it from the score. */
export interface ScoredAssessment extends AssessmentBase {
  assessment_status: 'assessed'
  risk_score: number
  risk_level: RiskBand
  instant_level: RiskBand
  band_state: BandState
  readings_in_state: number
  contributors: RiskContributor[]
  explanation: Explanation | null
  citations: Citation[]
  prompt: RiskPrompt | null
  review: ClinicianReview | null
  /** Provenance, so a stored assessment traces to what produced it. */
  model_version?: string
  band_table_version?: string
  scoring_device?: string
}

/** A reading below the floor: no score, no band, no prompt. A separate shape so
 *  a refusal can never be read as a low score. */
export interface RefusedAssessment extends AssessmentBase {
  assessment_status: 'insufficient_data'
  insufficiency_reason: InsufficiencyReason
  readings_since_admission: number
}

export type Assessment = ScoredAssessment | RefusedAssessment

/** Narrowing helper, so screens read `if (isScored(a))` rather than comparing strings. */
export function isScored(assessment: Assessment): assessment is ScoredAssessment {
  return assessment.assessment_status === 'assessed'
}

// ---------------------------------------------------------------------------
// Patient context — borrowed from the hospital record, never computed by the model
// ---------------------------------------------------------------------------

export interface Comorbidity {
  label: string
  icd_code: string
}

export interface PatientContext {
  ventilation_episode_id: string
  stay_id: string
  age: string
  sex: string
  weight: string
  height: string
  ethnicity: string
  comorbidities: Comorbidity[]
  charlson_index: number
}
