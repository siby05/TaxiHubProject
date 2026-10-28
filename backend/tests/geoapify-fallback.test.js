const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('Geoapify address search uses automatic Photon fallback on provider failure', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = 'test-only-key';
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('api.geoapify.com')) return { ok: false, status: 503 };
    if (String(url).includes('photon.komoot.io/api/')) return { ok: true, json: async () => ({ features: [{
      properties: { countrycode: 'NZ', housenumber: '45', street: 'Karamea Street', city: 'New Plymouth' },
      geometry: { coordinates: [174.07, -39.06] },
    }] }) };
    throw Error('Unexpected request ' + url);
  };
  t.after(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY; else process.env.GEOAPIFY_API_KEY = originalKey; });
  const app = express();
  app.use('/api/geocode', require('../routes/geocode'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await originalFetch('http://127.0.0.1:' + server.address().port + '/api/geocode/search?q=45%20Karamea%20Street');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.match(data[0].label, /45 Karamea Street/);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('api.geoapify.com'));
  assert.ok(urls[1].includes('photon.komoot.io'));
});
