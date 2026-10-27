const test = require('node:test');
const assert = require('node:assert/strict');
const { createModel } = require('../lib/MemoryStore');

test('only the first driver can claim a pending broadcast booking', async () => {
  const Booking = createModel('BookingAtomicClaimTest');
  const booking = await Booking.create({ status: 'pending', driverId: null });
  const first = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending', driverId: null },
    { status: 'accepted', driverId: 'driverA' },
  );
  const second = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending', driverId: null },
    { status: 'accepted', driverId: 'driverB' },
  );
  assert.equal(first.driverId, 'driverA');
  assert.equal(second, null);
  assert.equal((await Booking.findById(booking._id)).driverId, 'driverA');
});

test('unsupported query operators do not silently match records', async () => {
  const Booking = createModel('BookingOperatorSafetyTest');
  await Booking.create({ status: 'pending' });
  await assert.rejects(Booking.find({ status: { $unexpected: 'accepted' } }), /Unsupported MemoryStore query operator/);
});
