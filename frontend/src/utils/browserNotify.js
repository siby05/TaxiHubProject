// Native browser notifications so a driver doesn't miss a new trip request
// even if the tab isn't focused. Falls back silently if unsupported/denied
// - the in-app alert banner and bell still work regardless.
export function notificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

// iOS (home-screen web app, 16.4+) exposes Notification but throws
// "Illegal constructor" on `new Notification()` - it only allows them
// through the service worker. Try that first, and never let a failure
// here break the caller (the driver dashboard reloads its trips right
// after calling this).
export function showBrowserNotification(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker?.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => (reg ? reg.showNotification(title, { body }) : new Notification(title, { body })))
        .catch(() => {});
      return;
    }
    new Notification(title, { body });
  } catch { /* in-app banner and bell still show it */ }
}
