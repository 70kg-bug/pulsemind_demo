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
    reviewed_at: Date,
    clinician: String
  }
}, { timestamps: true });

promptSchema.index({ patient_id: 1, raised_at: -1 });
// At most one prompt per patient per raise time.
promptSchema.index({ patient_id: 1, raised_at: 1 }, { unique: true });

module.exports = mongoose.model('Prompt', promptSchema);
