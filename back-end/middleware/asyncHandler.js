/**
 * Wrap an async route so a rejected promise becomes a response, not an exit.
 *
 * Express 4 does not forward rejections from an async handler and Node exits
 * on an unhandled one, so `POST /api/prompt/notanid/review` was enough to take
 * the whole board down -- Mongoose throws CastError on a malformed id. That is
 * the client's mistake, so it answers 400 here; everything else is forwarded.
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch((err) => {
    if (err?.name === 'CastError') {
      return res.status(400).json({ message: `${err.path} is not a valid id` });
    }
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    return next(err);
  });

module.exports = asyncHandler;
