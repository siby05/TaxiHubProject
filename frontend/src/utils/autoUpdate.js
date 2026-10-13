// Reloads the app when a newer version has been deployed. A home-screen
// app (iPhone especially) keeps the page it loaded in memory and doesn't
// fetch a new version until it's fully closed, so drivers kept using an
// old build after an update went live. The build id baked in at build time
// (vite.config.js) is compared with /version.json from the server whenever
// the app comes back to the screen and every 10 minutes.
/* global __BUILD_ID__ */
const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;
const CHECK_EVERY_MS = 10 * 60 * 1000;

// Don't reload under someone mid-task: typing in a field or with a dialog
// (Complete trip, Edit trip...) open. Try again on the next check.
function busy() {
  const el = document.activeElement;
  if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return !!document.querySelector('[role="dialog"], .modal-open');
}

let reloading = false;
async function check() {
  if (!CURRENT || reloading || document.visibilityState !== 'visible') return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (build && build !== CURRENT && !busy()) {
      reloading = true;
      window.location.reload();
    }
  } catch { /* offline - try again later */ }
}

export function startAutoUpdate() {
  if (!CURRENT || import.meta.env.DEV) return;
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setInterval(check, CHECK_EVERY_MS);
  setTimeout(check, 5000);
}
