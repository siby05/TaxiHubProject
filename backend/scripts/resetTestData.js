/**
 * One-off maintenance script: wipes trip-related test data while leaving
 * Driver and User accounts (drivers, admins, passengers) untouched.
 *
 * Deletes: all Bookings, Complaints, Notifications, WeeklyPayments,
 * Feedback, Enquiries.
 * Resets: each Driver's rating/totalTrips/totalEarnings back to zero (the
 * driver profile itself - vehicle, status, rate, documents, etc. - is left
 * alone).
 *
 * Requires explicit confirmation so it's never run by accident:
 *   node scripts/resetTestData.js --yes
 *
 * Uses the same DB_MODE/MONGO_URI as the running app (config/database.js) -
 * point this at whichever environment you actually want cleaned by setting
 * those env vars before running it (e.g. against a deployed Atlas cluster,
 * set MONGO_URI to that cluster's connection string; DB_MODE=memory has
 * nothing to clean since that store only ever lives in a running server's
 * process memory).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const Notification = require('../models/Notification');
const TripLocation = require('../models/TripLocation');
const WeeklyPayment = require('../models/WeeklyPayment');
const Feedback = require('../models/Feedback');
const Enquiry = require('../models/Enquiry');
const Driver = require('../models/Driver');

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to run without --yes (this permanently deletes data). Re-run as: node scripts/resetTestData.js --yes');
    process.exit(1);
  }

  await connectDatabase();
  const mode = process.env.DB_MODE || 'memory';
  console.log(`[reset] DB_MODE=${mode}${mode === 'mongo' ? ` (database "${mongoose.connection.name}")` : ' - nothing persists here, this is a no-op'}`);

  const [bookings, complaints, notifications, tripLocations, weeklyPayments, feedback, enquiries] = await Promise.all([
    Booking.deleteMany({}),
    Complaint.deleteMany({}),
    Notification.deleteMany({}),
    TripLocation.deleteMany({}),
    WeeklyPayment.deleteMany({}),
    Feedback.deleteMany({}),
    Enquiry.deleteMany({}),
  ]);
  console.log(`[reset] deleted bookings=${bookings.deletedCount} complaints=${complaints.deletedCount} notifications=${notifications.deletedCount} tripLocations=${tripLocations.deletedCount} weeklyPayments=${weeklyPayments.deletedCount} feedback=${feedback.deletedCount} enquiries=${enquiries.deletedCount}`);

  const drivers = await Driver.find({});
  for (const d of drivers) {
    await Driver.findByIdAndUpdate(d._id, { rating: 0, totalTrips: 0, totalEarnings: 0 });
  }
  console.log(`[reset] reset rating/totalTrips/totalEarnings on ${drivers.length} driver(s)`);
  console.log('[reset] Driver and User (driver/admin/passenger) accounts were left untouched.');

  if (mode === 'mongo') await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});
