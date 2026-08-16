/**
 * Simulated ward feed.
 *
 * This is the only place patient state comes from. Every screen reads through
 * `src/data/feed.ts`, so replacing this with a real transport is a one-file change and
 * no component needs to know it happened.
 *
 * The eight patients below are chosen to exercise every state the contract defines:
 * an open prompt, all three band states, a reviewed prompt, a failed explanation, an
 * explanation that was never attempted, and a reading below the sufficiency floor.
 *
 * No real patient data. MIMIC-IV is credentialed and none of it appears here.
 */

import type {
  Assessment,
  Citation,
  InputDevice,
  ParameterReading,
  PatientContext,
  RefusedAssessment,
  RiskContributor,
  ScoredAssessment,
} from '../types/clinical'
import { PARAMETERS } from './parameters'

// ---------------------------------------------------------------------------
// Builders — keep the patient records below readable
// ---------------------------------------------------------------------------

/** A measured or carried-forward override for one parameter. */
interface Override {
  value: number
  source: 'measured' | 'carried_forward'
  age_minutes: number
}

/**
 * Build the full set of eleven readings. Anything not overridden falls back to its
 * cohort default, which is what happens on a real patient far more often than not.
 */
function buildParameters(overrides: Partial<Record<string, Override>>): ParameterReading[] {
  return PARAMETERS.map((parameter) => {
    const override = overrides[parameter.name]
    if (override) {
      return {
        parameter_name: parameter.name,
        value: override.value,
        unit: parameter.unit,
        source: override.source,
        age_minutes: override.age_minutes,
      }
    }
    return {
      parameter_name: parameter.name,
      value: parameter.cohortDefaultValue,
      unit: parameter.unit,
      source: 'cohort_default',
      age_minutes: null,
    }
  })
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString()
}

const STANDARD_DEVICES: InputDevice[] = [
  {
    label: 'Ventilator',
    device_make_model: 'Hamilton C6',
    device_id: 'VNT-04',
    state: 'streaming',
    last_signal_at: minutesAgo(0.05),
  },
  {
    label: 'Bedside monitor',
    device_make_model: 'Philips MX750',
    device_id: 'MON-04',
    state: 'streaming',
    last_signal_at: minutesAgo(0.03),
  },
  {
    label: 'Lab / EMR',
    device_make_model: 'Hospital interface',
    device_id: 'EMR-01',
    state: 'available',
    last_signal_at: minutesAgo(18),
  },
]

const GUIDELINE_CITATIONS: Citation[] = [
  {
    claim:
      'Maintain oxygen saturation within the target range; sustained readings below target warrant review of oxygen delivery.',
    source: 'Approved Respiratory Care Library · Oxygen Therapy in Critical Illness, §4.2',
  },
  {
    claim:
      'An inspired-oxygen requirement above the weaning threshold is a recognised indicator for reassessment of ventilatory support.',
    source: 'Approved Respiratory Care Library · Mechanical Ventilation Weaning & Support, §2.6',
  },
  {
    claim:
      'Where end-tidal CO₂ is unavailable, interpretation should not substitute a population value without confirmation.',
    source: 'Approved Respiratory Care Library · Capnography Interpretation, §1.4',
  },
]

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

function contributors(
  entries: Array<[string, number, 'physiology' | 'documentation', boolean]>,
): RiskContributor[] {
  return entries.map(([feature_name, share_of_decision, kind, is_imputed], index) => ({
    feature_name,
    share_of_decision,
    rank: index + 1,
    kind,
    is_imputed,
  }))
}

// ---------------------------------------------------------------------------
// The ward
// ---------------------------------------------------------------------------

const pm204: ScoredAssessment = {
  patient_id: 'PM-204',
  bed_code: 'Bed 04',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.4),
  risk_score: 0.781,
  risk_level: 'CRITICAL',
  instant_level: 'CRITICAL',
  band_state: 'confirmed',
  readings_in_state: 5,
  imputed_share: 0.04,
  documentation_share: 0.11,
  parameters: buildParameters({
    spo2: { value: 89, source: 'measured', age_minutes: 0.3 },
    fio2: { value: 72, source: 'measured', age_minutes: 0.3 },
    peep: { value: 12, source: 'measured', age_minutes: 0.3 },
    pip: { value: 34, source: 'measured', age_minutes: 0.3 },
    respiratory_rate_total: { value: 28, source: 'measured', age_minutes: 0.3 },
    minute_volume: { value: 11.4, source: 'measured', age_minutes: 0.3 },
    tidal_volume_observed: { value: 408, source: 'measured', age_minutes: 0.3 },
    flow_rate: { value: 52.0, source: 'carried_forward', age_minutes: 14 },
  }),
  contributors: contributors([
    ['Peripheral oxygen saturation', 0.284, 'physiology', false],
    ['Fraction of inspired oxygen', 0.212, 'physiology', false],
    ['Peak inspiratory pressure', 0.147, 'physiology', false],
    ['End-tidal carbon dioxide', 0.096, 'physiology', true],
    ['Observed tidal volume', 0.081, 'physiology', false],
    ['Charting interval, respiratory group', 0.063, 'documentation', false],
    ['Positive end-expiratory pressure', 0.058, 'physiology', false],
    ['Measurement count, last hour', 0.041, 'documentation', false],
  ]),
  explanation: {
    status: 'generated',
    explanation_text:
      'This reading sits in the CRITICAL band. The largest contributions are a peripheral oxygen saturation of 89% against an inspired oxygen fraction of 72%, together accounting for about half the score. Peak inspiratory pressure of 34 cmH₂O is the next largest contribution. End-tidal CO₂ also contributes, but rests on a population default — no capnography value has been charted for this patient.',
    grounding_status: 'passed',
  },
  citations: GUIDELINE_CITATIONS,
  prompt: {
    raised_at: minutesAgo(4),
    band_at_raise: 'CRITICAL',
    status: 'open',
  },
  review: null,
  devices: STANDARD_DEVICES,
}

const pm231: ScoredAssessment = {
  patient_id: 'PM-231',
  bed_code: 'Bed 09',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.6),
  risk_score: 0.412,
  risk_level: 'HIGH',
  instant_level: 'HIGH',
  band_state: 'confirmed',
  readings_in_state: 22,
  imputed_share: 0.09,
  documentation_share: 0.14,
  parameters: buildParameters({
    spo2: { value: 93, source: 'measured', age_minutes: 0.5 },
    fio2: { value: 55, source: 'measured', age_minutes: 0.5 },
    peep: { value: 10, source: 'measured', age_minutes: 0.5 },
    pip: { value: 28, source: 'measured', age_minutes: 0.5 },
    respiratory_rate_total: { value: 24, source: 'measured', age_minutes: 0.5 },
    minute_volume: { value: 9.8, source: 'carried_forward', age_minutes: 8 },
    tidal_volume_observed: { value: 445, source: 'measured', age_minutes: 0.5 },
  }),
  contributors: contributors([
    ['Fraction of inspired oxygen', 0.241, 'physiology', false],
    ['Peripheral oxygen saturation', 0.198, 'physiology', false],
    ['Peak inspiratory pressure', 0.134, 'physiology', false],
    ['Total respiratory rate', 0.112, 'physiology', false],
    ['End-tidal carbon dioxide', 0.087, 'physiology', true],
    ['Charting interval, respiratory group', 0.071, 'documentation', false],
    ['Positive end-expiratory pressure', 0.054, 'physiology', false],
    ['Peak inspiratory flow', 0.038, 'physiology', true],
  ]),
  explanation: {
    status: 'generated',
    explanation_text:
      'This reading sits in the HIGH band. An inspired oxygen fraction of 55% holding a saturation of 93% is the largest contribution, followed by a peak inspiratory pressure of 28 cmH₂O and a total respiratory rate of 24 breaths per minute. Two inputs — end-tidal CO₂ and peak inspiratory flow — rest on population defaults rather than measured values for this patient.',
    grounding_status: 'passed',
  },
  citations: GUIDELINE_CITATIONS,
  prompt: {
    raised_at: minutesAgo(184),
    band_at_raise: 'HIGH',
    status: 'reviewed',
  },
  review: {
    disposition: 'acknowledged',
    note: 'Reviewed on round. FiO₂ wean planned once ABG back.',
    reviewed_at: minutesAgo(171),
    clinician: 'ICU Clinician',
  },
  devices: STANDARD_DEVICES,
}

const pm167: ScoredAssessment = {
  patient_id: 'PM-167',
  bed_code: 'Bed 02',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.3),
  risk_score: 0.238,
  risk_level: 'HIGH',
  instant_level: 'MEDIUM',
  band_state: 'demoting',
  readings_in_state: 41,
  imputed_share: 0.12,
  documentation_share: 0.16,
  parameters: buildParameters({
    spo2: { value: 96, source: 'measured', age_minutes: 0.2 },
    fio2: { value: 40, source: 'measured', age_minutes: 0.2 },
    peep: { value: 8, source: 'measured', age_minutes: 0.2 },
    pip: { value: 24, source: 'measured', age_minutes: 0.2 },
    respiratory_rate_total: { value: 19, source: 'measured', age_minutes: 0.2 },
    minute_volume: { value: 8.4, source: 'measured', age_minutes: 0.2 },
    tidal_volume_observed: { value: 470, source: 'carried_forward', age_minutes: 22 },
  }),
  contributors: contributors([
    ['Fraction of inspired oxygen', 0.196, 'physiology', false],
    ['Peak inspiratory pressure', 0.158, 'physiology', false],
    ['Peripheral oxygen saturation', 0.131, 'physiology', false],
    ['End-tidal carbon dioxide', 0.104, 'physiology', true],
    ['Charting interval, respiratory group', 0.089, 'documentation', false],
    ['Observed tidal volume', 0.072, 'physiology', false],
    ['Total respiratory rate', 0.061, 'physiology', false],
    ['Peak inspiratory flow', 0.047, 'physiology', true],
  ]),
  explanation: {
    status: 'generated',
    explanation_text:
      'The published band is HIGH, held above the MEDIUM band the current score alone would imply. An inspired oxygen fraction of 40% and a peak inspiratory pressure of 24 cmH₂O are the largest contributions to this reading. End-tidal CO₂ and peak inspiratory flow rest on population defaults for this patient.',
    grounding_status: 'passed',
  },
  citations: GUIDELINE_CITATIONS,
  prompt: {
    raised_at: minutesAgo(322),
    band_at_raise: 'HIGH',
    status: 'reviewed',
  },
  review: {
    disposition: 'actioned',
    note: null,
    reviewed_at: minutesAgo(310),
    clinician: 'ICU Clinician',
  },
  devices: STANDARD_DEVICES,
}

const pm118: ScoredAssessment = {
  patient_id: 'PM-118',
  bed_code: 'Bed 11',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.2),
  risk_score: 0.271,
  risk_level: 'MEDIUM',
  instant_level: 'HIGH',
  band_state: 'provisional',
  readings_in_state: 2,
  imputed_share: 0.07,
  documentation_share: 0.13,
  parameters: buildParameters({
    spo2: { value: 94, source: 'measured', age_minutes: 0.2 },
    fio2: { value: 48, source: 'measured', age_minutes: 0.2 },
    peep: { value: 9, source: 'measured', age_minutes: 0.2 },
    pip: { value: 27, source: 'measured', age_minutes: 0.2 },
    respiratory_rate_total: { value: 22, source: 'measured', age_minutes: 0.2 },
    minute_volume: { value: 9.1, source: 'measured', age_minutes: 0.2 },
    tidal_volume_observed: { value: 432, source: 'measured', age_minutes: 0.2 },
  }),
  contributors: contributors([
    ['Fraction of inspired oxygen', 0.223, 'physiology', false],
    ['Peak inspiratory pressure', 0.164, 'physiology', false],
    ['Peripheral oxygen saturation', 0.142, 'physiology', false],
    ['Total respiratory rate', 0.098, 'physiology', false],
    ['End-tidal carbon dioxide', 0.091, 'physiology', true],
    ['Observed tidal volume', 0.067, 'physiology', false],
    ['Charting interval, respiratory group', 0.052, 'documentation', false],
    ['Positive end-expiratory pressure', 0.043, 'physiology', false],
  ]),
  explanation: {
    status: 'generated',
    explanation_text:
      'The published band is MEDIUM. The current score alone would imply HIGH, and a promotion is pending confirmation. An inspired oxygen fraction of 48% and a peak inspiratory pressure of 27 cmH₂O are the largest contributions. End-tidal CO₂ rests on a population default for this patient.',
    grounding_status: 'passed',
  },
  citations: GUIDELINE_CITATIONS,
  prompt: null,
  review: null,
  devices: STANDARD_DEVICES,
}

/** Generator failed. Score, band, inputs and contributors all still surface. */
const pm092: ScoredAssessment = {
  patient_id: 'PM-092',
  bed_code: 'Bed 06',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.8),
  risk_score: 0.164,
  risk_level: 'MEDIUM',
  instant_level: 'MEDIUM',
  band_state: 'confirmed',
  readings_in_state: 63,
  imputed_share: 0.18,
  documentation_share: 0.21,
  parameters: buildParameters({
    spo2: { value: 97, source: 'measured', age_minutes: 0.7 },
    fio2: { value: 35, source: 'measured', age_minutes: 0.7 },
    peep: { value: 6, source: 'measured', age_minutes: 0.7 },
    pip: { value: 21, source: 'carried_forward', age_minutes: 31 },
    respiratory_rate_total: { value: 17, source: 'measured', age_minutes: 0.7 },
  }),
  contributors: contributors([
    ['Fraction of inspired oxygen', 0.187, 'physiology', false],
    ['Charting interval, respiratory group', 0.152, 'documentation', false],
    ['Peak inspiratory pressure', 0.128, 'physiology', false],
    ['End-tidal carbon dioxide', 0.113, 'physiology', true],
    ['Measurement count, last hour', 0.094, 'documentation', false],
    ['Minute ventilation', 0.078, 'physiology', true],
    ['Peripheral oxygen saturation', 0.061, 'physiology', false],
    ['Peak inspiratory flow', 0.049, 'physiology', true],
  ]),
  explanation: {
    status: 'unavailable',
    explanation_text: 'LLM explanation and recommendations are not available',
    grounding_status: 'not_checked',
  },
  citations: [],
  prompt: null,
  review: null,
  devices: STANDARD_DEVICES,
}

/** No explanation row at all — generation was never attempted. A different fact. */
const pm310: ScoredAssessment = {
  patient_id: 'PM-310',
  bed_code: 'Bed 07',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(1.1),
  risk_score: 0.094,
  risk_level: 'LOW',
  instant_level: 'LOW',
  band_state: 'confirmed',
  readings_in_state: 118,
  imputed_share: 0.14,
  documentation_share: 0.17,
  parameters: buildParameters({
    spo2: { value: 98, source: 'measured', age_minutes: 1 },
    fio2: { value: 30, source: 'measured', age_minutes: 1 },
    peep: { value: 5, source: 'measured', age_minutes: 1 },
    pip: { value: 18, source: 'measured', age_minutes: 1 },
    respiratory_rate_total: { value: 15, source: 'measured', age_minutes: 1 },
    minute_volume: { value: 7.2, source: 'measured', age_minutes: 1 },
    tidal_volume_observed: { value: 480, source: 'measured', age_minutes: 1 },
  }),
  contributors: contributors([
    ['Fraction of inspired oxygen', 0.164, 'physiology', false],
    ['Peripheral oxygen saturation', 0.139, 'physiology', false],
    ['Charting interval, respiratory group', 0.118, 'documentation', false],
    ['End-tidal carbon dioxide', 0.102, 'physiology', true],
    ['Peak inspiratory pressure', 0.087, 'physiology', false],
    ['Observed tidal volume', 0.071, 'physiology', false],
    ['Total respiratory rate', 0.058, 'physiology', false],
    ['Peak inspiratory flow', 0.044, 'physiology', true],
  ]),
  explanation: null,
  citations: [],
  prompt: null,
  review: null,
  devices: STANDARD_DEVICES,
}

const pm441: ScoredAssessment = {
  patient_id: 'PM-441',
  bed_code: 'Bed 12',
  unit: 'ICU 04',
  assessment_status: 'assessed',
  assessed_at: minutesAgo(0.5),
  risk_score: 0.061,
  risk_level: 'LOW',
  instant_level: 'LOW',
  band_state: 'confirmed',
  readings_in_state: 204,
  imputed_share: 0.11,
  documentation_share: 0.09,
  parameters: buildParameters({
    spo2: { value: 99, source: 'measured', age_minutes: 0.4 },
    fio2: { value: 28, source: 'measured', age_minutes: 0.4 },
    peep: { value: 5, source: 'measured', age_minutes: 0.4 },
    pip: { value: 16, source: 'measured', age_minutes: 0.4 },
    respiratory_rate_total: { value: 14, source: 'measured', age_minutes: 0.4 },
    minute_volume: { value: 6.8, source: 'measured', age_minutes: 0.4 },
    tidal_volume_observed: { value: 495, source: 'measured', age_minutes: 0.4 },
    flow_rate: { value: 38.0, source: 'measured', age_minutes: 0.4 },
  }),
  contributors: contributors([
    ['Peripheral oxygen saturation', 0.148, 'physiology', false],
    ['Fraction of inspired oxygen', 0.127, 'physiology', false],
    ['Observed tidal volume', 0.104, 'physiology', false],
    ['Charting interval, respiratory group', 0.093, 'documentation', false],
    ['End-tidal carbon dioxide', 0.088, 'physiology', true],
    ['Peak inspiratory pressure', 0.074, 'physiology', false],
    ['Positive end-expiratory pressure', 0.056, 'physiology', false],
    ['Total respiratory rate', 0.049, 'physiology', false],
  ]),
  explanation: {
    status: 'generated',
    explanation_text:
      'This reading sits in the LOW band. A saturation of 99% on 28% inspired oxygen, with a peak inspiratory pressure of 16 cmH₂O, are the largest contributions. End-tidal CO₂ rests on a population default for this patient.',
    grounding_status: 'passed',
  },
  citations: GUIDELINE_CITATIONS,
  prompt: null,
  review: null,
  devices: STANDARD_DEVICES,
}

/** Below the data-sufficiency floor. No score, no band, no prompt. */
const pm355: RefusedAssessment = {
  patient_id: 'PM-355',
  bed_code: 'Bed 15',
  unit: 'ICU 04',
  assessment_status: 'insufficient_data',
  assessed_at: minutesAgo(0.9),
  insufficiency_reason: 'imputed_share_above_floor',
  readings_since_admission: 7,
  imputed_share: 0.47,
  documentation_share: 0.22,
  parameters: buildParameters({
    spo2: { value: 95, source: 'measured', age_minutes: 0.8 },
    fio2: { value: 34, source: 'carried_forward', age_minutes: 46 },
  }),
  devices: [
    STANDARD_DEVICES[0],
    {
      label: 'Bedside monitor',
      device_make_model: 'Philips MX750',
      device_id: 'MON-15',
      state: 'intermittent',
      last_signal_at: minutesAgo(46),
    },
    STANDARD_DEVICES[2],
  ],
}

export const WARD: Assessment[] = [pm204, pm231, pm167, pm118, pm092, pm310, pm441, pm355]

// ---------------------------------------------------------------------------
// Patient context — borrowed from the hospital record, never computed by the model
// ---------------------------------------------------------------------------

export const PATIENT_CONTEXT: Record<string, PatientContext> = {
  'PM-204': {
    ventilation_episode_id: 'VE-204-0031',
    stay_id: 'ST-204-0009',
    age: '64 years',
    sex: 'Male',
    weight: '78 kg',
    height: '174 cm',
    ethnicity: 'Not recorded',
    comorbidities: [
      { label: 'Chronic obstructive pulmonary disease', icd_code: 'J44.9' },
      { label: 'Type 2 diabetes mellitus', icd_code: 'E11.9' },
      { label: 'Hypertension', icd_code: 'I10' },
    ],
    charlson_index: 4,
  },
  'PM-231': {
    ventilation_episode_id: 'VE-231-0012',
    stay_id: 'ST-231-0004',
    age: '71 years',
    sex: 'Female',
    weight: '62 kg',
    height: '161 cm',
    ethnicity: 'Asian, recorded',
    comorbidities: [
      { label: 'Congestive heart failure', icd_code: 'I50.9' },
      { label: 'Chronic kidney disease, stage 3', icd_code: 'N18.3' },
    ],
    charlson_index: 5,
  },
  'PM-167': {
    ventilation_episode_id: 'VE-167-0007',
    stay_id: 'ST-167-0003',
    age: '58 years',
    sex: 'Male',
    weight: '91 kg',
    height: '180 cm',
    ethnicity: 'Not recorded',
    comorbidities: [{ label: 'Obstructive sleep apnoea', icd_code: 'G47.33' }],
    charlson_index: 1,
  },
  'PM-118': {
    ventilation_episode_id: 'VE-118-0021',
    stay_id: 'ST-118-0006',
    age: '47 years',
    sex: 'Female',
    weight: '68 kg',
    height: '167 cm',
    ethnicity: 'Not recorded',
    comorbidities: [],
    charlson_index: 0,
  },
  'PM-092': {
    ventilation_episode_id: 'VE-092-0044',
    stay_id: 'ST-092-0011',
    age: '80 years',
    sex: 'Male',
    weight: '70 kg',
    height: '171 cm',
    ethnicity: 'Not recorded',
    comorbidities: [
      { label: 'Chronic obstructive pulmonary disease', icd_code: 'J44.9' },
      { label: 'Cerebrovascular disease', icd_code: 'I67.9' },
    ],
    charlson_index: 6,
  },
  'PM-310': {
    ventilation_episode_id: 'VE-310-0002',
    stay_id: 'ST-310-0001',
    age: '35 years',
    sex: 'Male',
    weight: '82 kg',
    height: '183 cm',
    ethnicity: 'Not recorded',
    comorbidities: [],
    charlson_index: 0,
  },
  'PM-441': {
    ventilation_episode_id: 'VE-441-0015',
    stay_id: 'ST-441-0008',
    age: '52 years',
    sex: 'Female',
    weight: '74 kg',
    height: '169 cm',
    ethnicity: 'Not recorded',
    comorbidities: [{ label: 'Type 2 diabetes mellitus', icd_code: 'E11.9' }],
    charlson_index: 1,
  },
  'PM-355': {
    ventilation_episode_id: 'VE-355-0001',
    stay_id: 'ST-355-0001',
    age: '69 years',
    sex: 'Female',
    weight: 'Not recorded',
    height: 'Not recorded',
    ethnicity: 'Not recorded',
    comorbidities: [],
    charlson_index: 0,
  },
}
