import { useEffect, useRef } from 'react';
import client from '../api/client';

// How often a fix is sent while a trip is active. watchPosition can fire
// every second on some phones - one point every 15 s is plenty to redraw
// the route afterwards without flooding the API.
const SEND_INTERVAL_MS = 15 * 1000;

// Watches the driver's GPS position while `active` is true and posts it to
// POST /api/booking/driver/location, which stores it against every trip the
// driver currently has on the go (kept for 7 days - see backend
// utils/retention.js). Stops watching as soon as no trip is active, so the
// phone isn't tracked between jobs. Returns nothing; failures (permission
// denied, no signal) are reported through onError.
export function useTripGpsTracking(active, onError) {
  const lastSentRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active) return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onErrorRef.current?.('GPS is not available on this device, so trip tracking is off.');
      return undefined;
    }

    lastSentRef.current = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < SEND_INTERVAL_MS) return;
        lastSentRef.current = now;
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;
        client.post('/booking/driver/location', {
          lat: latitude,
          lng: longitude,
          accuracy,
          speed,
          heading,
          recordedAt: new Date(pos.timestamp).toISOString(),
        }).catch(() => { lastSentRef.current = 0; }); // retry on the next fix
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onErrorRef.current?.('Location permission is off, so this trip\'s GPS route is not being recorded. Allow location access for EasyRide to turn it on.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active]);
}
