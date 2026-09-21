// Minimal service worker - its only job is to exist and be active, which is
// one of Chrome's requirements for a page to be considered installable
// (alongside the manifest in index.html). No offline caching is attempted:
// this app is API/socket-driven and stale cached responses would be worse
// than no cache at all, so every request just passes straight through.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
