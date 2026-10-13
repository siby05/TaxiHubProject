import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Uploaded files (complaint attachments, driver documents) are served from
// the backend's origin, not under /api - strip that suffix to link to them.
export const fileOrigin = API_URL.replace(/\/api\/?$/, '');

const client = axios.create({
  baseURL: API_URL,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('easyride_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Render's free plan puts the backend to sleep after ~15 minutes with no
// traffic, and the first requests after that fail (no response, or a
// 502/503/504 from Render's proxy) for up to about a minute while it
// starts - which used to leave dashboards showing no records until a later
// manual refresh. Read-only requests are retried through that window, and
// anything listening (see components/ServerWakeBanner.jsx) is told the
// server is waking so the page can say so instead of looking empty.
// Writes are never retried: a POST/PUT might have reached the server, and
// repeating it could double-book or double-complete a trip.
const WAKE_RETRY_DELAYS_MS = [3000, 5000, 8000, 10000, 12000, 15000, 15000]; // ~70s in all
const RETRYABLE_METHODS = ['get', 'head'];

let waking = false;
const wakeListeners = new Set();
function setWaking(value) {
  if (waking === value) return;
  waking = value;
  wakeListeners.forEach((fn) => fn(value));
}
export function onServerWaking(fn) {
  wakeListeners.add(fn);
  fn(waking);
  return () => wakeListeners.delete(fn);
}

// Whether the backend is answering: 'checking' (app just opened, first
// request not back yet), 'awake' (it has answered), or 'asleep' (no answer
// - still booting). components/ProtectedRoute.jsx sends a signed-in user to
// the login screen while it's asleep, instead of an empty dashboard.
let serverStatus = 'checking';
const statusListeners = new Set();
function setServerStatus(value) {
  if (serverStatus === value) return;
  serverStatus = value;
  statusListeners.forEach((fn) => fn(value));
}
export function onServerStatus(fn) {
  statusListeners.add(fn);
  fn(serverStatus);
  return () => statusListeners.delete(fn);
}
// An awake server answers /health well inside this; a sleeping one takes
// 30-60 s to boot.
const CHECKING_TIMEOUT_MS = 4000;

function isColdStartError(err) {
  if (!err.config || err.code === 'ERR_CANCELED') return false;
  // The device itself is offline - not something waiting on the server fixes.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (!err.response) return true; // network error - server not answering yet
  if (![502, 503, 504].includes(err.response.status)) return false;
  // Our own API answers errors with a JSON { error } body (e.g. the address
  // lookup when the external geocoder is down) - the server is clearly
  // awake. Render's proxy answers a sleeping server with an HTML page.
  const data = err.response.data;
  return !(data && typeof data === 'object' && 'error' in data);
}

// Fired once on app start so a sleeping server starts booting while the
// page renders, rather than only when the first data request lands.
export function wakeServer() {
  setTimeout(() => { if (serverStatus === 'checking') setServerStatus('asleep'); }, CHECKING_TIMEOUT_MS);
  client.get('/health').catch(() => {});
}

client.interceptors.response.use(
  (res) => {
    setWaking(false);
    setServerStatus('awake');
    return res;
  },
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('easyride_token');
      localStorage.removeItem('easyride_user');
    }
    const config = err.config;
    const coldStart = isColdStartError(err);
    // Any real answer (even an error) means the server is up.
    if (err.response && !coldStart) setServerStatus('awake');
    // Reads are retried; a write only when the caller says it's safe to
    // repeat (wakeRetry: true - e.g. logging in).
    const retryable = config?.wakeRetry === true || (config?.wakeRetry !== false && RETRYABLE_METHODS.includes((config?.method || 'get').toLowerCase()));
    if (coldStart && retryable) {
      const attempt = config.__wakeAttempt || 0;
      if (attempt < WAKE_RETRY_DELAYS_MS.length) {
        // A single failed request is often just a blip (a phone coming back
        // from the background, a flaky connection) - only say the server is
        // waking once a retry has failed too.
        if (attempt >= 1) {
          setWaking(true);
          setServerStatus('asleep');
        }
        await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_DELAYS_MS[attempt]));
        return client({ ...config, __wakeAttempt: attempt + 1 });
      }
    }
    // Not retrying this one. Any answer from the server (even a 404) means
    // it's awake, and a request that was mid-retry giving up (out of
    // retries, or cancelled because the user moved on) must not leave the
    // banner up with nothing left to clear it.
    if (err.response || config?.__wakeAttempt) setWaking(false);
    return Promise.reject(err);
  },
);

export default client;
