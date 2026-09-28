import { useEffect, useState } from 'react';
import { onServerWaking } from '../api/client';

// Shown while api/client.js is retrying requests against a backend that's
// still starting up (Render free plan sleeps when idle) - so an empty
// dashboard reads as "loading" rather than "you have no bookings".
export default function ServerWakeBanner() {
  const [waking, setWaking] = useState(false);
  useEffect(() => onServerWaking(setWaking), []);
  if (!waking) return null;
  return (
    <div role="status" style={{ background: '#fef3c7', color: '#92400e', textAlign: 'center', padding: '10px 16px', fontSize: '0.9rem' }}>
      Waking up the server - this can take up to a minute after a quiet spell. Your records will appear automatically.
    </div>
  );
}
