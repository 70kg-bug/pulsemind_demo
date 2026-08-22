const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * The per-stay machinery between readings: carry-forward values and hysteresis
 * latches, both opaque to Node. Not a cache -- losing it resets every badge to
 * LOW, silently de-escalating the ward.
 */
const stayStateSchema = new Schema({
  patient_id: { type: String, required: true, unique: true },
  seed: { type: Number, required: true },
  tick: { type: Number, required: true, default: 0 },

  stay_state: { type: Schema.Types.Mixed, required: true },

  // The last PUBLISHED band: prompts fire on promotion, not on every reading.
  // 58,765 golden-set assessments raised 1,721 prompts.
  last_band: { type: String, default: null },

  offline_devices: { type: [String], default: [] },

  // Recorded facts passed through for the patient drawer, never computed.
  context: { type: Schema.Types.Mixed, default: null }
}, { timestamps: true });

// Every query through this model reports a `mongo` span. Applied here rather
// than globally: a global plugin only reaches schemas compiled after it runs,
// so it stops timing silently when require order changes.
stayStateSchema.plugin(require('../config/queryTiming'));

module.exports = mongoose.model('StayState', stayStateSchema);
