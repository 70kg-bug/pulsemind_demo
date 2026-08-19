const Assessment = require('../model/Assessment');
const StayState = require('../model/StayState');
const Prompt = require('../model/Prompt');
const { scoring, explaining } = require('../config/modelService');

// data -> model service -> db -> front-end. Reads never touch the model
// service: everything the dashboard shows comes out of MongoDB.


const req_id = (res) => res.getHeader('X-Request-Id');

/**
 * Map an axios failure onto an honest status.
 *
 * Everything used to become 502 "the model service did not respond", including a
 * Pydantic 422 about a malformed body -- so an operator would go restart a
 * service that had answered promptly and correctly. `err.response` present means
 * it answered; absent means it did not.
 */
const fromUpstream = (res, err, what) => {
  if (err.response) {
    const status = err.response.status;
    return res.status(status === 503 ? 503 : (status >= 400 && status < 500 ? status : 502))
      .type('application/problem+json')
      .set(err.response.headers?.['retry-after']
        ? { 'Retry-After': err.response.headers['retry-after'] } : {})
      .json({
        type: 'about:blank',
        title: status === 503 ? 'Service Unavailable' : 'Upstream Rejected The Request',
        status: status === 503 ? 503 : (status >= 400 && status < 500 ? status : 502),
        detail: err.response.data?.detail ?? err.response.data?.title ?? what,
        instance: req_id(res),
      });
  }
  // No response at all: down, refused, or timed out. This is the only genuine 502.
  return res.status(502).type('application/problem+json').json({
    type: 'about:blank', title: 'Bad Gateway', status: 502,
    detail: `${what} did not respond`, instance: req_id(res),
  });
};

const DEFAULT_SEED = Number(process.env.WARD_SEED || 20260817);

// `seedWard` deletes all three collections. Until authentication exists, one
// unauthenticated request can empty the history of record, so it is off unless
// deliberately switched on. checks/README.md warns humans; this stops requests.
const ALLOW_DESTRUCTIVE = process.env.PM_ALLOW_DESTRUCTIVE === 'true';
const BACKFILL_TICKS = 24;      // hourly, so the shipped dwell parameters hold
const HISTORY_LIMIT = 14;       // what the observation strip plots

/** Store one assessment, and its prompt if it raised one. */
const persist = async (assessment) => {
  await Assessment.findOneAndUpdate(
    { patient_id: assessment.patient_id, assessed_at: assessment.assessed_at },
    assessment,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // At most ONE open prompt per patient. Otherwise a bed that went MEDIUM ->
  // HIGH -> CRITICAL carries three, and reviewing the newest makes an older one
  // reappear as though nothing had been done.
  if (assessment.prompt) {
    await Prompt.updateMany(
      { patient_id: assessment.patient_id, status: 'open' },
      { status: 'expired' }
    );
    // upsert, not create: replaying a tick must not raise the same prompt twice.
    await Prompt.findOneAndUpdate(
      { patient_id: assessment.patient_id, raised_at: assessment.prompt.raised_at },
      {
        patient_id: assessment.patient_id,
        raised_at: assessment.prompt.raised_at,
        band_at_raise: assessment.prompt.band_at_raise,
        status: 'open'
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  // A reading below the sufficiency floor does NOT withdraw the ask: the
  // patient was HIGH and the data has stopped arriving, which is more reason to
  // look. Expiring it also stranded them -- the watermark survives a refusal, so
  // the next HIGH reading is not a promotion and never raises a replacement.
};

/** Build the ward and backfill 24 hours of scored history.
 *  Destructive by design: seeding twice gives the same ward, not two. */
const seedWard = async (req, res) => {
  if (!ALLOW_DESTRUCTIVE) {
    return res.status(403).type('application/problem+json').json({
      type: 'about:blank', title: 'Forbidden', status: 403,
      detail: 'seeding deletes every assessment, prompt and stay state; '
            + 'set PM_ALLOW_DESTRUCTIVE=true to permit it',
      instance: req_id(res),
    });
  }
  const seed = Number(req.body?.seed ?? DEFAULT_SEED);
  const ticks = Number(req.body?.backfill_ticks ?? BACKFILL_TICKS);

  let ward;
  try {
    const { data } = await scoring.post('/ward/seed', { seed, backfill_ticks: ticks });
    ward = data;
  } catch (err) {
    return fromUpstream(res, err, 'the model service');
  }

  // BEFORE the delete: a 200 that is malformed would otherwise empty all three
  // collections and then fail on the first patient, leaving nothing.
  const usable = ward && Array.isArray(ward.patients) && ward.patients.length > 0
    && ward.patients.every((p) => p.patient_id && Array.isArray(p.history) && p.history.length);
  if (!usable) {
    return res.status(502).json({
      message: 'the model service returned no usable ward -- nothing was deleted'
    });
  }

  await Promise.all([
    Assessment.deleteMany({}),
    StayState.deleteMany({}),
    Prompt.deleteMany({})
  ]);

  for (const patient of ward.patients) {
    for (const assessment of patient.history) {
      await persist(assessment);
    }
    await StayState.findOneAndUpdate(
      { patient_id: patient.patient_id },
      {
        patient_id: patient.patient_id,
        seed,
        tick: patient.tick,
        stay_state: patient.stay_state,
        last_band: patient.last_band,
        offline_devices: [],
        context: patient.context
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const stored = await Assessment.countDocuments();
  res.json({
    message: 'ward seeded',
    seeded_at: ward.seeded_at,
    patients: ward.patients.length,
    assessments: stored,
    prompts: await Prompt.countDocuments()
  });
};

/** Advance every bed by one reading, from the state held in Mongo. */
const tickWard = async (req, res) => {
  const states = await StayState.find().lean();
  if (!states.length) {
    return res.status(409).json({ message: 'ward not seeded -- POST /api/ward/seed first' });
  }

  const beds = states.map((s) => ({
    patient_id: s.patient_id,
    tick: s.tick,
    stay_state: s.stay_state,
    last_band: s.last_band,
    offline_devices: s.offline_devices
  }));

  let stepped;
  try {
    const { data } = await scoring.post('/ward/tick', { seed: states[0].seed, beds });
    stepped = data;
  } catch (err) {
    return fromUpstream(res, err, 'the model service');
  }

  for (const step of stepped.patients) {
    await persist(step.assessment);
    await StayState.updateOne(
      { patient_id: step.patient_id },
      {
        tick: step.tick,
        stay_state: step.stay_state,
        // Only a published band updates the watermark. A refused reading must
        // not clear it, or the next scored reading would look like a promotion
        // and raise a prompt that nothing actually crossed.
        ...(step.assessment.assessment_status === 'assessed'
          ? { last_band: step.assessment.risk_level }
          : {})
      }
    );
  }

  res.json({ message: 'ward advanced', at: stepped.at, patients: stepped.patients.length });
};

/** The board: the latest assessment per patient. */
const getWard = async (req, res) => {
  const latest = await Assessment.aggregate([
    { $sort: { patient_id: 1, assessed_at: -1 } },
    { $group: { _id: '$patient_id', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    // Projected out by hand: aggregate bypasses the schema, so `select: false`
    // does not apply and every board response would carry eight full internal
    // records the browser has no use for.
    { $project: { record: 0 } },
    { $sort: { bed_code: 1 } }
  ]);
  // An empty ward is an empty list, not a 204: Express strips a 204's body, so
  // `.json()` threw and the empty-state screen was unreachable.
  res.json(await Promise.all(latest.map(withPrompt)));
};

/** One patient's current assessment. */
const getPatient = async (req, res) => {
  const { patientId } = req.params;
  const latest = await Assessment.findOne({ patient_id: patientId })
    .sort({ assessed_at: -1 }).lean();
  if (!latest) {
    return res.status(404).json({ message: `no assessment for ${patientId}` });
  }
  res.json(await withPrompt(latest));
};

/** Recent assessments, oldest first. The strip reads each row's STORED
 *  risk_level -- re-deriving the band from the score discards the hysteresis
 *  and brings back the flicker the band table exists to remove. */
const getHistory = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || HISTORY_LIMIT, 200);
  const rows = await Assessment.find({ patient_id: req.params.patientId })
    .sort({ assessed_at: -1 }).limit(limit).lean();
  res.json(rows.reverse());
};

/** One parameter over time -- a pivot of the same stored rows. */
const getParameterHistory = async (req, res) => {
  const { patientId, parameterName } = req.params;
  const limit = Math.min(Number(req.query.limit) || 24, 200);
  const rows = await Assessment.find({ patient_id: patientId })
    .sort({ assessed_at: -1 }).limit(limit)
    .select('assessed_at parameters').lean();

  const points = rows.reverse().map((row) => {
    const reading = row.parameters.find((p) => p.parameter_name === parameterName);
    if (!reading) return null;
    return {
      assessed_at: row.assessed_at,
      value: reading.value,
      source: reading.source,
      age_minutes: reading.age_minutes
    };
  }).filter(Boolean);

  if (!points.length) {
    return res.status(404).json({ message: `no history for ${parameterName}` });
  }
  res.json(points);
};

/** Generate the explanation for a patient's latest assessment. 18-23 s on a
 *  local 7B. Every string is grounded against the record before it is stored;
 *  one that fails is replaced by the template, not shown with a warning. */
const explainPatient = async (req, res) => {
  const { patientId } = req.params;
  // `+record` because the schema hides it by default. It is what makes the
  // explanation describe the STORED reading -- sending a tick instead had the
  // service re-score at its own `now` and narrate a dwell no row ever had.
  const latest = await Assessment.findOne({ patient_id: patientId })
    .sort({ assessed_at: -1 }).select('+record').lean();
  if (!latest) {
    return res.status(404).json({ message: `no assessment for ${patientId}` });
  }
  if (latest.assessment_status !== 'assessed') {
    return res.status(409).json({
      message: 'this reading is below the data-sufficiency floor and is not explained',
      insufficiency_reason: latest.insufficiency_reason
    });
  }
  if (!latest.record) {
    return res.status(409).json({
      message: 'this assessment predates record storage -- re-seed the ward'
    });
  }

  let result;
  try {
    const { data } = await explaining.post('/explain/patient', {
      patient_id: patientId,
      record: latest.record,
      // The deterministic template floor instead of the 7B. Off by default; the
      // only way to exercise this path without 6.9 GB of VRAM.
      use_llm: req.body?.use_llm !== false
    });
    result = data;
  } catch (err) {
    return fromUpstream(res, err, 'the explanation generator');
  }

  await Assessment.updateOne(
    { _id: latest._id },
    {
      explanation: {
        status: result.status,
        explanation_text: result.explanation_text,
        grounding_status: result.grounding_status
      }
    }
  );
  res.json(result);
};

/** Borrowed patient context: recorded, never computed by the model. */
const getPatientContext = async (req, res) => {
  const state = await StayState.findOne({ patient_id: req.params.patientId })
    .select('context').lean();
  if (!state?.context) {
    return res.status(404).json({ message: `no context for ${req.params.patientId}` });
  }
  res.json(state.context);
};

/** Record a clinician's disposition of a prompt. */
const reviewPrompt = async (req, res) => {
  const { disposition, note } = req.body || {};
  const allowed = ['acknowledged', 'actioned', 'dismissed', 'escalated'];
  if (!allowed.includes(disposition)) {
    return res.status(400).json({ message: `disposition must be one of ${allowed.join(', ')}` });
  }

  // ATTRIBUTION COMES FROM AN AUTHENTICATED PRINCIPAL, OR IT IS DECLARED ABSENT.
  //
  // This used to read `clinician: clinician || 'ICU Clinician'` -- a free-text
  // body field with a default, on an unauthenticated route. It is the only
  // human-authored record in the system, and a defaulted name is not a weaker
  // audit record: it is a false one, and a reviewer will believe it.
  //
  // `req.user` is set by verifyJWT, which is deliberately unmounted, so today
  // there is no principal. We record that fact rather than inventing a name or
  // refusing the disposition -- `attributed: false` is true, and the screen says
  // so. The body is never consulted; a caller cannot assert who they are.
  const actor = req.user ?? null;

  const prompt = await Prompt.findByIdAndUpdate(
    req.params.promptId,
    {
      status: 'reviewed',
      review: {
        disposition,
        note: note || null,
        reviewed_at: new Date(),
        clinician: actor,
        attributed: actor !== null
      }
    },
    { new: true }
  );
  if (!prompt) return res.status(404).json({ message: 'no such prompt' });
  res.json(prompt);
};

/** Switch an input source off, or back on. The consequence is the point. */
const setDeviceState = async (req, res) => {
  const { patientId } = req.params;
  const { device_id: deviceId, offline } = req.body || {};
  if (!deviceId) return res.status(400).json({ message: 'device_id required' });

  const state = await StayState.findOne({ patient_id: patientId });
  if (!state) return res.status(404).json({ message: `no stay state for ${patientId}` });

  const current = new Set(state.offline_devices);
  if (offline) current.add(deviceId); else current.delete(deviceId);
  state.offline_devices = [...current];
  await state.save();

  res.json({ patient_id: patientId, offline_devices: state.offline_devices });
};

/** Attach the patient's most recent prompt and its disposition. */
const withPrompt = async (assessment) => {
  // A refusal carries no prompt field at all -- absent, not null, because
  // `insufficient_data` implies no RISK_PROMPT row. The patient's open prompt
  // still surfaces on their scored rows.
  if (assessment.assessment_status !== 'assessed') return assessment;

  // The LATEST prompt, whatever its status. Filtering to `open` made `review`
  // structurally unreachable: an open prompt has no review by definition.
  const prompt = await Prompt.findOne({ patient_id: assessment.patient_id })
    .sort({ raised_at: -1 }).lean();
  // Keyed on `disposition`, not on the object existing. Mongoose materialises
  // the nested `review` path as `{}` on a prompt nobody has reviewed, and `{}`
  // is truthy -- which put "Review recorded ... at NaN:NaN:NaN by ." on screen
  // beside a prompt that was still open and awaiting exactly that review.
  const review = prompt?.review?.disposition ? prompt.review : null;
  return { ...assessment, prompt: prompt || null, review };
};

module.exports = {
  seedWard,
  tickWard,
  getWard,
  getPatient,
  getHistory,
  getParameterHistory,
  getPatientContext,
  explainPatient,
  reviewPrompt,
  setDeviceState
};
