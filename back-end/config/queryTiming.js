const { timing } = require('../middleware/requestContext');

/**
 * Time every database round trip and report it as a `mongo` span.
 *
 * A schema plugin rather than 24 wrapped call sites in the controller, and
 * applied EXPLICITLY in each model rather than through `mongoose.plugin()`.
 * The global form only reaches schemas compiled after it runs, so it depends on
 * `require` order in `server.js` -- and when that order changes the plugin does
 * not fail, it silently stops timing. A missing measurement that reports as a
 * clean run is worse than no measurement at all. Applied per model, a model
 * added without it is a visible gap in one greppable place.
 *
 * ⚠️ THIS DEPENDS ON AsyncLocalStorage SURVIVING THE DRIVER'S ASYNC BOUNDARY.
 * `timing()` resolves the current request out of the store; if the context were
 * lost between issuing a query and its callback, it would find nothing and do
 * nothing -- quietly. `checks/check_node.py` asserts a `mongo` span is actually
 * present on a real response for exactly that reason: this is not a mechanism
 * that can be trusted because it did not throw.
 */

// Named explicitly rather than by regex. Mongoose applies query, aggregate,
// document and model middleware from different registries, and a regex that
// looks like it covers all four covers whichever ones it happens to match.
const QUERY_OPS = [
    'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'updateOne', 'updateMany', 'replaceOne',
    'deleteOne', 'deleteMany', 'countDocuments', 'estimatedDocumentCount', 'distinct',
];

const started = function () { this._pmStartedAt = process.hrtime.bigint(); };

const finished = function () {
    if (!this._pmStartedAt) return;
    // The interval, not its length: `GET /ward` issues eight of these at once,
    // and eight overlapping durations added together came to more than the whole
    // request. The middleware unions them instead.
    timing('mongo', this._pmStartedAt, process.hrtime.bigint());
    this._pmStartedAt = undefined;
};

module.exports = function queryTiming(schema) {
    schema.pre(QUERY_OPS, started);
    schema.post(QUERY_OPS, finished);

    // Document and aggregate middleware live in their own registries; `save`
    // and `insertMany` never match a query hook however it is written.
    schema.pre('save', started);
    schema.post('save', finished);
    schema.pre('insertMany', started);
    schema.post('insertMany', finished);
    schema.pre('aggregate', started);
    schema.post('aggregate', finished);
};
