const User = require('../models/User');
const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const { getSettings, updateSettings } = require('../config/platformSettings');
const { emailService } = require('../services/emailService');
const { toCsv } = require('./csv');

const PASSENGER_COLUMNS = [
  { header: 'ID', key: '_id' },
  { header: 'Name', key: 'name' },
  { header: 'Email', key: 'email' },
  { header: 'Mobile', key: 'mobile' },
  { header: 'Address', key: 'address' },
  { header: 'Booking blocked', key: 'bookingBlocked' },
  { header: 'Registered via QR', key: 'registeredViaQr' },
  { header: 'Created', key: 'createdAt' },
];

const BOOKING_COLUMNS = [
  { header: 'Booking ID', key: 'bookingId' },
  { header: 'Status', key: 'status' },
  { header: 'Passenger ID', key: 'passengerId' },
  { header: 'Driver ID', key: 'driverId' },
  { header: 'Pickup', key: 'pickupAddress' },
  { header: 'Drop', key: 'dropAddress' },
  { header: 'Distance (km)', key: 'distanceKm' },
  { header: 'Estimated fare', key: 'estimatedFare' },
  { header: 'Actual fare', key: 'actualFare' },
  { header: 'Payment method', key: 'paymentMethod' },
  { header: 'Payment status', key: 'paymentStatus' },
  { header: 'Rating (of driver)', key: 'rating' },
  { header: 'Requested at', key: 'requestedAt' },
  { header: 'Completed at', key: 'completedAt' },
  { header: 'Cancelled at', key: 'cancelledAt' },
  { header: 'Cancel reason', key: 'cancelReason' },
];

const COMPLAINT_COLUMNS = [
  { header: 'Complaint ID', key: 'complaintId' },
  { header: 'Type', key: 'complaintType' },
  { header: 'Severity', key: 'severity' },
  { header: 'Status', key: 'status' },
  { header: 'Serious', key: 'isSerious' },
  { header: 'Booking ID', key: 'bookingId' },
  { header: 'Driver ID', key: 'driverId' },
  { header: 'Complainant ID', key: 'complainantId' },
  { header: 'Description', key: 'description' },
  { header: 'Incident date', key: 'incidentDate' },
  { header: 'Resolution', key: 'resolutionSummary' },
  { header: 'Created', key: 'createdAt' },
];

// Builds the three CSV attachments (as plain string content - small enough
// data volumes here that streaming to disk first isn't worth the
// complexity) and the counts used in the covering email's body.
async function buildBackupAttachments() {
  const [passengers, bookings, complaints] = await Promise.all([
    User.find({ role: 'passenger' }),
    Booking.find({}),
    Complaint.find({}),
  ]);

  const dateStr = new Date().toISOString().slice(0, 10);
  return {
    counts: { passengers: passengers.length, bookings: bookings.length, complaints: complaints.length },
    attachments: [
      { filename: `passengers-${dateStr}.csv`, content: toCsv(passengers, PASSENGER_COLUMNS) },
      { filename: `trips-${dateStr}.csv`, content: toCsv(bookings, BOOKING_COLUMNS) },
      { filename: `complaints-${dateStr}.csv`, content: toCsv(complaints, COMPLAINT_COLUMNS) },
    ],
  };
}

// Runs a backup right now regardless of schedule - used by both the
// scheduler below and the admin's "Run backup now" button.
async function runBackup() {
  const settings = getSettings();
  if (!settings.adminEmail) throw new Error('No admin email set - add one on the Platform fee settings tab first.');
  const { counts, attachments } = await buildBackupAttachments();
  const result = await emailService.sendBackupEmail(settings.adminEmail, counts, attachments);
  if (!result.ok) throw new Error(`Backup email could not be sent: ${result.error}`);
  updateSettings({ lastBackupAt: new Date().toISOString() });
  return counts;
}

// Polled periodically (see startBackupScheduler) - only actually sends
// once the admin's chosen frequency has elapsed since the last successful
// backup, same tracked-timestamp idempotency as utils/reminders.js, just
// at a weekly/monthly grain instead of hourly. "Monthly" is approximated
// as 30 days rather than a real calendar month, matching this app's
// existing preference for simple estimates over exact-but-complex ones
// (see utils/driverAvailability.js's assumed driving speed).
async function checkScheduledBackup() {
  const settings = getSettings();
  if (!settings.lastBackupAt) {
    // No backup has ever actually run - establish a baseline instead of
    // sending immediately. Without this, lastBackupAt starting null would
    // mean every server restart (in memory mode, that's every restart,
    // since nothing persists) fires an email; a real elapsed interval
    // should be what triggers it, not a redeploy. "Run backup now" on the
    // admin settings tab is there for whenever an actual first backup is
    // wanted right away.
    updateSettings({ lastBackupAt: new Date().toISOString() });
    return;
  }
  const intervalMs = (settings.backupFrequency === 'monthly' ? 30 : 7) * 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(settings.lastBackupAt).getTime() < intervalMs) return;
  await runBackup();
}

function startBackupScheduler(pollIntervalMs = 60 * 60 * 1000) {
  checkScheduledBackup().catch((err) => console.error('[backup] initial check failed:', err.message));
  return setInterval(() => {
    checkScheduledBackup().catch((err) => console.error('[backup] check failed:', err.message));
  }, pollIntervalMs);
}

module.exports = { runBackup, startBackupScheduler };
