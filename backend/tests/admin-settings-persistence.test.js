const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';

const PlatformSettings = require('../models/PlatformSettings');
const { loadSettings, getSettings, updateSettingsConfirmed } = require('../config/platformSettings');

test('global rate is persisted and returned after saving', async () => {
  await loadSettings();
  const updated = await updateSettingsConfirmed({ globalRatePerKm: 1.03 });
  assert.equal(updated.globalRatePerKm, 1.03);
  const stored = await PlatformSettings.findOne({});
  assert.equal(stored.globalRatePerKm, 1.03);
  assert.equal(getSettings().globalRatePerKm, 1.03);
  await updateSettingsConfirmed({ globalRatePerKm: null });
  assert.equal((await PlatformSettings.findOne({})).globalRatePerKm, null);
});

test('admin setting fails loudly if database write fails', async () => {
  const original = PlatformSettings.findByIdAndUpdate;
  PlatformSettings.findByIdAndUpdate = () => Promise.reject(new Error('simulated DB failure'));
  try {
    await assert.rejects(updateSettingsConfirmed({ globalRatePerKm: 1.11 }), /simulated DB failure/);
    assert.equal(getSettings().globalRatePerKm, null);
  } finally {
    PlatformSettings.findByIdAndUpdate = original;
  }
});
