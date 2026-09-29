const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const Expense = require('../models/Expense');
const { getSettings, updateSettings } = require('../config/platformSettings');
const { emailService } = require('../services/emailService');
const { toCsv } = require('./csv');
const { notifyAdmins } = require('./notify');

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

// Drivers: contact, vehicle, licensing and status - no password, no
// uploaded document files (only their review status), no Stripe ids.
const docStatus = (key) => (d) => d.documents?.[key]?.status || '';
const DRIVER_COLUMNS = [
  { header: 'Driver ID', key: '_id' },
  { header: 'Name', key: 'userId.name' },
  { header: 'Email', key: 'userId.email' },
  { header: 'Mobile', key: 'userId.mobile' },
  { header: 'Status', key: 'status' },
  { header: 'Online now', key: 'isAvailable' },
  { header: 'Service category', key: 'serviceCategory' },
  { header: 'Vehicle type', key: 'vehicleType' },
  { header: 'Vehicle', key: (d) => [d.vehicleBrand, d.vehicleModel].filter(Boolean).join(' ') },
  { header: 'Plate', key: 'vehicleNumber' },
  { header: 'Rate per km', key: 'ratePerKm' },
  { header: 'Accepts online payment', key: (d) => d.acceptsOnlinePayment !== false },
  { header: 'Licence number', key: 'licenseNumber' },
  { header: 'TSL number', key: 'tslNumber' },
  { header: 'Passenger endorsement', key: 'passengerEndorsementNumber' },
  { header: 'Endorsement expiry', key: 'passengerEndorsementExpiry' },
  { header: 'CoF expiry', key: 'vehicleCofExpiry' },
  { header: 'Licence doc', key: docStatus('license') },
  { header: 'TSL doc', key: docStatus('tsl') },
  { header: 'CoF doc', key: docStatus('cof') },
  { header: 'Rego doc', key: docStatus('rego') },
  { header: 'Rating', key: 'rating' },
  { header: 'Total trips', key: 'totalTrips' },
  { header: 'Joined', key: 'createdAt' },
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

const EXPENSE_COLUMNS = [
  { header: 'Expense ID', key: '_id' },
  { header: 'Driver ID', key: 'driverId' },
  { header: 'Date', key: 'date' },
  { header: 'Category', key: 'category' },
  { header: 'Amount', key: 'amount' },
  { header: 'Includes GST', key: 'gstIncluded' },
  { header: 'Supplier', key: 'supplier' },
  { header: 'Reference', key: 'reference' },
  { header: 'Notes', key: 'notes' },
  { header: 'Created', key: 'createdAt' },
];

// Builds the CSV attachments (as plain string content - small enough
// data volumes here that streaming to disk first isn't worth the
// complexity) and the counts used in the covering email's body.
async function buildBackupAttachments() {
  const [passengers, drivers, bookings, complaints, expenses] = await Promise.all([
    User.find({ role: 'passenger' }),
    Driver.find({}).populate('userId', 'name email mobile'),
    Booking.find({}),
    Complaint.find({}),
    Expense.find({}),
  ]);

  const dateStr = new Date().toISOString().slice(0, 10);
  return {
    counts: { passengers: passengers.length, drivers: drivers.length, bookings: bookings.length, complaints: complaints.length, expenses: expenses.length },
    attachments: [
      { filename: `passengers-${dateStr}.csv`, content: toCsv(passengers, PASSENGER_COLUMNS) },
      { filename: `drivers-${dateStr}.csv`, content: toCsv(drivers, DRIVER_COLUMNS) },
      { filename: `trips-${dateStr}.csv`, content: toCsv(bookings, BOOKING_COLUMNS) },
      { filename: `complaints-${dateStr}.csv`, content: toCsv(complaints, COMPLAINT_COLUMNS) },
      { filename: `driver-expenses-${dateStr}.csv`, content: toCsv(expenses, EXPENSE_COLUMNS) },
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
  updateSettings({ lastBackupAt: new Date().toISOString(), lastBackupError: null });
  return counts;
}

// Polled hourly (see startBackupScheduler) and also triggered by the daily
// GitHub Actions wake-up call (routes/cron.js) - only actually sends once
// the admin's chosen frequency has elapsed since the last backup. "Monthly"
// is approximated as 30 days.
//
// lastBackupAt only ever records a backup that was really sent (it's what
// the admin screen shows as "Last backup"). The very first check instead
// records backupScheduleStartedAt as the starting point, so a fresh
// deploy/restart doesn't fire an email straight away - "Run backup now" is
// there for an immediate first backup.
async function checkScheduledBackup() {
  const settings = getSettings();
  const since = settings.lastBackupAt || settings.backupScheduleStartedAt;
  if (!since) {
    updateSettings({ backupScheduleStartedAt: new Date().toISOString() });
    return { sent: false, reason: 'schedule started' };
  }
  const intervalMs = (settings.backupFrequency === 'monthly' ? 30 : 7) * 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(since).getTime() < intervalMs) return { sent: false, reason: 'not due yet' };

  try {
    const counts = await runBackup();
    return { sent: true, counts };
  } catch (err) {
    // Retried on every later check. The admin is told once per run of
    // failures (not every hour), and the error shows on the admin screen.
    const alreadyFailing = !!settings.lastBackupError;
    updateSettings({ lastBackupError: { at: new Date().toISOString(), message: err.message } });
    if (!alreadyFailing) {
      notifyAdmins({
        type: 'backup-failed',
        title: 'Scheduled data backup failed',
        message: `The weekly backup email could not be sent: ${err.message}. It will retry automatically - check the admin email and email settings.`,
        link: '/admin',
      }).catch(() => {});
    }
    throw err;
  }
}

function startBackupScheduler(pollIntervalMs = 60 * 60 * 1000) {
  checkScheduledBackup().catch((err) => console.error('[backup] initial check failed:', err.message));
  return setInterval(() => {
    checkScheduledBackup().catch((err) => console.error('[backup] check failed:', err.message));
  }, pollIntervalMs);
}

module.exports = { runBackup, startBackupScheduler, checkScheduledBackup };
