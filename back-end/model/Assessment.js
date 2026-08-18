const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One risk assessment, exactly as the frontend contract describes it.
 *
 * The history of record, and neither screen that reads it can recompute what it
 * holds: the observation strip shows each reading's PUBLISHED risk_level, which
 * the hysteresis machine decided once and is not a function of that reading's
 * score. The parameter screen pivots the same rows, so there is no second
 * history collection.
 *
 * Its own collection rather than a field on Patient: readings accumulate for the
 * length of a stay, and an unbounded array walks into Mongo's 16 MB ceiling.
 */

const parameterSchema = new Schema({
  parameter_name: { type: String, required: true },
  value: { type: Number, default: null },
  unit: { type: String, default: null },
  // Three states, not two: `population_reference` means the model used a
  // cohort default, a population statistic, never an observation.
  source: {
    type: String,
    enum: ['measured', 'carried_forward', 'population_reference'],
    required: true
  },
  // Null for a cohort default: a population value has no age.
  age_minutes: { type: Number, default: null }
}, { _id: false });

const contributorSchema = new Schema({
  feature_name: { type: String, required: true },
  // The parameter this feature derives from, null for a static or intervention
  // one. Declared because Mongoose strips undeclared keys in strict mode, which
  // is how the parameter screen went on matching a label against a description.
  parameter: { type: String, default: null },
  // Over ALL 109 features, not the eight stored here -- that would overstate
  // every one of them.
  share_of_decision: { type: Number, required: true },
  rank: { type: Number, required: true },
  kind: { type: String, enum: ['physiology', 'documentation'], required: true },
  is_imputed: { type: Boolean, default: false }
}, { _id: false });

const deviceSchema = new Schema({
  label: String,
  device_make_model: String,
  device_id: String,
  state: { type: String, enum: ['streaming', 'available', 'intermittent', 'offline'] },
  last_signal_at: String
}, { _id: false });

const explanationSchema = new Schema({
  status: { type: String, enum: ['generated', 'unavailable'] },
  // A fixed string when unavailable. Never prose in a slot signalling absence.
  explanation_text: String,
  grounding_status: {
    type: String,
    enum: ['passed', 'violations_found', 'not_checked']
  }
}, { _id: false });

const assessmentSchema = new Schema({
  patient_id: { type: String, required: true },
  bed_code: { type: String, required: true },
  unit: { type: String, required: true },
  assessed_at: { type: Date, required: true },

  assessment_status: {
    type: String,
    enum: ['assessed', 'insufficient_data'],
    required: true
  },

  imputed_share: { type: Number, required: true },
  documentation_share: { type: Number, required: true },
  parameters: [parameterSchema],
  devices: [deviceSchema],

  // --- present only when assessment_status is 'assessed' -------------------
  risk_score: Number,
  risk_level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  instant_level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  band_state: { type: String, enum: ['confirmed', 'provisional', 'demoting'] },
  readings_in_state: Number,
  contributors: [contributorSchema],
  explanation: explanationSchema,
  citations: [{ source: String, claim: String, _id: false }],

  // --- present only when assessment_status is 'insufficient_data' ----------
  insufficiency_reason: {
    type: String,
    enum: ['imputed_share_above_floor', 'documentation_share_above_floor']
  },
  readings_since_admission: Number,

  // band_table_version is separate from model_version on purpose: re-fitting
  // the bands changes what HIGH means without changing the model.
  model_version: String,
  band_table_version: String,
  scoring_device: String,

  // The internal record this was mapped from, so the explanation is generated
  // against the exact reading that was scored. `select: false` keeps model
  // internals out of every query that feeds the browser.
  record: { type: Schema.Types.Mixed, select: false }
}, { timestamps: true });

// Both history reads are a descending range scan on this.
assessmentSchema.index({ patient_id: 1, assessed_at: -1 });
// One assessment per patient per reading time; a replayed tick must not double.
assessmentSchema.index({ patient_id: 1, assessed_at: 1 }, { unique: true });

module.exports = mongoose.model('Assessment', assessmentSchema);
