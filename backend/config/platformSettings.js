/**
 * Global, admin-configurable commission policy and platform toggles.
 *
 * commissionType 'per-trip-percent': driver owes admin a % of each
 *   completed trip's fare, tallied weekly.
 * commissionType 'weekly-flat': driver owes a fixed fee every week to keep
 *   platform access, independent of trip volume.
 *
 * getSettings()/updateSettings() stay fully synchronous - every existing
 * caller across the app (dozens of them) reads this without awaiting, so
 * changing that contract would mean touching all of them. Instead this
 * module keeps an in-memory cache (`settings`, exactly as before) that's
 * hydrated once from the PlatformSettings singleton document at startup
 * (see loadSettings(), called from server.js before the server starts
 * accepting requests) and re-persisted, fire-and-forget, on every update -
 * so a real (Mongo) database survives restarts/redeploys instead of
 * silently resetting every admin-configured setting back to these
 * defaults each time, while memory mode keeps its existing "resets on
 * restart" behaviour (there's nothing to load - loadSettings() just
 * creates the one doc fresh, same as any other memory-mode collection).
 */
const PlatformSettings = require('../models/PlatformSettings');

let settings = {
  commissionType: 'per-trip-percent',
  commissionPercent: 15,
  weeklyFlatFee: 50,
  // Default outstanding-fee ceiling before a driver is blocked from going
  // online (per-driver override lives on Driver.feeLimitOverride).
  outstandingFeeLimit: 50,
  // Approx. payment-gateway (Stripe) processing cost, disclosed to the
  // passenger and added on top of the fare for card payments only - cash
  // is unaffected. See utils/distance.js calculateCardSurcharge().
  cardSurchargePercent: 2.6,
  // Fare floor: no trip is ever quoted below this, regardless of distance.
  minimumFare: 8,
  // Optional flat prices for distance bands, e.g. "any trip up to 5km is
  // $12 flat" - an alternative floor alongside minimumFare, for markets
  // where a short trip should cost more than base-fare-plus-per-km would
  // give. Array of {maxKm, price}, checked in ascending maxKm order; a
  // trip longer than every band's maxKm isn't matched by this at all (only
  // the per-km and minimumFare floors apply). See
  // utils/distance.js calculateTripFare() - the actual fare quoted is
  // whichever of (distance x rate + base fare), minimumFare, and the
  // matching range price is highest.
  fareRanges: [],
  // Whether "Drive with us" / driver self-signup is open right now - an
  // admin can close it (e.g. the driver roster is full, or applications
  // need to pause) without touching code. Hidden from the public nav and
  // blocked server-side (see routes/driverSignup.js) when false, so it
  // can't be reached by a stale bookmark either.
  driverSignupEnabled: true,
  // Whether passengers get a vehicle-type selector on the booking form - an
  // admin can turn this off (e.g. only one vehicle class actually operates
  // right now) so every booking just broadcasts to any available driver
  // instead. Mirrors driverSignupEnabled's on/off pattern. See
  // routes/booking.js GET /vehicle-selection-enabled (public, same reasoning
  // as /api/driver-signup/enabled - the booking form needs this before/without
  // an admin session).
  vehicleSelectionEnabled: true,
  // Whether the one-time temporary password is shown on screen right after
  // an admin creates a driver (see routes/admin.js POST /drivers and
  // AdminDashboard.jsx's createdInfo card). Some admins share a screen or
  // want it off entirely and rely on another channel - this is a toggle
  // instead of a code change so that preference never needs a redeploy.
  tempPasswordVisible: true,
  // Real inbox for admin-facing email: serious-complaint/escalation alerts
  // (see services/emailService.js) and the scheduled data backup below -
  // replaces the admin@easyride.local seed login, which is just a login
  // identity, not a real mailbox anyone reads.
  adminEmail: 'easyridenz@gmail.com',
  // Optional WhatsApp-reachable number for the "Contact admin" links shown
  // to a passenger when no driver is available (see GET
  // /api/booking/admin-contact, a public route since that error screen is
  // shown before/without login on the QR-scan guest flow too). Null until
  // an admin sets one - those links just don't render without it.
  adminMobile: null,
  // How often utils/backup.js emails the admin a CSV export of passengers,
  // trips and complaints. lastBackupAt (ISO string, null until the first
  // run) is how the scheduler knows one is actually due - same
  // tracked-timestamp idempotency utils/reminders.js already uses, just at
  // a much coarser grain.
  backupFrequency: 'weekly',
  lastBackupAt: null,
};

let settingsDocId = null;

// Called once at startup (see server.js), before the server accepts any
// requests. Merges the stored doc *over* the defaults above rather than
// replacing them outright, so a setting added in a later release (like
// adminMobile) still gets a sensible default for an existing deployment
// that was already persisted before that field existed.
async function loadSettings() {
  const existing = await PlatformSettings.findOne({});
  if (existing) {
    const { _id, createdAt, updatedAt, ...stored } = existing;
    settingsDocId = _id;
    settings = { ...settings, ...stored };
  } else {
    const created = await PlatformSettings.create({ ...settings });
    settingsDocId = created._id;
  }
}

function getSettings() {
  return { ...settings };
}

function updateSettings(patch) {
  if (patch.commissionType && !['per-trip-percent', 'weekly-flat'].includes(patch.commissionType)) {
    throw new Error('commissionType must be "per-trip-percent" or "weekly-flat"');
  }
  if (patch.backupFrequency && !['weekly', 'monthly'].includes(patch.backupFrequency)) {
    throw new Error('backupFrequency must be "weekly" or "monthly"');
  }
  if (patch.fareRanges) {
    if (!Array.isArray(patch.fareRanges) || patch.fareRanges.some((r) => typeof r.maxKm !== 'number' || typeof r.price !== 'number' || r.maxKm <= 0 || r.price < 0)) {
      throw new Error('fareRanges must be an array of {maxKm, price} with maxKm > 0 and price >= 0');
    }
    patch = { ...patch, fareRanges: [...patch.fareRanges].sort((a, b) => a.maxKm - b.maxKm) };
  }
  settings = { ...settings, ...patch };
  // Fire-and-forget: callers of updateSettings() expect a synchronous
  // return (every route in the app relies on that), so persistence
  // happens in the background - a transient DB hiccup here must never
  // block or fail the settings change the admin is actively making, it
  // just means this particular change won't survive the next restart.
  if (settingsDocId) {
    PlatformSettings.findByIdAndUpdate(settingsDocId, patch).catch((err) => {
      console.error('[platformSettings] failed to persist update:', err.message);
    });
  }
  return { ...settings };
}

module.exports = { getSettings, updateSettings, loadSettings };
