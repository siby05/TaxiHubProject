/**
 * Global, admin-configurable commission policy. A true singleton (not a
 * Model/collection) since there's only ever one active policy.
 *
 * commissionType 'per-trip-percent': driver owes admin a % of each
 *   completed trip's fare, tallied weekly.
 * commissionType 'weekly-flat': driver owes a fixed fee every week to keep
 *   platform access, independent of trip volume.
 */
let settings = {
  commissionType: 'per-trip-percent',
  commissionPercent: 15,
  weeklyFlatFee: 50,
};

function getSettings() {
  return { ...settings };
}

function updateSettings(patch) {
  if (patch.commissionType && !['per-trip-percent', 'weekly-flat'].includes(patch.commissionType)) {
    throw new Error('commissionType must be "per-trip-percent" or "weekly-flat"');
  }
  settings = { ...settings, ...patch };
  return { ...settings };
}

module.exports = { getSettings, updateSettings };
