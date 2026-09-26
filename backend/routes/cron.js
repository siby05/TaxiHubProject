const express = require('express');
const crypto = require('crypto');
const { checkScheduledBackup } = require('../utils/backup');

const router = express.Router();

// POST /api/cron/backup - called once a day by the GitHub Actions workflow
// (.github/workflows/daily-wake.yml). On Render's free plan the server
// sleeps when nobody is using the site, and while asleep the hourly backup
// check in utils/backup.js never runs - this call wakes the server and runs
// that same check, so a due weekly backup goes out within a day even on a
// quiet week. It only sends when a backup is actually due; calling it more
// often is harmless.
//
// Protected by a shared secret (CRON_SECRET on Render, the same value as a
// GitHub repository secret) sent in the X-Cron-Secret header. Disabled
// entirely when CRON_SECRET isn't set.
function secretMatches(given) {
  const expected = process.env.CRON_SECRET;
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/backup', async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  if (!secretMatches(req.get('X-Cron-Secret'))) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await checkScheduledBackup());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
