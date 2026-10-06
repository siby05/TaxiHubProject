/**
 * The two admin-configured discounts (see config/platformSettings.js):
 *
 * promoDiscount - percent off any trip dated inside the admin's date
 *   range. Fixed onto the booking when it's created/edited.
 *
 * returnTripDiscount - percent off both legs when one driver has a New
 *   Plymouth -> Auckland trip and an Auckland -> New Plymouth trip on the
 *   same NZ day. Depends on the driver's other bookings, so it's
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
// suburb). Auckland's radius takes in the airport and outer suburbs.
const AUCKLAND = { lat: -36.8485, lng: 174.7633, radiusKm: 45 };
const NEW_PLYMOUTH = { lat: -39.0556, lng: 174.0752, radiusKm: 25 };

// Trips still able to change price. A completed trip's fare is final, and
// an already-paid one was charged that amount.
const ADJUSTABLE = ['pending', 'accepted', 'in-progress'];

const round2 = (n) => Math.round(n * 100) / 100;

function within(city, lat, lng) {
  return lat != null && lng != null && haversineKm(city.lat, city.lng, lat, lng) <= city.radiusKm;
}

// 'to-akl' | 'to-np' | null
function tripDirection(b) {
  if (within(NEW_PLYMOUTH, b.pickupLat, b.pickupLng) && within(AUCKLAND, b.dropLat, b.dropLng)) return 'to-akl';
  if (within(AUCKLAND, b.pickupLat, b.pickupLng) && within(NEW_PLYMOUTH, b.dropLat, b.dropLng)) return 'to-np';
  return null;
}

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

function tellPassengerOfNewFare(io, booking, oldFare, reason) {
  const cheaper = booking.estimatedFare < oldFare;
  const route = `${booking.pickupAddress} → ${booking.dropAddress}`;
  const day = formatNzDate(booking.scheduledFor || booking.requestedAt);
  const message = `${booking.bookingId} (${route}, ${day}): fare ${cheaper ? 'reduced' : 'changed'} from $${oldFare.toFixed(2)} to $${booking.estimatedFare.toFixed(2)} - ${reason}.`;
  notifyUser(booking.passengerId, {
    type: 'fare-changed',
    title: cheaper ? 'Good news - your fare went down' : 'Your fare has changed',
    message,
    link: '/passenger',
  });
  emitTo(io, booking.passengerId, 'booking:updated', { bookingId: booking._id });
  runInBackground('email sendFareChanged', async () => {
    // Required lazily: emailService pulls in a lot, and this module is
    // loaded by routes that emailService's own helpers don't need.
    const { emailService } = require('../services/emailService');
    const passenger = await User.findById(booking.passengerId);
    if (passenger) await emailService.sendFareChanged(passenger.email, booking, oldFare, reason);
  });
}

// Re-checks every trip of one driver on one NZ day: if they have both an
// NP -> Auckland and an Auckland -> NP trip, all those trips get the
// return-trip discount, otherwise none do. Any adjustable, unpaid trip
// whose price changes is updated and its passenger notified. Completed
// trips still count towards making the pair (the driver did drive that
// leg) but their fare is never touched.
async function reconcileReturnTripDiscounts(io, driverId, dateKey) {
  if (!driverId || !dateKey) return;
  const settings = getSettings();
  const rt = settings.returnTripDiscount;

  const trips = (await Booking.find({ driverId }))
    .filter((b) => b.status !== 'cancelled' && b.status !== 'expired' && tripDateKey(b) === dateKey)
    .map((b) => ({ b, dir: tripDirection(b) }))
    .filter((t) => t.dir);
  const paired = trips.some((t) => t.dir === 'to-akl') && trips.some((t) => t.dir === 'to-np');
  const percent = rt?.enabled && paired ? rt.percent : 0;

  for (const { b } of trips) {
    if (!ADJUSTABLE.includes(b.status) || b.paymentStatus === 'paid') continue;
    if ((b.returnTripDiscountPercent || 0) === percent) continue;
    await applyReturnTripPercent(io, b, percent, percent
      ? `a ${percent}% same-day return-trip discount now applies`
      : 'the same-day return trip it was paired with is no longer going ahead, so the return-trip discount no longer applies');
  }

  // Let the driver's dashboard pick up the new fares.
  if (trips.length) {
    const driver = await Driver.findById(driverId);
    if (driver) emitTo(io, driver.userId, 'booking:updated', { driverId });
  }
}

async function applyReturnTripPercent(io, b, percent, reason) {
  const oldFare = b.estimatedFare;
  const fare = discountedFare(baseFareOf(b), b.promoDiscountPercent || 0, percent);
  const updated = await Booking.findByIdAndUpdate(b._id, {
    ...fare,
    cardSurchargeAmount: b.paymentMethod === 'card' ? calculateCardSurcharge(fare.estimatedFare) : 0,
  });
  if (updated.estimatedFare !== oldFare) tellPassengerOfNewFare(io, updated, oldFare, reason);
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
  if (after && !after.driverId && after.returnTripDiscountPercent && ADJUSTABLE.includes(after.status) && after.paymentStatus !== 'paid') {
    await applyReturnTripPercent(io, after, 0, 'it is no longer paired with a same-day return trip');
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
    const legs = new Map(); // `${driverId}|${date}` -> Set of directions
    const live = await Booking.find({ status: { $in: ['pending', 'accepted', 'in-progress', 'completed'] } });
    for (const b of live) {
      if (!b.driverId) continue;
      const date = tripDateKey(b);
      if (date < today) continue;
      const dir = tripDirection(b);
      if (!dir) continue;
      const key = `${b.driverId}|${date}`;
      if (!legs.has(key)) legs.set(key, new Set());
      legs.get(key).add(dir);
    }
    const openings = new Map();
    // driverId goes with each opening so the home page can link straight
    // to that driver's booking page (/book/:driverId - the same public
    // page their QR code opens): booking the other leg with *them* is what
    // makes the pair, a general broadcast could go to anyone.
    for (const [key, dirs] of legs) {
      if (dirs.size !== 1) continue; // already paired
      const [driverId, date] = key.split('|');
      const driver = await Driver.findById(driverId);
      if (driver?.status !== 'approved') continue;
      const needed = dirs.has('to-akl') ? 'to-np' : 'to-akl';
      if (!openings.has(`${date}|${needed}`)) openings.set(`${date}|${needed}`, { date, direction: needed, driverId });
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
