// middleware/errorHandler.js

// 404 Not Found middleware
export function notFound(req, res, next) {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
}

/**
 * Postgres rejections that are really bad input, not a broken server. Without
 * this they surface to the front desk as "numeric field overflow" with a 500.
 */
const PG_INPUT_ERRORS = {
  "22001": "One of those values is too long for the field it was typed into.",
  "22003": "One of those numbers is too large.",
  "22007": "One of those dates is not in a format we understand.",
  "22P02": "One of those values is not the kind of value that field expects.",
  "23502": "A required field was left empty.",
  "23503": "That refers to a record that no longer exists.",
  "23505": "That already exists.",
  "23514": "One of those values is not allowed for that field.",
};

// General error handling middleware
export function errorHandler(err, req, res, next) {
  const explicit = res.statusCode && res.statusCode !== 200 ? res.statusCode : null;
  const friendly = !explicit && !err.status && err.code ? PG_INPUT_ERRORS[err.code] : null;
  const statusCode = explicit || err.status || (friendly ? 400 : 500);

  // A 500 is ours to fix, so keep the real cause where we can read it. What goes
  // back to the browser stays generic — database text is not a user-facing message.
  if (statusCode >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  res.status(statusCode).json({
    message: friendly || (statusCode >= 500 ? "Something went wrong on our side. Please try again." : err.message || "Server error"),
  });
}
