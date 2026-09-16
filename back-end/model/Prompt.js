const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A review prompt and its disposition -- the only human-authored record in the
 * system, which is why it is persisted rather than held in component state.
 *
 * `band_at_raise` is frozen at raise time: the current risk_level may differ by
 * the time anyone reviews it, and a prompt that re-labels itself misrepresents
 * what the clinician was asked to look at.
 */
const promptSchema = new Schema({
  patient_id: { type: String, required: true },
  raised_at: { type: Date, required: true },
  band_at_raise: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'reviewed', 'expired'],
    default: 'open'
  },

  review: {
    disposition: {
      type: String,
      enum: ['acknowledged', 'actioned', 'dismissed', 'escalated']
    },
    // A short tracking note. Clinical documentation stays in the EHR.
    note: { type: String, default: null },
    // The real instant the clinician acted. Always wall clock, always true.
    reviewed_at: Date,
    // What the ward's own clock read at that moment. A simulated tick moves the
    // ward an hour, so `raised_at` can sit hours ahead of `reviewed_at` and the
    // record reads as a disposition answering a prompt that did not exist yet.
    // Declared as a second fact rather than folded into the first: writing the
    // ward's time INTO `reviewed_at` would record an instant at which nothing
    // happened, which is the same error as a defaulted clinician name.
    ward_time_at_review: { type: Date, default: null },
    // Null until authentication exists. `attributed` says so explicitly, because
    // a reader seeing a blank name cannot tell "nobody was identified" from
    // "the field was not populated". Never taken from the request body.
    clinician: { type: String, default: null },
    attributed: { type: Boolean, default: false }
  }
}, { timestamps: true });

promptSchema.index({ patient_id: 1, raised_at: -1 });
// At most one prompt per patient per raise time.
promptSchema.index({ patient_id: 1, raised_at: 1 }, { unique: true });

// Every query through this model reports a `mongo` span. Applied here rather
// than globally: a global plugin only reaches schemas compiled after it runs,
// so it stops timing silently when require order changes.
promptSchema.plugin(require('../config/queryTiming'));

module.exports = mongoose.model('Prompt', promptSchema);
