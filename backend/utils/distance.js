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

module.exports = { haversineKm, calculateFare };
