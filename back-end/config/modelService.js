const axios = require('axios');
const { requestId } = require('../middleware/requestContext');

/** The FastAPI model service. Two timeouts because the endpoints differ by three
 *  orders of magnitude: ~66 ms to score, 18-23 s to explain on a local 7B. */
const BASE_URL = process.env.MODEL_SERVICE_URL || 'http://127.0.0.1:8000';

const SCORE_TIMEOUT_MS = 120_000;   // seeding scores 192 readings in one call

// Five minutes is the measured range, not a target: the first call also loads
// 6.9 GB of weights, and warm generation runs 18-23 s, ~75 s on a full card.
const EXPLAIN_TIMEOUT_MS = 300_000;

const scoring = axios.create({ baseURL: BASE_URL, timeout: SCORE_TIMEOUT_MS });
const explaining = axios.create({ baseURL: BASE_URL, timeout: EXPLAIN_TIMEOUT_MS });

// Both clients live here, which makes this the one seam where the request id
// crosses into the model service. Without it a 502 here cannot be matched to the
// traceback that caused it -- and with a 23 s call between them, timestamps do
// not close the gap.
for (const client of [scoring, explaining]) {
  client.interceptors.request.use((config) => {
    const id = requestId();
    if (id) config.headers['X-Request-Id'] = id;
    return config;
  });
}

module.exports = { BASE_URL, scoring, explaining };
