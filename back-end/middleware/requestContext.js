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

/** A Server-Timing desc is a quoted-string: escape the two characters that end it. */
const quote = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Collect measured spans on the response and emit them as one Server-Timing
 * header (W3C), so the dashboard can show what each tier actually cost.
 *
 * ⚠️ EMITTED FROM `writeHead`, NOT from the 'finish' listener below. By 'finish'
 * the headers are already on the wire and `setHeader` is either an exception or
 * a silent no-op depending on how it is reached -- so the obvious place to put
 * this, beside the duration the logger already computes, is the one place it
 * cannot work. `writeHead` is the last moment the headers are still ours.
 *
 * Spans AGGREGATE by name. A tick writes to Mongo repeatedly, and repeating the
 * entry once per write would be legal and unreadable.
 *
 * ⚠️ AGGREGATED AS A UNION OF INTERVALS, NOT AS A SUM. Measured 2026-08-22:
 * `GET /ward` issues its eight Mongo reads concurrently, and summing them
 * reported `mongo;dur=1325` inside `total;dur=577` — a child four times larger
 * than the request containing it. The panel indents these to show what nests in
 * what, so a sum over concurrent work does not just overstate a number, it draws
 * a tree that is not one. The union answers the question actually being asked:
 * how much of this request's wall time was spent in Mongo at all.
 */
const measure = (res, started) => {
    const spans = new Map();
    const upstream = [];

    /** Record work that ran between two `process.hrtime.bigint()` readings. */
    res.timing = (name, from, to, desc) => {
        const span = spans.get(name) || { intervals: [], desc: undefined };
        span.intervals.push([
            Number(from - started) / 1e6,
            Number(to - started) / 1e6,
        ]);
        if (desc !== undefined) span.desc = desc;
        spans.set(name, span);
    };

    /** Total length of the union of a span's intervals, in milliseconds. */
    const union = (intervals) => {
        const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
        let total = 0, start = null, end = null;
        for (const [from, to] of sorted) {
            if (start === null) { start = from; end = to; continue; }
            if (from > end) { total += end - start; start = from; end = to; }
            else if (to > end) { end = to; }
        }
        if (start !== null) total += end - start;
        return total;
    };

    // An observation that is not a duration -- a queue depth, a model id. Kept
    // separate from `timing` so it cannot acquire a `dur`: emitting `dur=0` for
    // something that was never timed is a measurement the system does not have.
    res.mark = (name, desc) => {
        const span = spans.get(name) || { intervals: [], desc: undefined };
        span.desc = desc;
        spans.set(name, span);
    };

    // The model service's own spans, forwarded verbatim: they were measured
    // where the work happened and this tier has nothing to add to them. Names do
    // not collide -- Python emits pipeline stages, Node emits transport and
    // storage -- so they can simply sit side by side in one header.
    res.timingFrom = (raw) => {
        // A newline here would end the header and begin a forged one. It comes
        // from our own service today; it is stripped anyway, because "trusted
        // upstream" is an assumption and this is one line of code.
        if (raw) upstream.push(String(raw).replace(/[\r\n]/g, ' ').trim());
    };

    const render = () => {
        const parts = [...upstream].filter(Boolean);
        for (const [name, span] of spans) {
            const count = span.intervals.length;
            // No interval means nothing was timed -- a `mark`. It gets a desc and
            // no `dur`, which is what the spec is for and what stops a reader
            // adding it to a total.
            if (!count) {
                parts.push(span.desc === undefined ? name : `${name};desc=${quote(span.desc)}`);
                continue;
            }
            const wall = union(span.intervals);
            let entry = `${name};dur=${wall.toFixed(3)}`;

            const notes = [];
            if (span.desc !== undefined) notes.push(span.desc);
            if (count > 1) {
                // Say WHICH kind of repetition it was. Eight sequential writes
                // and eight concurrent ones produce very different numbers from
                // the same count, and only one of them can be added to its
                // siblings. Deriving it rather than declaring it: a caller that
                // has to remember to say "concurrent" will eventually forget.
                const sum = span.intervals.reduce((t, [f, o]) => t + (o - f), 0);
                notes.push(sum > wall * 1.05 ? `${count}x concurrent` : `${count}x`);
            }
            if (notes.length) entry += `;desc=${quote(notes.join(', '))}`;
            parts.push(entry);
        }
        return parts.join(', ');
    };

    const originalWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
        if (!res.headersSent) {
            // Last, so it reads as the sum it is. Slightly under the figure the
            // log line records, which also covers writing the body -- two honest
            // measurements of two different things, not a discrepancy.
            res.timing('total', started, process.hrtime.bigint());
            const header = render();
            // Only when something was measured. An empty header is an entry a
            // reader cannot distinguish from a stage that took no time.
            if (header) res.setHeader('Server-Timing', header);
        }
        return originalWriteHead.apply(this, args);
    };
};

const requestContext = (req, res, next) => {
    const id = req.headers['x-request-id'] || randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);

    // `res` is in the store for the same reason `requestId` is: the model-service
    // client is three files away from any response object and threading one
    // through every call site to record a duration is not worth the churn.
    als.run({ requestId: id, res }, () => {
        const started = process.hrtime.bigint();
        measure(res, started);
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

/**
 * Record a span from anywhere inside a request, without holding the response.
 *
 * Silently does nothing outside a request context -- a startup call or a stray
 * timer has no response to write to, and a measurement is not worth an
 * exception. That is the one case where a no-op is right: the alternative is a
 * crash in the observability layer taking down the thing it observes.
 */
const timing = (name, from, to, desc) => als.getStore()?.res?.timing?.(name, from, to, desc);

/** Forward the model service's own Server-Timing entries, unaltered. */
const timingFrom = (raw) => als.getStore()?.res?.timingFrom?.(raw);

module.exports = { requestContext, requestId, subject, als, timing, timingFrom };
