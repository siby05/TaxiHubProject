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

function isColdStartError(err) {
  if (!err.config || err.code === 'ERR_CANCELED') return false;
  if (!err.response) return true; // network error - server not answering yet
  return [502, 503, 504].includes(err.response.status);
}

// Fired once on app start so a sleeping server starts booting while the
// page renders, rather than only when the first data request lands.
export function wakeServer() {
  client.get('/health').catch(() => {});
}

client.interceptors.response.use(
  (res) => {
    setWaking(false);
    return res;
  },
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('easyride_token');
      localStorage.removeItem('easyride_user');
    }
    const config = err.config;
    if (isColdStartError(err) && RETRYABLE_METHODS.includes((config.method || 'get').toLowerCase())) {
      const attempt = config.__wakeAttempt || 0;
      if (attempt < WAKE_RETRY_DELAYS_MS.length) {
        setWaking(true);
        await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_DELAYS_MS[attempt]));
        return client({ ...config, __wakeAttempt: attempt + 1 });
      }
      setWaking(false);
    }
    return Promise.reject(err);
  },
);

export default client;
