const Booking = require('../models/Booking');
const WeeklyPayment = require('../models/WeeklyPayment');
const { getSettings } = require('../config/platformSettings');

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Builds the driver's weekly commission/fee ledger:
 * - 'per-trip-percent': one row per week that had >=1 completed trip.
 * - 'weekly-flat': one row for every week since the driver was created
 *   through the current week, regardless of trip volume (it's an access
 *   fee, not a commission).
 * Cross-references recorded WeeklyPayment amounts to derive paid/overdue
 * status - a week in the past with amountPaid < amountOwed is overdue and
 * (per routes/driver.js) blocks the driver from going available again.
 */
async function getDriverBilling(driver) {
  // A per-driver feeOverride only needs to carry the fields that differ -
  // merge over the platform default so a partial override (e.g. just a
  // different commissionPercent) still gets a valid commissionType/fee.
  const settings = driver.feeOverride ? { ...getSettings(), ...driver.feeOverride } : getSettings();
  const trips = await Booking.find({ driverId: driver._id, status: 'completed' });
  const payments = await WeeklyPayment.find({ driverId: driver._id });

  const byWeek = new Map();
  for (const t of trips) {
    const key = getWeekStart(t.completedAt || t.createdAt).toISOString();
    const bucket = byWeek.get(key) || { tripsCount: 0, tripsRevenue: 0 };
    bucket.tripsCount += 1;
    bucket.tripsRevenue += t.actualFare || 0;
    byWeek.set(key, bucket);
  }

  const paidByWeek = new Map();
  for (const p of payments) {
    paidByWeek.set(p.weekStart, (paidByWeek.get(p.weekStart) || 0) + p.amountPaid);
  }

  const now = new Date();
  const currentWeekStart = getWeekStart(now).toISOString();

  let weekKeys;
  if (settings.commissionType === 'weekly-flat') {
    weekKeys = [];
    let cursor = getWeekStart(driver.createdAt);
    const stop = getWeekStart(now);
    while (cursor <= stop) {
      weekKeys.push(cursor.toISOString());
      cursor = addDays(cursor, 7);
    }
  } else {
    weekKeys = [...byWeek.keys()];
  }

  const weeks = weekKeys.map((weekStart) => {
    const bucket = byWeek.get(weekStart) || { tripsCount: 0, tripsRevenue: 0 };
    const amountOwed = settings.commissionType === 'weekly-flat'
      ? settings.weeklyFlatFee
      : Math.round(bucket.tripsRevenue * (settings.commissionPercent / 100) * 100) / 100;
    const amountPaid = Math.round((paidByWeek.get(weekStart) || 0) * 100) / 100;
    const weekEnd = addDays(new Date(weekStart), 6).toISOString();

    let status;
    if (amountPaid >= amountOwed) status = 'paid';
    else if (weekStart === currentWeekStart) status = 'current';
    else status = 'overdue';

    return {
      weekStart,
      weekEnd,
      tripsCount: bucket.tripsCount,
      tripsRevenue: Math.round(bucket.tripsRevenue * 100) / 100,
      amountOwed,
      amountPaid,
      status,
    };
  }).sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));

  const totalOwed = Math.round(weeks.reduce((s, w) => s + w.amountOwed, 0) * 100) / 100;
  const totalPaid = Math.round(weeks.reduce((s, w) => s + w.amountPaid, 0) * 100) / 100;
  const totalPending = Math.round((totalOwed - totalPaid) * 100) / 100;

  const feeLimit = driver.feeLimitOverride != null ? driver.feeLimitOverride : getSettings().outstandingFeeLimit;

  return {
    commissionType: settings.commissionType,
    weeks,
    totalOwed,
    totalPaid,
    totalPending,
    hasOverdue: weeks.some((w) => w.status === 'overdue'),
    feeLimit,
    overLimit: totalPending > feeLimit,
  };
}

module.exports = { getDriverBilling, getWeekStart, addDays };
