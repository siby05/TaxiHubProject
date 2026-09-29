// Keeps the Render free-plan server from going to sleep during the day.
//
// Render spins a free web service down after 15 minutes with no inbound
// traffic, and the next visitor waits up to a minute for it to start again -
// long enough that a passenger who has just scanned a driver's QR code gives
// up. Requesting our own public URL every 10 minutes goes through Render's
// proxy, counts as traffic, and so the server never goes idle.
//
// Only between 6am and 11pm NZ time: after the last ping the server sleeps
// overnight (the frontend still wakes it on demand, see
// frontend/src/api/client.js), and a sleeping server can't wake itself -
// the GitHub Actions workflow .github/workflows/daily-wake.yml calls it at
// 6am, after which this takes over again. ~17 hours a day is ~530
// instance-hours a month, well inside the free plan's 750.
//
// RENDER_EXTERNAL_URL is set by Render automatically; KEEP_AWAKE_URL can
// override it. Does nothing locally (neither is set), and KEEP_AWAKE=false
// turns it off.
const INTERVAL_MS = 10 * 60 * 1000;
const START_HOUR = 6; // 6am NZ
const END_HOUR = 23; // last ping before 11pm NZ

function nzHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', hourCycle: 'h23' }).format(date));
}

function startKeepAwake() {
  const base = (process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!base || process.env.KEEP_AWAKE === 'false') return;

  const url = `${base}/api/health`;
  console.log(`[keep-awake] pinging ${url} every ${INTERVAL_MS / 60000} minutes, ${START_HOUR}:00-${END_HOUR}:00 NZ time`);
  setInterval(async () => {
    const hour = nzHour();
    if (hour < START_HOUR || hour >= END_HOUR) return;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) console.error(`[keep-awake] health check responded ${res.status}`);
    } catch (err) {
      console.error(`[keep-awake] ping failed: ${err.message}`);
    }
  }, INTERVAL_MS).unref();
}

module.exports = { startKeepAwake, nzHour };
