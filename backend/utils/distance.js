/**
 * Straight-line (haversine) distance as a free, no-API-key stand-in for a
 * real routing service like OSRM. Good enough for fare estimates in this
 * build; swap for a routing API call later without changing callers.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateFare(distanceKm, ratePerKm) {
  const baseFare = Number(process.env.BASE_FARE) || 3.5;
  const rate = ratePerKm || Number(process.env.DEFAULT_RATE_PER_KM) || 1.8;
  return Math.round((baseFare + distanceKm * rate) * 100) / 100;
}

// The price of whichever admin-configured distance band the trip falls
// into (see config/platformSettings.js fareRanges), or 0 if it's longer
// than every band - meaning that floor simply doesn't apply to this trip.
function rangeBasedPrice(distanceKm, fareRanges) {
  const band = (fareRanges || []).find((r) => distanceKm <= r.maxKm);
  return band ? band.price : 0;
}

// The per-km rate a trip is charged at. Normally the driver's own rate;
// for a trip longer than the admin's long-distance threshold (see
// config/platformSettings.js longDistanceThresholdKm/RatePerKm) the whole
// trip uses the admin's long-distance rate instead - unless the driver's
// own rate is already higher, which is kept.
function effectiveRatePerKm(distanceKm, ratePerKm, settings) {
  const driverRate = Number(ratePerKm) || Number(process.env.DEFAULT_RATE_PER_KM) || 1.8;
  const rate = Number(settings?.globalRatePerKm) > 0 ? Number(settings.globalRatePerKm) : driverRate;
  const longRate = Number(settings?.longDistanceRatePerKm) || 0;
  const threshold = Number(settings?.longDistanceThresholdKm) || 100;
  return longRate > 0 && distanceKm > threshold ? Math.max(rate, longRate) : rate;
}

// The actual quoted fare: the highest of (a) the per-km calculation (at
// the long-distance rate for long trips), (b) the admin's flat minimum
// fare, and (c) the admin's range-based price for this distance band - so
// neither a cheap per-km rate nor a driver's own rate can undercut the
// platform's configured floors.
function calculateTripFare(distanceKm, ratePerKm, settings) {
  const byDistance = calculateFare(distanceKm, effectiveRatePerKm(distanceKm, ratePerKm, settings));
  const byMinimum = settings?.minimumFare || 0;
  const byRange = rangeBasedPrice(distanceKm, settings?.fareRanges);
  return Math.max(byDistance, byMinimum, byRange);
}

// Card-only surcharge = Stripe's own processing fee, passed on to the
// passenger (see utils/stripeFees.js). Cash trips never carry this.
const { calculateCardSurcharge } = require('./stripeFees');

// Total distance across an ordered route: pickup -> each intermediate stop
// in order -> drop. stops is optional (an array of {lat, lng}, extra
// fields like address ignored) - with none given this is identical to a
// plain two-point haversineKm call, so every existing single-leg caller
// stays correct by just passing stops: undefined/[].
function routeDistanceKm(pickup, drop, stops) {
  const points = [pickup, ...(stops || []), drop];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  return Math.round(total * 100) / 100;
}

// Validates an optional multi-stop array: each entry needs numeric lat/lng
// (address is free text, kept as-is). Returns an error string, or null if
// ok - shared by every booking-creation route that accepts stops
// (routes/booking.js and routes/driver.js's book-for-passenger).
function invalidStopsError(stops) {
  if (stops === undefined || stops === null) return null;
  if (!Array.isArray(stops)) return 'stops must be an array';
  if (stops.some((s) => typeof s?.lat !== 'number' || typeof s?.lng !== 'number')) {
    return 'Each stop needs numeric lat/lng';
  }
  return null;
}

function cleanStops(stops) {
  return (stops || []).map((s) => ({ address: s.address || '', lat: s.lat, lng: s.lng }));
}

// Production driving distance uses a configured OSRM-compatible routing service.
// Never silently substitute straight-line distance when a configured router fails:
// that would underquote journeys and create inconsistent booking prices.
const drivingCache = new Map();
async function drivingRouteDistanceKm(pickup, drop, stops = []) {
  const base = process.env.ROUTING_OSRM_URL?.trim();
  if (!base) throw Object.assign(new Error('Driving-distance pricing is not configured. Contact EasyRide support.'), { status: 503 });
  const pts = [pickup, ...(stops || []), drop];
  if (pts.length > 12 || pts.some(p => !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng)) || Math.abs(Number(p.lat)) > 90 || Math.abs(Number(p.lng)) > 180)) throw Object.assign(new Error('Invalid trip coordinates'), { status: 400 });
  const coords = pts.map(p => `${Number(p.lng).toFixed(5)},${Number(p.lat).toFixed(5)}`).join(';');
  const cached = drivingCache.get(coords);
  if (cached && cached.expires > Date.now()) return cached.km;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const url = new URL(`route/v1/driving/${coords}`, base.replace(/\\/?$/, '/'));
    url.searchParams.set('overview', 'false');
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'EasyRideNZ/1.0 routing' } });
    if (!response.ok) throw Error(`routing HTTP ${response.status}`);
    const data = await response.json();
    const metres = data?.routes?.[0]?.distance;
    if (data.code !== 'Ok' || !Number.isFinite(metres) || metres < 0) throw Error('No drivable route found');
    const km = Math.round(metres / 10) / 10000;
    if (drivingCache.size > 1000) drivingCache.clear();
    drivingCache.set(coords, { km, expires: Date.now() + 10 * 60 * 1000 });
    return km;
  } catch (err) {
    console.error('[routing] driving route failed:', err.message);
    throw Object.assign(new Error('Could not calculate driving distance. Please try again shortly.'), { status: 503 });
  } finally { clearTimeout(timer); }
}

module.exports = {
  haversineKm, calculateFare, calculateTripFare, calculateCardSurcharge, routeDistanceKm, drivingRouteDistanceKm,
  invalidStopsError, cleanStops,
};
