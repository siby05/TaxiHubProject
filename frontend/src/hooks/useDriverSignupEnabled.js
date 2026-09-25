import { useEffect, useState } from 'react';
import client from '../api/client';

// Whether the admin has driver sign-up switched on (Admin dashboard ->
// settings). Every "apply to drive" link in the app is gated on this, so
// when it's off they disappear entirely rather than leading to a "closed"
// page. Starts false (links hidden until confirmed on, so they never flash
// in and back out) and the one request is shared by every component on
// the page.
let cached;
let inflight;

export function useDriverSignupEnabled() {
  const [enabled, setEnabled] = useState(cached ?? false);

  useEffect(() => {
    if (cached !== undefined) return undefined;
    let alive = true;
    inflight = inflight || client.get('/driver-signup/enabled')
      .then((r) => { cached = !!r.data.enabled; return cached; })
      .catch(() => { inflight = undefined; return false; });
    inflight.then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);

  return enabled;
}
