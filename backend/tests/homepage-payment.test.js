const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';
const { calculateCardSurcharge } = require('../utils/stripeFees');

test('homepage quote returns cash fare or card service fee and total', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/booking', require('../routes/booking'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const coords = { pickupLat: -39.057, pickupLng: 174.076, dropLat: -39.066, dropLng: 174.087 };
  const quote = async (extra = {}) => {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/booking/homepage-quote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...coords, ...extra }),
    });
    return { status: res.status, body: await res.json() };
  };
  for (const extra of [{}, { paymentMethod: 'cash' }]) {
    const r = await quote(extra);
    assert.equal(r.status, 200);
    assert.equal(r.body.cardSurchargeAmount, 0);
    assert.equal(r.body.total, r.body.estimatedFare);
  }
  const card = await quote({ paymentMethod: 'card' });
  assert.equal(card.status, 200);
  assert.ok(card.body.estimatedFare > 0);
  assert.equal(card.body.cardSurchargeAmount, calculateCardSurcharge(card.body.estimatedFare));
  assert.equal(card.body.total, Math.round((card.body.estimatedFare + card.body.cardSurchargeAmount) * 100) / 100);
  assert.equal((await quote({ paymentMethod: 'invalid' })).status, 400);
});
