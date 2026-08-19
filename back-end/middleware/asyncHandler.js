/**
 * Wrap an async route so a rejected promise becomes a response, not an exit.
 * Express 4 does not forward them and Node exits, so
 * `POST /api/prompt/notanid/review` was enough to take the board down.
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
