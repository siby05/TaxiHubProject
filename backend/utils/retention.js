const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const Notification = require('../models/Notification');
const TripLocation = require('../models/TripLocation');
const { getSettings } = require('../config/platformSettings');
const { archiveCompletedTrips } = require('./earnings');

// NZ Transport Agency requires complaint records to be kept for 2 years.
// Each complaint gets its own fixed retentionExpiryDate at creation time
// (see models/Complaint.js), so this only ever removes ones that have
// genuinely aged out - unlike trip retention below, it isn't admin-
// configurable, since it's a compliance floor, not a housekeeping choice.
// (Also reachable manually via DELETE /api/complaints/admin/archive-old,
// which runs the exact same query - this scheduler is what makes that
// happen automatically instead of relying on an admin to remember to call it.)
async function cleanupOldComplaints() {
  const result = await Complaint.deleteMany({ retentionExpiryDate: { $lt: new Date() } });
  if (result.deletedCount > 0) {
    console.log(`[retention] removed ${result.deletedCount} complaint(s) past the 2-year retention window`);
  }
  return result.deletedCount;
}

// How full the database is, against the admin's storage limit
// (platformSettings.dbStorageLimitMb - e.g. 512 for a free MongoDB Atlas
// cluster). null when it can't be measured (memory mode, or the stats
// call failed) - and an unmeasurable database is never treated as full.
async function getStorageUsage() {
  if ((process.env.DB_MODE || 'memory') !== 'mongo') return null;
  try {
    const mongoose = require('mongoose');
    const stats = await mongoose.connection.db.stats();
    const usedMb = ((stats.dataSize || 0) + (stats.indexSize || 0)) / (1024 * 1024);
    const limitMb = Number(getSettings().dbStorageLimitMb) || 512;
    return { usedMb, limitMb, percent: Math.round((usedMb / limitMb) * 1000) / 10 };
  } catch (err) {
    console.error('[retention] could not read database size:', err.message);
    return null;
  }
}

// Retain all trips until measured usage reaches the configured database limit.
// Remove only the oldest eligible finished trip per check, then measure again
// next time. Unknown usage never authorizes deletion. Serialize local runs.
let tripCleanupRunning = false;
async function cleanupOldTrips({ readUsage = getStorageUsage } = {}) {
  if (tripCleanupRunning) return 0;
  tripCleanupRunning = true;
  try {
    const usage = await readUsage();
    if (!usage || !Number.isFinite(usage.usedMb) || !Number.isFinite(usage.limitMb)
      || usage.limitMb <= 0 || usage.usedMb < usage.limitMb) return 0;

    const finished = await Booking.find({ status: { $in: ['completed', 'cancelled'] } });
    const complaints = await Complaint.find({});
    const referencedIds = new Set(complaints.map((c) => String(c.bookingId?._id || c.bookingId)));
    const time = (b) => new Date(b.completedAt || b.cancelledAt || b.createdAt).getTime();
    const oldest = finished
      .filter((b) => (b.status === 'cancelled' || b.paymentStatus === 'paid')
        && !referencedIds.has(String(b._id)) && Number.isFinite(time(b)))
      .sort((a, b) => time(a) - time(b) || String(a._id).localeCompare(String(b._id)))[0];
    if (!oldest) return 0;

    // If archiving fails (including a full database rejecting that write),
    // keep the trip and report the failure rather than losing its earnings.
    await archiveCompletedTrips([oldest]);
    const result = await Booking.deleteMany({ _id: oldest._id, status: oldest.status,
      ...(oldest.status === 'completed' ? { paymentStatus: 'paid' } : {}) });
    console.log(`[retention] database at limit - removed ${result.deletedCount} oldest eligible trip (earnings archived)`);
    return result.deletedCount;
  } finally {
    tripCleanupRunning = false;
  }
}

// Only trip storage cleanup is scheduled here; other record policies retain
// their existing scheduling behavior.
function startTripStorageScheduler(pollIntervalMs = 60 * 60 * 1000) {
  const run = () => cleanupOldTrips().catch((err) => console.error('[retention] trip storage check failed:', err.message));
  run();
  const timer = setInterval(run, pollIntervalMs);
  timer.unref?.();
  return timer;
}

// In-app notifications are ephemeral by nature (the bell shows the recent
// ones) but nothing removed them, so every trip's half-dozen events and
// every admin fan-out accumulated forever. Read ones go after 30 days,
// anything after 90 - well past when anyone scrolls back for them.
async function cleanupOldNotifications() {
  const day = 24 * 60 * 60 * 1000;
  const [read, stale] = await Promise.all([
    Notification.deleteMany({ read: true, createdAt: { $lt: new Date(Date.now() - 30 * day) } }),
    Notification.deleteMany({ createdAt: { $lt: new Date(Date.now() - 90 * day) } }),
  ]);
  const removed = (read.deletedCount || 0) + (stale.deletedCount || 0);
  if (removed) console.log(`[retention] removed ${removed} old notification(s)`);
  return removed;
}

// GPS points recorded while a trip is active are kept for one week, so a
// route can still be checked if something about a recent trip is queried,
// without keeping everyone's movements indefinitely.
const TRIP_LOCATION_RETENTION_DAYS = 7;

async function cleanupOldTripLocations() {
  const cutoff = new Date(Date.now() - TRIP_LOCATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await TripLocation.deleteMany({ recordedAt: { $lt: cutoff } });
  if (result.deletedCount > 0) {
    console.log(`[retention] removed ${result.deletedCount} trip GPS point(s) older than ${TRIP_LOCATION_RETENTION_DAYS} days`);
  }
  return result.deletedCount;
}

function startRetentionScheduler(pollIntervalMs = 24 * 60 * 60 * 1000) {
  const run = () => Promise.all([cleanupOldComplaints(), cleanupOldTrips(), cleanupOldNotifications(), cleanupOldTripLocations()])
    .catch((err) => console.error('[retention] check failed:', err.message));
  run();
  return setInterval(run, pollIntervalMs);
}

module.exports = { startTripStorageScheduler, getStorageUsage, cleanupOldComplaints, cleanupOldTrips, cleanupOldNotifications, cleanupOldTripLocations, TRIP_LOCATION_RETENTION_DAYS, startRetentionScheduler };
