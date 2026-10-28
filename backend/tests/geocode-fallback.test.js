const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('reverse GPS lookup falls back to Photon when Nominatim is unavailable', async (t) => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('nominatim.openstreetmap.org')) throw new Error('simulated Nominatim timeout');
    if (String(url).includes('photon.komoot.io/reverse')) return {
      ok: true,
      json: async () => ({ features: [{
        properties: { street: 'Karamea Street', housenumber: '45', city: 'New Plymouth', countrycode: 'NZ' },
        geometry: { coordinates: [174.071, -39.067] },
      }] }),
    };
    throw new Error('Unexpected request: ' + url);
  };
  t.after(() => { global.fetch = original; });
  const app = express();
  app.use('/api/geocode', require('../routes/geocode'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  // Save native fetch reference: the mocked one is deliberately used by the router only.
  const response = await original('http://127.0.0.1:' + server.address().port
    + '/api/geocode/reverse?lat=-39.067&lng=174.071');
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.match(data.label, /45 Karamea Street/);
  assert.equal(data.lat, -39.067);
  assert.equal(data.lng, 174.071);
  assert.equal(calls.length, 2);
});

test('reverse GPS lookup refuses coordinates outside New Zealand', async (t) => {
  const app = express();
  app.use('/api/geocode', require('../routes/geocode'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch('http://127.0.0.1:' + server.address().port
    + '/api/geocode/reverse?lat=40.7&lng=-73.9');
  assert.equal(response.status, 400);
});
