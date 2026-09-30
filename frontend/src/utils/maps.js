// Google Maps' documented URL API (no key/SDK needed): opens Maps with
// directions already plotted - pickup (plus any stops) as waypoints, drop-
// off as the destination. Origin is deliberately left out: Maps falls back
// to the viewer's own current location automatically when opened, so this
// works with one tap and no separate geolocation permission prompt of our
// own (see https://developers.google.com/maps/documentation/urls/get-started#directions-action).
export function directionsLink(booking) {
  if (!booking) return null;
  const waypoints = [
    `${booking.pickupLat},${booking.pickupLng}`,
    ...(booking.stops || []).map((s) => `${s.lat},${s.lng}`),
  ].join('|');
  const params = new URLSearchParams({
    api: '1',
    destination: `${booking.dropLat},${booking.dropLng}`,
    waypoints,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Opens a recorded GPS track (see backend GET /api/admin/bookings/:id/track)
// in Google Maps as a route: first point as origin, last as destination,
// and up to 9 evenly spaced points in between as waypoints (the most the
// Maps URL API honours), which is enough to show which way the car went.
const MAX_TRACK_WAYPOINTS = 9;
export function trackLink(points) {
  if (!points || points.length === 0) return null;
  const at = (p) => `${p.lat},${p.lng}`;
  if (points.length === 1) return `https://www.google.com/maps/search/?api=1&query=${at(points[0])}`;
  const middle = points.slice(1, -1);
  const step = Math.max(1, Math.ceil(middle.length / MAX_TRACK_WAYPOINTS));
  const waypoints = middle.filter((_, i) => i % step === 0).slice(0, MAX_TRACK_WAYPOINTS).map(at).join('|');
  const params = new URLSearchParams({
    api: '1',
    origin: at(points[0]),
    destination: at(points[points.length - 1]),
    travelmode: 'driving',
    ...(waypoints && { waypoints }),
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
