// Fixed-window, per-IP request limiter for the unauthenticated endpoints
// that are otherwise free to hammer: login/password-reset (credential
// guessing), guest booking + enquiry (spam that also burns email quota)
// and the geocode proxy (third-party quota). In-process only - fine for a
// single instance, and req.ip is the real client because server.js sets
// trust proxy. The bucket map is swept every window so it can't grow
// without bound under a flood of distinct addresses.
function rateLimit({ windowMs = 60 * 1000, max = 30, message = 'Too many requests - please wait a moment and try again' } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.start < cutoff) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.start < now - windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      if (entry.count === max + 1) console.warn(`[ratelimit] ${key} exceeded ${max} requests/${windowMs / 1000}s on ${req.method} ${req.originalUrl.split('?')[0]}`);
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
