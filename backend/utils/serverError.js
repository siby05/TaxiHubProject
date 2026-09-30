// Replies 500 without echoing the exception text to the client (it can
// carry database or file-system internals); the full error goes to the
// server log instead, tagged with the route so it's still traceable.
function serverError(res, err, req) {
  console.error(`[500] ${req ? `${req.method} ${req.originalUrl}` : ''} ${err && err.stack ? err.stack : err}`);
  return res.status(500).json({ error: 'Something went wrong - please try again' });
}

module.exports = { serverError };
