const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID, createHmac } = require('node:crypto');

/**
 * One id per request, reachable anywhere without threading it through every call.
 *
 * The previous logger minted a fresh uuid inside each log write, so two lines
 * from one request carried different ids and could not be joined -- and none of
 * them reached the model service. This replaces that.
 */
const als = new AsyncLocalStorage();

const requestId = () => als.getStore()?.requestId;

/**
 * Pseudonymise a patient identifier for logs. Keyed HMAC, so the same patient
 * correlates within a deployment and nothing correlates across one.
 *
 * MIMIC-IV is credentialed under a PhysioNet DUA and this repository is public.
 * The rule that follows: application logs may carry route templates, status
 * codes, durations, request ids and these hashes. They may never carry patient
 * identifiers, parameter values, telemetry, or explanation text -- that last one
 * is the tempting one, being prose about a specific patient's physiology.
 */
const subject = (id) => {
    if (!id) return undefined;
    const key = process.env.LOG_SUBJECT_KEY;
    if (!key) return 'unkeyed';   // fail visible, never fall back to the raw id
    return createHmac('sha256', key).update(String(id)).digest('hex').slice(0, 12);
};

const requestContext = (req, res, next) => {
    const id = req.headers['x-request-id'] || randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);

    als.run({ requestId: id }, () => {
        const started = process.hrtime.bigint();
        let logged = false;
        // 'finish' for a completed response, 'close' for an aborted one. Native
        // events rather than the `on-finished` package, which reaches this repo
        // only as a transitive dependency of Express.
        const record = () => {
            if (logged) return;
            logged = true;
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            // The matched ROUTE, never req.url -- our URLs carry patient ids
            // (/api/patient/PM-204/history) and req.url would write them to disk.
            // req.route is only populated after routing, hence on-finished.
            const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;
            console.log(JSON.stringify({
                level: 'info',
                time: new Date().toISOString(),
                request_id: id,
                method: req.method,
                route,
                subject: subject(req.params?.patientId),
                status: res.statusCode,
                duration_ms: Math.round(ms),
            }));
        };
        res.on('finish', record);
        res.on('close', record);
        next();
    });
};

module.exports = { requestContext, requestId, subject, als };
