const axios = require('axios');

/** The FastAPI model service. Two timeouts because the endpoints differ by three
 *  orders of magnitude: ~66 ms to score, 18-23 s to explain on a local 7B. */
const BASE_URL = process.env.MODEL_SERVICE_URL || 'http://127.0.0.1:8000';

const SCORE_TIMEOUT_MS = 120_000;   // seeding scores 192 readings in one call

// Five minutes is the measured range, not a target: the first call also loads
// 6.9 GB of weights, and warm generation runs 18-23 s, ~75 s on a full card.
const EXPLAIN_TIMEOUT_MS = 300_000;

const scoring = axios.create({ baseURL: BASE_URL, timeout: SCORE_TIMEOUT_MS });
const explaining = axios.create({ baseURL: BASE_URL, timeout: EXPLAIN_TIMEOUT_MS });

module.exports = { BASE_URL, scoring, explaining };
