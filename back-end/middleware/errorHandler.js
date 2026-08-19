
// RFC 9457 problem+json, and the same shape for every unhandled error.
// It used to send `err.message` as text/plain, which both leaked the internal
// message and gave clients a body they could not parse.
const errorHandler = (err, req, res, next) => {
    console.error(JSON.stringify({
        level: 'error', time: new Date().toISOString(),
        request_id: req.id, name: err.name, message: err.message,
        stack: err.stack,          // stderr only, never the response body
    }));
    res.status(500)
        .type('application/problem+json')
        .json({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            // Deliberately not err.message: RFC 9457 section 5 warns against
            // exposing implementation detail through the HTTP interface.
            detail: 'the request could not be completed',
            instance: req.id,
        });
}

module.exports = errorHandler;