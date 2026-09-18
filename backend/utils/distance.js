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

// The actual quoted fare: the highest of (a) the per-km calculation, (b)
// the admin's flat minimum fare, and (c) the admin's range-based price for
// this distance band - so neither a cheap per-km rate nor a driver's own
// rate can undercut the platform's configured floors.
function calculateTripFare(distanceKm, ratePerKm, settings) {
  const byDistance = calculateFare(distanceKm, ratePerKm);
  const byMinimum = settings?.minimumFare || 0;
  const byRange = rangeBasedPrice(distanceKm, settings?.fareRanges);
  return Math.max(byDistance, byMinimum, byRange);
}

// Card-only surcharge disclosed to the passenger up front (see
// platformSettings.cardSurchargePercent) - covers the payment gateway's
// own processing fee. Cash trips never carry this.
function calculateCardSurcharge(fare, surchargePercent) {
  return Math.round(fare * (surchargePercent / 100) * 100) / 100;
}

module.exports = { haversineKm, calculateFare, calculateTripFare, calculateCardSurcharge };
