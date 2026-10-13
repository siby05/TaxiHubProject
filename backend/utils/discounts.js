/**
 * The two admin-configured discounts (see config/platformSettings.js):
 *
 * promoDiscount - percent off any trip dated inside the admin's date
 *   range. Fixed onto the booking when it's created/edited.
 *
 * returnTripDiscount - percent off both legs when one driver has a New
 *   Plymouth -> Auckland trip and an Auckland -> New Plymouth trip on the
 *   same NZ day - or the same with Palmerston North (see DESTINATIONS).
 *   Both legs must be to/from the same city. Depends on the driver's other bookings, so it's
 *   re-checked (reconcileReturnTripDiscounts) whenever a trip gains or
 *   loses a driver, moves date, or is cancelled - and an already-booked
 *   passenger whose fare changes because of it is told straight away.
 *
 * A trip gets whichever discount is bigger, never both. Bookings keep the
 * undiscounted price in fareBeforeDiscount so the fare can be recomputed
 * as discounts come and go; estimatedFare is always what's charged.
 */
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { getSettings } = require('../config/platformSettings');
const { haversineKm, calculateCardSurcharge } = require('./distance');
const { nzDateKey, formatNzDate } = require('./nzTime');
const { notifyUser } = require('./notify');
const { runInBackground } = require('./background');

// Centre + radius rather than matching address text - typed and
// geocoded addresses vary too much ("Auckland Airport", "Māngere", a
// suburb). Auckland's radius takes in the airport and outer suburbs;
// Palmerston North's takes in its airport, Massey and Feilding.
const NEW_PLYMOUTH = { lat: -39.0556, lng: 174.0752, radiusKm: 25 };
// Cities the return-trip discount covers, keyed by the short code used
// in direction keys ('np-akl', 'akl-np', ...).
const DESTINATIONS = {
  akl: { name: 'Auckland', lat: -36.8485, lng: 174.7633, radiusKm: 45 },
  pmr: { name: 'Palmerston North', lat: -40.3523, lng: 175.6082, radiusKm: 20 },
};

// Trips still able to change price. A completed trip's fare is final, and
// an already-paid one was charged that amount.
const ADJUSTABLE = ['pending', 'accepted', 'in-progress'];

const round2 = (n) => Math.round(n * 100) / 100;

function within(city, lat, lng) {
  return lat != null && lng != null && haversineKm(city.lat, city.lng, lat, lng) <= city.radiusKm;
}

// { city: 'akl' | 'pmr', leg: 'out' (from New Plymouth) | 'back' (to it) }, or null.
function tripDirection(b) {
  for (const [city, c] of Object.entries(DESTINATIONS)) {
    if (within(NEW_PLYMOUTH, b.pickupLat, b.pickupLng) && within(c, b.dropLat, b.dropLng)) return { city, leg: 'out' };
    if (within(c, b.pickupLat, b.pickupLng) && within(NEW_PLYMOUTH, b.dropLat, b.dropLng)) return { city, leg: 'back' };
  }
  return null;
}

// 'np-akl', 'akl-np', 'np-pmr', 'pmr-np' - labelled on the home page.
const directionKey = (city, leg) => (leg === 'out' ? `np-${city}` : `${city}-np`);

function tripDateKey(b) {
  return nzDateKey(b.scheduledFor || b.requestedAt || b.createdAt || new Date());
}

// The promotion's percent for a trip on `when`, or 0.
function promoPercentFor(when, settings = getSettings()) {
  const p = settings.promoDiscount;
  if (!p?.enabled || !p.startDate || !p.endDate) return 0;
  const day = nzDateKey(when || new Date());
  return day >= p.startDate && day <= p.endDate ? p.percent : 0;
}

// Fare fields for a booking at a given undiscounted price - spread
// straight into Booking.create()/findByIdAndUpdate(), or a quote.
function discountedFare(baseFare, promoPercent = 0, returnTripPercent = 0) {
  const discountPercent = Math.max(promoPercent || 0, returnTripPercent || 0);
  const estimatedFare = round2(baseFare * (1 - discountPercent / 100));
  return {
    fareBeforeDiscount: round2(baseFare),
    promoDiscountPercent: promoPercent || 0,
    returnTripDiscountPercent: returnTripPercent || 0,
    discountPercent,
    discountAmount: round2(baseFare - estimatedFare),
    estimatedFare,
  };
}

// Price for a new/edited trip: the promotion only. The return-trip
// discount is applied afterwards by reconcileReturnTripDiscounts(), once
// the trip is saved with its driver.
function priceWithPromo(baseFare, when) {
  return discountedFare(baseFare, promoPercentFor(when), 0);
}

const baseFareOf = (b) => b.fareBeforeDiscount ?? b.estimatedFare;

function emitTo(io, userId, event, payload) {
  if (io && userId) io.to(String(userId)).emit(event, payload);
}

// Why a trip's return-trip discount changed - picks the wording the
// passenger sees (in-app and by email).
//   'applied'      - a same-day return trip now pairs with theirs
//   'pair-ended'   - the trip it was paired with was cancelled (or moved
//                    to another day/driver), so it's back to standard fare
//   'unpaired'     - their own trip lost its driver, so it can't pair
//   'setting'      - the admin turned the discount off or changed its %
function fareChangeWording(kind, b, oldFare, oldPercent, newPercent) {
  const trip = `${b.bookingId} (${b.pickupAddress} → ${b.dropAddress}, ${formatNzDate(b.scheduledFor || b.requestedAt)})`;
  const was = `$${oldFare.toFixed(2)}`;
  const now = `$${b.estimatedFare.toFixed(2)}`;
  switch (kind) {
    case 'applied':
      return {
        title: `Good news - ${newPercent}% off your trip`,
        subject: `${newPercent}% return-trip discount on ${b.bookingId} - your fare is now ${now}`,
        message: `Your driver has a same-day return trip, so a ${newPercent}% return-trip discount now applies to ${trip}. Your fare is now ${now} (was ${was}).`,
      };
    case 'pair-ended':
      return {
        title: 'Return trip cancelled - fare back to standard',
        subject: `Return trip cancelled - ${b.bookingId} is back to the standard fare of ${now}`,
        message: `The same-day return trip paired with ${trip} has been cancelled or changed, so the ${oldPercent}% return-trip discount no longer applies. Your fare is back to the standard ${now} (was ${was}). Your booking itself is unchanged.`,
      };
    case 'unpaired':
      return {
        title: 'Return-trip discount removed',
        subject: `${b.bookingId} is back to the standard fare of ${now}`,
        message: `${trip} is no longer paired with a same-day return trip, so the ${oldPercent}% return-trip discount no longer applies. Your fare is now ${now} (was ${was}).`,
      };
    default:
      return {
        title: 'Your fare has changed',
        subject: `Fare update for ${b.bookingId} - now ${now}`,
        message: newPercent
          ? `The return-trip discount is now ${newPercent}%, so your fare for ${trip} is now ${now} (was ${was}).`
          : `The return-trip discount has ended, so ${trip} is back to the standard fare of ${now} (was ${was}).`,
      };
  }
}

function tellPassengerOfNewFare(io, booking, oldFare, wording) {
  notifyUser(booking.passengerId, {
    type: 'fare-changed',
    title: wording.title,
    message: wording.message,
    link: '/passenger',
  });
  emitTo(io, booking.passengerId, 'booking:updated', { bookingId: booking._id });
  runInBackground('email sendFareChanged', async () => {
    // Required lazily: emailService pulls in a lot, and this module is
    // loaded by routes that emailService's own helpers don't need.
    const { emailService } = require('../services/emailService');
    const passenger = await User.findById(booking.passengerId);
    if (!passenger) return;
    const result = await emailService.sendFareChanged(passenger.email, wording.subject, wording.message);
    if (!result?.ok) console.warn(`[discounts] fare-change email for ${booking.bookingId} not sent: ${result?.error || 'unknown error'}`);
  });
}

// Highway average for the intercity runs, applied to the straight-line
// distance: NP <-> Auckland ~255 km -> ~4.6 h (real drive 4.5-5 h),
// NP <-> Palmerston North ~195 km -> ~3.5 h (real drive about 3.5 h).
// utils/driverAvailability.js's 35 km/h is a town-driving figure and would
// make every Auckland trip look 7+ hours long.
const INTERCITY_KMH = 55;
const HOUR = 3600e3;

const startMs = (b) => new Date(b.scheduledFor || b.startedAt || b.requestedAt || b.createdAt).getTime();
const driveMs = (b) => ((b.distanceKm || haversineKm(b.pickupLat, b.pickupLng, b.dropLat, b.dropLng)) / INTERCITY_KMH) * HOUR;
function endMs(b) {
  if (b.completedAt) return new Date(b.completedAt).getTime();
  return (b.startedAt ? new Date(b.startedAt).getTime() : startMs(b)) + driveMs(b);
}
const gapMs = (rt) => (rt?.minGapHours ?? 1) * HOUR;

// The driver is based in New Plymouth, so a pair is NP -> city first,
// then the same city -> NP picking up at least minGapHours after the first
// trip finishes (completedAt once done, else its estimated arrival).
// Returns the ids of every trip that is part of at least one such pair.
function pairedTripIds(trips, rt) {
  const outs = trips.filter((t) => t.dir.leg === 'out');
  const ins = trips.filter((t) => t.dir.leg === 'back');
  const ids = new Set();
  for (const { b: o, dir: od } of outs) {
    for (const { b: i, dir: id } of ins) {
      if (od.city === id.city && startMs(i) >= endMs(o) + gapMs(rt)) {
        ids.add(String(o._id));
        ids.add(String(i._id));
      }
    }
  }
  return ids;
}

// Re-checks every trip of one driver on one NZ day: trips that form a
// valid pair (see pairedTripIds) get the return-trip discount, the rest
// don't. Any adjustable, unpaid trip whose price changes is updated and its
// passenger notified. Completed trips still count towards making a pair
// (the driver did drive that leg) but their fare is never touched.
async function reconcileReturnTripDiscounts(io, driverId, dateKey) {
  if (!driverId || !dateKey) return;
  const settings = getSettings();
  const rt = settings.returnTripDiscount;

  const trips = (await Booking.find({ driverId }))
    .filter((b) => b.status !== 'cancelled' && b.status !== 'expired' && tripDateKey(b) === dateKey)
    .map((b) => ({ b, dir: tripDirection(b) }))
    .filter((t) => t.dir);
  const pairedIds = pairedTripIds(trips, rt);

  for (const { b } of trips) {
    // A fare the driver set by hand (PUT /booking/:id/driver-edit) is fixed.
    if (!ADJUSTABLE.includes(b.status) || b.paymentStatus === 'paid' || b.fareSetByDriver) continue;
    const paired = pairedIds.has(String(b._id));
    const percent = rt?.enabled && paired ? rt.percent : 0;
    const oldPercent = b.returnTripDiscountPercent || 0;
    if (oldPercent === percent) continue;
    let kind = 'setting';
    if (rt?.enabled && !oldPercent) kind = 'applied';
    else if (rt?.enabled && !paired) kind = 'pair-ended';
    await applyReturnTripPercent(io, b, percent, kind);
  }

  // Let the driver's dashboard pick up the new fares.
  if (trips.length) {
    const driver = await Driver.findById(driverId);
    if (driver) emitTo(io, driver.userId, 'booking:updated', { driverId });
  }
}

async function applyReturnTripPercent(io, b, percent, kind) {
  const oldFare = b.estimatedFare;
  const oldPercent = b.returnTripDiscountPercent || 0;
  const fare = discountedFare(baseFareOf(b), b.promoDiscountPercent || 0, percent);
  const updated = await Booking.findByIdAndUpdate(b._id, {
    ...fare,
    cardSurchargeAmount: b.paymentMethod === 'card' ? calculateCardSurcharge(fare.estimatedFare) : 0,
  });
  if (updated.estimatedFare !== oldFare) {
    tellPassengerOfNewFare(io, updated, oldFare, fareChangeWording(kind, updated, oldFare, oldPercent, percent));
  }
  return updated;
}

// Call after any change that can affect a trip's return-trip pairing.
// `before` is the booking as it was (or null for a new one), `after` as it
// is now. Re-checks the driver/day it left and the one it joined, and if
// the trip itself no longer has a driver (released back to the pool),
// strips the discount it was carrying.
async function refreshReturnTrip(io, before, after) {
  const keys = new Set();
  for (const b of [before, after]) {
    if (b?.driverId) keys.add(`${b.driverId}|${tripDateKey(b)}`);
  }
  for (const key of keys) {
    const [driverId, dateKey] = key.split('|');
    await reconcileReturnTripDiscounts(io, driverId, dateKey);
  }
  if (after && !after.driverId && after.returnTripDiscountPercent && ADJUSTABLE.includes(after.status) && after.paymentStatus !== 'paid' && !after.fareSetByDriver) {
    await applyReturnTripPercent(io, after, 0, 'unpaired');
  }
}

// After the admin changes the return-trip discount setting: re-check
// every driver/day with a still-adjustable trip, so existing pairs pick up
// (or lose) the discount and their passengers hear about it.
async function repriceUpcomingReturnTrips(io) {
  const keys = new Set();
  for (const b of await Booking.find({ status: { $in: ADJUSTABLE } })) {
    if (b.driverId && tripDirection(b)) keys.add(`${b.driverId}|${tripDateKey(b)}`);
  }
  for (const key of keys) {
    const [driverId, dateKey] = key.split('|');
    await reconcileReturnTripDiscounts(io, driverId, dateKey);
  }
}

// Fire-and-forget wrapper for routes: pairing is a side effect of the
// change the user actually made and must never fail or delay it.
function refreshReturnTripInBackground(req, before, after) {
  const io = req?.app?.get('io');
  runInBackground('return-trip discount', () => refreshReturnTrip(io, before, after));
}

// For the home page: the promotion (if running now or coming up), and
// - while the return-trip discount is on - upcoming days where a driver
// already has one leg booked and the opposite leg would get the discount.
// Only dates, directions and the driver, nothing about the passengers.
async function publicPromotions() {
  const settings = getSettings();
  const today = nzDateKey();
  const p = settings.promoDiscount;
  const promo = p?.enabled && p.endDate >= today
    ? { percent: p.percent, startDate: p.startDate, endDate: p.endDate, active: p.startDate <= today }
    : null;

  let returnTrip = null;
  const rt = settings.returnTripDiscount;
  if (rt?.enabled) {
    const legs = new Map(); // `${driverId}|${date}` -> [{ b, dir }]
    const live = await Booking.find({ status: { $in: ['pending', 'accepted', 'in-progress', 'completed'] } });
    for (const b of live) {
      if (!b.driverId) continue;
      const date = tripDateKey(b);
      if (date < today) continue;
      const dir = tripDirection(b);
      if (!dir) continue;
      const key = `${b.driverId}|${date}`;
      if (!legs.has(key)) legs.set(key, []);
      legs.get(key).push({ b, dir });
    }
    const now = Date.now();
    const openings = new Map();
    // One line per day and direction: keep the widest window - the
    // earliest return pickup, or the latest Auckland-bound departure.
    const offer = (o) => {
      const key = `${o.date}|${o.direction}`;
      const cur = openings.get(key);
      if (!cur || (o.after && o.after < cur.after) || (o.before && o.before > cur.before)) openings.set(key, o);
    };
    // driverId goes with each opening so the home page can link straight
    // to that driver's booking page (/book/:driverId - the same public
    // page their QR code opens): booking the other leg with *them* is what
    // makes the pair, a general broadcast could go to anyone. Each opening
    // carries the time window that would actually qualify (see
    // pairedTripIds): a return pickup from `after`, or an Auckland run
    // leaving New Plymouth by `before`.
    for (const [key, trips] of legs) {
      const [driverId, date] = key.split('|');
      const driver = await Driver.findById(driverId);
      if (driver?.status !== 'approved') continue;
      const pairedIds = pairedTripIds(trips, rt);
      for (const { b, dir } of trips) {
        if (pairedIds.has(String(b._id))) continue;
        if (dir.leg === 'out') {
          const after = endMs(b) + gapMs(rt);
          if (nzDateKey(new Date(after)) === date) offer({ date, direction: directionKey(dir.city, 'back'), driverId, after: new Date(after).toISOString() });
        } else {
          // Latest NP departure that still arrives gap-before this pickup
          // (the run there is the same distance as this trip).
          const before = startMs(b) - gapMs(rt) - driveMs(b);
          if (before > now && nzDateKey(new Date(before)) === date) offer({ date, direction: directionKey(dir.city, 'out'), driverId, before: new Date(before).toISOString() });
        }
      }
    }
    returnTrip = {
      percent: rt.percent,
      openings: [...openings.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6),
    };
  }
  return { promo, returnTrip };
}

module.exports = {
  tripDirection, tripDateKey, promoPercentFor, discountedFare, priceWithPromo,
  reconcileReturnTripDiscounts, refreshReturnTrip, refreshReturnTripInBackground, repriceUpcomingReturnTrips, publicPromotions,
};
