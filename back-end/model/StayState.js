const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * The per-stay machinery between readings: the carry-forward values and the
 * hysteresis latches, both opaque to Node.
 *
 * Not a cache. Losing this document does not slow the ward down, it changes
 * what the ward says -- a handler restarted without it resets every badge to
 * LOW, silently de-escalating the whole unit.
 */
const stayStateSchema = new Schema({
  patient_id: { type: String, required: true, unique: true },
  // The synthetic ward is a pure function of (seed, tick), so the service
  // regenerates a reading rather than remembering one.
  seed: { type: Number, required: true },
  tick: { type: Number, required: true, default: 0 },

  stay_state: { type: Schema.Types.Mixed, required: true },

  // The last PUBLISHED band, so a prompt is raised on a promotion rather than
  // on every reading -- 58,765 golden-set assessments raised 1,721 prompts.
  last_band: { type: String, default: null },

  offline_devices: { type: [String], default: [] },

  // Demographics and comorbidities for the patient drawer: recorded facts
  // passed through, never computed by the model, and static for the stay.
  context: { type: Schema.Types.Mixed, default: null }
}, { timestamps: true });

module.exports = mongoose.model('StayState', stayStateSchema);
