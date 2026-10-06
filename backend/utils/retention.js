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
    const usedMb = Math.round((((stats.dataSize || 0) + (stats.indexSize || 0)) / (1024 * 1024)) * 10) / 10;
    const limitMb = Number(getSettings().dbStorageLimitMb) || 512;
    return { usedMb, limitMb, percent: Math.round((usedMb / limitMb) * 1000) / 10 };
  } catch (err) {
    console.error('[retention] could not read database size:', err.message);
    return null;
  }
}

// Optional, admin-configured housekeeping for trip records - only for
// when database space actually runs short. Both conditions are needed:
// tripRetentionDays set (null/0 = never delete; how old a finished trip
// must be before it may go) AND the database at or over dbCleanupAtPercent
// of dbStorageLimitMb. Below that, every trip is kept, however old.
//
// Only ever touches finished trips: cancelled ones, and completed ones
// that are paid (a cash trip still marked payment-pending is money owed,
// so it stays). Skips any trip a complaint still references, so a
// complaint can't outlive the trip evidence it's about. Completed trips'
// fares are folded into the earnings archive first (utils/earnings.js) -
// driver earnings, weekly commission, tax reports and admin revenue all
// keep their totals after the trip rows are gone.
async function cleanupOldTrips() {
  const { tripRetentionDays, dbCleanupAtPercent } = getSettings();
  if (!tripRetentionDays) return 0;

  const usage = await getStorageUsage();
  if (!usage || usage.percent < (Number(dbCleanupAtPercent) || 80)) return 0;

  const cutoff = new Date(Date.now() - tripRetentionDays * 24 * 60 * 60 * 1000);
  const finished = await Booking.find({ status: { $in: ['completed', 'cancelled'] } });
  const old = finished.filter((b) => new Date(b.completedAt || b.cancelledAt || b.createdAt) < cutoff
    && (b.status === 'cancelled' || b.paymentStatus === 'paid'));
  if (old.length === 0) return 0;

  const complaints = await Complaint.find({});
  const referencedIds = new Set(complaints.map((c) => String(c.bookingId?._id || c.bookingId)));
  const deletable = old.filter((b) => !referencedIds.has(String(b._id)));
  if (deletable.length === 0) return 0;

  // Archive first - if this throws, nothing is deleted.
  await archiveCompletedTrips(deletable);
  const result = await Booking.deleteMany({ _id: { $in: deletable.map((b) => b._id) } });
  console.log(`[retention] database at ${usage.percent}% of ${usage.limitMb} MB - removed ${result.deletedCount} trip record(s) older than ${tripRetentionDays} days (earnings kept in the archive)`);
  return result.deletedCount;
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

module.exports = { getStorageUsage, cleanupOldComplaints, cleanupOldTrips, cleanupOldNotifications, cleanupOldTripLocations, TRIP_LOCATION_RETENTION_DAYS, startRetentionScheduler };
