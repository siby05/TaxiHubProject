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
