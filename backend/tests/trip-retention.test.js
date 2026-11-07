const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_MODE = 'memory';
const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const EarningsArchive = require('../models/EarningsArchive');
const { cleanupOldTrips } = require('../utils/retention');
const { driverEarnings, passengerSpending, faresOf, tripCountOf } = require('../utils/earnings');
const full = async () => ({ usedMb: 512, limitMb: 512 });

test('retain history below capacity; remove only oldest eligible trip at capacity', async () => {
  await Booking.deleteMany({});
  await Complaint.deleteMany({});
  await EarningsArchive.deleteMany({});
  const trip = (status, at, extra = {}) => Booking.create({
    status, paymentStatus: 'paid', createdAt: new Date(at),
    completedAt: status === 'completed' ? new Date(at) : undefined,
    actualFare: 25, driverId: 'driver-a', passengerId: 'passenger-a', ...extra,
  });
  const active = await trip('accepted', '2020-01-01');
  const unpaid = await trip('completed', '2020-01-02', { paymentStatus: 'unpaid' });
  const disputed = await trip('completed', '2020-01-03');
  await Complaint.create({ bookingId: disputed._id });
  const oldest = await trip('completed', '2020-01-04');
  const newer = await trip('completed', '2024-01-01');
  for (const usage of [null, { usedMb: 511.99, limitMb: 512 }, { usedMb: NaN, limitMb: 512 }]) {
    assert.equal(await cleanupOldTrips({ readUsage: async () => usage }), 0);
    assert.ok(await Booking.findById(oldest._id));
  }
  const earnings = faresOf(await driverEarnings('driver-a'));
  const spending = faresOf(await passengerSpending('passenger-a'));
  const count = tripCountOf(await driverEarnings('driver-a'));
  assert.equal(await cleanupOldTrips({ readUsage: full }), 1);
  assert.equal(await Booking.findById(oldest._id), null);
  for (const b of [active, unpaid, disputed, newer]) assert.ok(await Booking.findById(b._id));
  assert.equal(faresOf(await driverEarnings('driver-a')), earnings);
  assert.equal(faresOf(await passengerSpending('passenger-a')), spending);
  assert.equal(tripCountOf(await driverEarnings('driver-a')), count);
  assert.equal(await cleanupOldTrips({ readUsage: async () => ({ usedMb: 500, limitMb: 512 }) }), 0);
});

test('archive failure preserves the trip and releases cleanup lock', async () => {
  await Booking.deleteMany({});
  await Complaint.deleteMany({});
  await EarningsArchive.deleteMany({});
  const booking = await Booking.create({ status: 'completed', paymentStatus: 'paid',
    completedAt: new Date('2020-01-01'), actualFare: 10, driverId: 'driver-a' });
  const original = EarningsArchive.create;
  EarningsArchive.create = async () => { throw new Error('storage full'); };
  try {
    await assert.rejects(cleanupOldTrips({ readUsage: full }), /storage full/);
    assert.ok(await Booking.findById(booking._id));
  } finally { EarningsArchive.create = original; }
  assert.equal(await cleanupOldTrips({ readUsage: full }), 1);
});

test('concurrent cleanup checks do not delete multiple trips', async () => {
  await Booking.deleteMany({});
  await Complaint.deleteMany({});
  let resolveUsage;
  const pending = cleanupOldTrips({ readUsage: () => new Promise((resolve) => { resolveUsage = resolve; }) });
  assert.equal(await cleanupOldTrips({ readUsage: full }), 0);
  resolveUsage(null);
  assert.equal(await pending, 0);
});
