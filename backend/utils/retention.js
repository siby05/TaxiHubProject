const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const { getSettings } = require('../config/platformSettings');

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

// Optional, admin-configured (platformSettings.tripRetentionDays - null/0
// means disabled) housekeeping for trip records, for once database space
// needs managing. Unlike complaints there's no compliance floor on how
// long a finished booking has to be kept, so this is opt-in. Only ever
// touches finished trips (completed/cancelled - a pending/accepted/
// in-progress trip is never a cleanup candidate), and skips any trip a
// complaint still references, so a complaint can't outlive the trip
// evidence it's about within the complaint's own much longer 2-year window.
async function cleanupOldTrips() {
  const { tripRetentionDays } = getSettings();
  if (!tripRetentionDays) return 0;

  const cutoff = new Date(Date.now() - tripRetentionDays * 24 * 60 * 60 * 1000);
  const finished = await Booking.find({ status: { $in: ['completed', 'cancelled'] } });
  const old = finished.filter((b) => new Date(b.completedAt || b.cancelledAt || b.createdAt) < cutoff);
  if (old.length === 0) return 0;

  const complaints = await Complaint.find({});
  const referencedIds = new Set(complaints.map((c) => String(c.bookingId?._id || c.bookingId)));
  const deletableIds = old.filter((b) => !referencedIds.has(String(b._id))).map((b) => b._id);
  if (deletableIds.length === 0) return 0;

  const result = await Booking.deleteMany({ _id: { $in: deletableIds } });
  console.log(`[retention] removed ${result.deletedCount} trip record(s) past the ${tripRetentionDays}-day retention window`);
  return result.deletedCount;
}

function startRetentionScheduler(pollIntervalMs = 24 * 60 * 60 * 1000) {
  const run = () => Promise.all([cleanupOldComplaints(), cleanupOldTrips()])
    .catch((err) => console.error('[retention] check failed:', err.message));
  run();
  return setInterval(run, pollIntervalMs);
}

module.exports = { cleanupOldComplaints, cleanupOldTrips, startRetentionScheduler };
