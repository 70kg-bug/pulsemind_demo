const axios = require('axios');

/**
 * The FastAPI model service. It scores; this process stores.
 *
 * Two timeouts, because the endpoints differ by three orders of magnitude:
 * ~66 ms to score a reading, 18-23 s to write its explanation on a local 7B.
 */
const BASE_URL = process.env.MODEL_SERVICE_URL || 'http://127.0.0.1:8000';

const SCORE_TIMEOUT_MS = 120_000;   // seeding scores 192 readings in one call

// Five minutes is the width of the measured range, not a target: the first call
// also loads 6.9 GB of weights (~23 s before a token), and warm generation runs
// 18-23 s with room on the card and ~75 s when it is nearly full.
const EXPLAIN_TIMEOUT_MS = 300_000;

const scoring = axios.create({ baseURL: BASE_URL, timeout: SCORE_TIMEOUT_MS });
const explaining = axios.create({ baseURL: BASE_URL, timeout: EXPLAIN_TIMEOUT_MS });

module.exports = { BASE_URL, scoring, explaining };
