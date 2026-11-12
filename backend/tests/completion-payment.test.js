const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'completion-workflow-test-secret-123456';
const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');

test('completion supports cash/card received, pending and already paid online', async (t) => {
  const user = await User.create({ name: 'Driver', role: 'driver', isActive: true });
  const passenger = await User.create({ name: 'Passenger', role: 'passenger' });
  const driver = await Driver.create({ userId: user._id, status: 'approved', acceptsOnlinePayment: true });
  const otherUser = await User.create({ name: 'Other', role: 'driver', isActive: true });
  await Driver.create({ userId: otherUser._id, status: 'approved' });
  const app = express();
  app.use(express.json());
  app.use('/booking', require('../routes/booking'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const put = async (id, action, body, actor = user) => {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/booking/' + id + '/' + action, {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt.sign({ id: actor._id }, process.env.JWT_SECRET) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const create = (extra = {}) => Booking.create({ driverId: driver._id, passengerId: passenger._id,
    status: 'accepted', estimatedFare: 25, paymentMethod: 'cash', paymentStatus: 'unpaid', ...extra });
  for (const [method, received] of [['cash', true], ['cash', false], ['card', true], ['card', false]]) {
    const b = await create({ paymentMethod: method });
    const result = await put(b._id, 'complete', { actualFare: 25, paymentMethod: method,
      paymentPending: !received, paidInPerson: method === 'card' && received });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, 'completed');
    assert.equal(result.body.paymentStatus, received ? 'paid' : 'unpaid');
    assert.equal(result.body.paidVia, received ? (method === 'card' ? 'card-in-person' : 'cash') : null);
    assert.equal((await put(b._id, 'complete', { actualFare: 25, paymentPending: true })).status, 400);
    if (!received) {
      const paid = await put(b._id, 'mark-paid', { method });
      assert.equal(paid.status, 200);
      assert.equal(paid.body.status, 'completed');
      assert.equal(paid.body.paymentStatus, 'paid');
    }
  }
  const online = await create({ paymentMethod: 'card', paymentStatus: 'paid', paymentIntentId: 'pi_verified',
    cardSurchargeAmount: 1, actualFare: 25 });
  const done = await put(online._id, 'complete', { actualFare: 99, paymentMethod: 'cash', paymentPending: true });
  assert.equal(done.status, 200);
  assert.equal(done.body.actualFare, 25);
  assert.equal(done.body.paymentStatus, 'paid');
  assert.equal(done.body.paymentMethod, 'card');
  assert.equal(done.body.paymentIntentId, 'pi_verified');
  assert.equal(done.body.cardSurchargeAmount, 1);

  const unpaid = await create();
  assert.equal((await put(unpaid._id, 'complete', { actualFare: 25 })).status, 400);
  assert.equal((await Booking.findById(unpaid._id)).status, 'accepted');
  assert.equal((await put(unpaid._id, 'complete', { actualFare: 25, paymentPending: true, paidInPerson: true })).status, 400);
  assert.equal((await put(unpaid._id, 'complete', { actualFare: 25, paymentPending: false }, otherUser)).status, 403);
  const cancelled = await create({ status: 'cancelled' });
  assert.equal((await put(cancelled._id, 'complete', { actualFare: 25, paymentPending: false })).status, 400);

  const race = await create();
  const responses = await Promise.all([1, 2].map(() => put(race._id, 'complete', { actualFare: 25, paymentPending: false })));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
});
