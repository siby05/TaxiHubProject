/**
 * Completed-trip earnings that survive trip deletion. Every report that
 * adds up fares (driver earnings, weekly commission, the expenses/tax
 * report, admin revenue, passenger total spent) reads them through here
 * instead of straight from Booking, so it sees live completed trips plus
 * the summaries utils/retention.js archived before deleting old ones.
 *
 * Each entry looks like a completed trip - { completedAt, actualFare,
 * tripCount } - where a live trip has tripCount 1 and an archived day can
 * stand for several. Count trips with tripCountOf(), never .length.
 */
const Booking = require('../models/Booking');
const EarningsArchive = require('../models/EarningsArchive');
const { nzDateKey } = require('./nzTime');

const round2 = (n) => Math.round(n * 100) / 100;
const tripCountOf = (entries) => entries.reduce((n, e) => n + (e.tripCount ?? 1), 0);
const faresOf = (entries) => round2(entries.reduce((s, e) => s + (e.actualFare || 0), 0));

const asEntry = (t) => ({ completedAt: t.completedAt || t.updatedAt || t.createdAt, actualFare: t.actualFare || 0, tripCount: 1 });

// driverId given: that driver's entries. Omitted: every driver's.
async function driverEarnings(driverId) {
  const filter = { status: 'completed', ...(driverId && { driverId }) };
  const [trips, archived] = await Promise.all([
    Booking.find(filter),
    EarningsArchive.find({ kind: 'driver', ...(driverId && { driverId }) }),
  ]);
  return [...trips.map(asEntry), ...archived];
}

async function passengerSpending(passengerId) {
  const [trips, archived] = await Promise.all([
    Booking.find({ passengerId, status: 'completed' }),
    EarningsArchive.find({ kind: 'passenger', passengerId }),
  ]);
  return [...trips.map(asEntry), ...archived];
}

// Folds completed trips into the archive. Called by utils/retention.js
// immediately before it deletes them - only once this has finished, so a
// failure here leaves the trips in place rather than losing their fares.
async function archiveCompletedTrips(trips) {
  const { getWeekStart } = require('./billing'); // billing requires Booking too; keep load order simple
  const byDriverDay = new Map();
  const byPassenger = new Map();
  for (const t of trips) {
    if (t.status !== 'completed') continue;
    const at = t.completedAt || t.updatedAt || t.createdAt;
    const fare = t.actualFare || 0;
    if (t.driverId) {
      const nzDate = nzDateKey(at);
      const weekStart = getWeekStart(at).toISOString();
      const key = `${t.driverId}|${nzDate}|${weekStart}`;
      const g = byDriverDay.get(key) || { driverId: String(t.driverId), nzDate, weekStart, completedAt: at, tripCount: 0, actualFare: 0 };
      g.tripCount += 1;
      g.actualFare = round2(g.actualFare + fare);
      byDriverDay.set(key, g);
    }
    if (t.passengerId) {
      const id = String(t.passengerId?._id || t.passengerId);
      const g = byPassenger.get(id) || { tripCount: 0, actualFare: 0 };
      g.tripCount += 1;
      g.actualFare = round2(g.actualFare + fare);
      byPassenger.set(id, g);
    }
  }

  for (const g of byDriverDay.values()) {
    const existing = await EarningsArchive.findOne({ kind: 'driver', driverId: g.driverId, nzDate: g.nzDate, weekStart: g.weekStart });
    if (existing) {
      await EarningsArchive.findByIdAndUpdate(existing._id, {
        tripCount: existing.tripCount + g.tripCount,
        actualFare: round2(existing.actualFare + g.actualFare),
      });
    } else {
      await EarningsArchive.create({ kind: 'driver', ...g });
    }
  }
  for (const [passengerId, g] of byPassenger) {
    const existing = await EarningsArchive.findOne({ kind: 'passenger', passengerId });
    if (existing) {
      await EarningsArchive.findByIdAndUpdate(existing._id, {
        tripCount: existing.tripCount + g.tripCount,
        actualFare: round2(existing.actualFare + g.actualFare),
      });
    } else {
      await EarningsArchive.create({ kind: 'passenger', passengerId, ...g });
    }
  }
}

module.exports = { driverEarnings, passengerSpending, archiveCompletedTrips, tripCountOf, faresOf };
