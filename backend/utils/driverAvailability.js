const Booking = require('../models/Booking');
const { haversineKm } = require('./distance');

// Reasonable assumed average driving speed for estimating drive time from
// distance alone (no live GPS/traffic/routing data) - same approximation
// level as the rest of the fare model (utils/distance.js's calculateFare).
const ASSUMED_SPEED_KMH = 35;

// Minimum turnaround a driver gets between dropping one passenger and
// picking up the next, on top of the actual drive time between those two
// points.
const HANDOFF_BUFFER_MINUTES = 10;

function driveMinutes(distanceKm) {
  return (distanceKm / ASSUMED_SPEED_KMH) * 60;
}

// When will this driver actually be free to head to a new pickup?
//
// Looks at their current active trip, if any (status 'accepted' or
// 'in-progress' - a driver only ever has one at a time in this app).
// Estimates when that trip will finish (from when it was accepted, or
// actually started, plus its own estimated drive time - there's no live
// GPS to know how far into it they really are), then adds the drive time
// from that trip's drop-off to the new pickup, plus a fixed handoff
// buffer. If the estimate lands in the past (they're probably done
// already), treats them as free from now rather than backdating.
//
// Returns { busy: false, readyAt: null } when there's no active trip at
// all (free right now), otherwise { busy: true, readyAt: Date } - the
// earliest they could realistically reach a new pickup.
async function getDriverReadyTime(driverId, newPickupLat, newPickupLng) {
  const active = await Booking.findOne({ driverId, status: { $in: ['accepted', 'in-progress'] } });
  if (!active) return { busy: false, readyAt: null };

  const referenceStart = new Date(active.status === 'in-progress' ? (active.startedAt || active.acceptedAt) : active.acceptedAt);
  const estimatedTripEnd = new Date(referenceStart.getTime() + driveMinutes(active.distanceKm || 0) * 60000);
  const now = new Date();
  const freeAt = estimatedTripEnd > now ? estimatedTripEnd : now;

  const handoffKm = haversineKm(active.dropLat, active.dropLng, newPickupLat, newPickupLng);
  const handoffMinutes = driveMinutes(handoffKm) + HANDOFF_BUFFER_MINUTES;

  return { busy: true, readyAt: new Date(freeAt.getTime() + handoffMinutes * 60000) };
}

// True if a driver found to be busy would actually be ready in time for
// the passenger's requested slot (now, or a future scheduledFor) - a
// scheduled-ahead booking can still work even if the driver is mid-trip
// right now, as long as they'd be free by then.
function isReadyInTime(readyAt, requestedTime) {
  return readyAt.getTime() <= requestedTime.getTime();
}

module.exports = { getDriverReadyTime, isReadyInTime, driveMinutes, HANDOFF_BUFFER_MINUTES };
