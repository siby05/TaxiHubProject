import { useEffect, useState } from 'react';

const DISMISS_KEY = 'installPromptDismissedAt';
const DISMISS_DAYS = 30;

function recentlyDismissed() {
  const at = Number(localStorage.getItem(DISMISS_KEY));
  return at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

// Chrome/Android only fires 'beforeinstallprompt' when the page already
// meets its installability bar (manifest + active service worker - see
// public/manifest.json and public/sw.js) - browsers that don't support
// installing (iOS Safari, desktop without a Chromium engine) simply never
// fire it, so this naturally never renders there instead of needing to
// sniff the platform.
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      if (recentlyDismissed()) return;
      setDeferredPrompt(e);
      setVisible(true);
    }
    function onInstalled() {
      setVisible(false);
      setDeferredPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Shown once per prompt event either way - accepted fires 'appinstalled'
    // above, declined shouldn't be re-offered immediately either.
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferredPrompt(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="card" style={{ background: '#e0f2fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <span>Install EasyRide on your phone for quicker access - no browser bar, just tap and book.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={install}>Install</button>
        <button className="btn secondary" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
