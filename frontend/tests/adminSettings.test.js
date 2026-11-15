import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_SETTINGS_SECTIONS, adminSettingsPatch } from '../src/utils/adminSettings.js';

test('saving GST cannot submit pricing or account edits', () => {
  const settings = { receiptGstEnabled: false, receiptGstRatePercent: 15, gstNumber: '123456789',
    minimumFare: 99, adminEmail: 'changed@example.invalid', tempPasswordVisible: false };
  assert.deepEqual(adminSettingsPatch(settings, 'gst'), {
    receiptGstEnabled: false, receiptGstRatePercent: 15, gstNumber: '123456789',
  });
});

test('pricing zero/null values remain explicit, unrelated fields are excluded', () => {
  assert.deepEqual(adminSettingsPatch({ minimumFare: 0, globalRatePerKm: null, fareRanges: [], gstNumber: '123456789' }, 'pricing'),
    { minimumFare: 0, globalRatePerKm: null, fareRanges: [] });
  assert.deepEqual(adminSettingsPatch({ routeDiscounts: [{ direction: 'np-akl', percent: 10 }], commissionPercent: 20 }, 'discounts'),
    { routeDiscounts: [{ direction: 'np-akl', percent: 10 }] });
  assert.throws(() => adminSettingsPatch({}, 'unknown'), /Unknown settings section/);
});

test('settings categories never include login passwords and have unambiguous fields', () => {
  const fields = ADMIN_SETTINGS_SECTIONS.flatMap(s => s.fields);
  assert.equal(new Set(fields).size, fields.length);
  assert.ok(!fields.includes('password'));
  assert.ok(!fields.includes('currentPassword'));
});
