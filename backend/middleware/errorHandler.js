function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// 4xx messages are written for users (validation, auth); anything else is
// an internal failure whose details (stack, driver/library messages,
// file paths) belong in the log, not the response.
function errorHandler(err, req, res, _next) {
  console.error(err);
  // Multer's own errors (file too large, too many files) are user errors too.
  const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: status < 500 && err.message ? err.message : 'Internal server error' });
}

module.exports = { notFound, errorHandler };
