const axios = require('axios');
const { requestId, timing, timingFrom } = require('../middleware/requestContext');

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
    config.startedAt = process.hrtime.bigint();
    return config;
  });

  // The hop itself, and the model service's own spans carried up unaltered.
  //
  // `upstream` MINUS the forwarded stage durations is the transport cost --
  // serialisation, the loopback socket, and FastAPI's own routing. Reporting it
  // as a separate span is what lets a reader see that a 26 s explanation was 26 s
  // of generation and not 26 s of anything this tier did.
  const record = (response) => {
    const startedAt = response?.config?.startedAt;
    if (startedAt) {
      timing('upstream', startedAt, process.hrtime.bigint());
    }
    timingFrom(response?.headers?.['server-timing']);
  };

  client.interceptors.response.use(
    (response) => { record(response); return response; },
    // A refusal is still a measurement, and the slow failures are the ones worth
    // seeing: a 240 s explanation timeout and an instant 503 both arrive here.
    (error) => { record(error?.response ?? { config: error?.config }); throw error; },
  );
}

module.exports = { BASE_URL, scoring, explaining };
